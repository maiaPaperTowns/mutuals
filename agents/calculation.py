"""ROI scoring for campus-event networking. Pure functions only: no I/O, no network, no agents.

Formula
-------
Every factor f is normalised to [0, 1].

    value  = sum(w_i * f_i) / sum(w_i)   over goal_alignment, skill_overlap_or_complementarity,
                                          seniority_or_influence_fit (weights in ROI_CONFIG["weights"])
    gate   = reachability * availability
    effort = 1 + effort_weight * effort_cost        # effort_cost in [0, 1]  ->  effort in [1, 1 + effort_weight]
    ROI    = 100 * value * gate / effort            # in [0, 100]

Run the tests with `pytest calculation.py` or `python calculation.py`.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

ROI_CONFIG: dict[str, Any] = {
    # Relative weights of the value factors (need not sum to 1).
    "weights": {
        "goal_alignment": 0.5,
        "skill_overlap_or_complementarity": 0.25,
        "seniority_or_influence_fit": 0.25,
    },
    # Max effort divides the score by (1 + effort_weight).
    "effort_weight": 1.0,
    # skill factor = share * overlap + (1 - share) * complementarity
    "skill_overlap_share": 0.4,
    # Reachability multipliers.
    "closed_to_chat_reachability": 0.15,
    "in_session_reachability": 0.3,
    "proximity_scale_m": 150.0,  # distance at which proximity drops to 0.5
    # Distance fallbacks when only zones are known.
    "same_zone_distance_m": 20.0,
    "cross_zone_distance_m": 150.0,
    # Effort.
    "walking_speed_m_per_min": 80.0,
    "default_travel_minutes": 5.0,
    "interaction_minutes": 10.0,
    "max_effort_minutes": 40.0,  # total minutes at which effort_cost saturates at 1
    # Availability horizon when a side gives no time windows.
    "availability_horizon_hours": 12.0,
    # Seniority / influence.
    "max_seniority": 5,
    "default_role_influence": 0.5,
    "role_influence": {
        "recruiter": 0.9,
        "founder": 0.8,
        "investor": 0.85,
        "mentor": 0.8,
        "professor": 0.8,
        "researcher": 0.7,
        "engineer": 0.6,
        "networker": 0.5,
        "student": 0.4,
        "event": 0.7,
    },
    # Goal keywords that make a target role directly relevant.
    "goal_role_keywords": {
        "recruiter": {"internship", "job", "hire", "hiring", "career", "role", "position", "offer"},
        "founder": {"startup", "cofounder", "founding", "venture", "entrepreneurship"},
        "investor": {"funding", "invest", "investment", "fundraising", "seed", "vc"},
        "mentor": {"mentor", "mentorship", "advice", "guidance"},
        "professor": {"research", "phd", "lab", "grad", "graduate"},
        "researcher": {"research", "phd", "lab", "paper"},
    },
    # Score used when a factor cannot be computed from the inputs.
    "neutral": 0.5,
}

FACTORS = (
    "goal_alignment",
    "skill_overlap_or_complementarity",
    "reachability",
    "availability",
    "seniority_or_influence_fit",
    "effort_cost",
)

_STOPWORDS = {
    "a", "an", "and", "the", "to", "of", "in", "on", "for", "with", "at", "by", "or", "is", "are",
    "be", "my", "me", "i", "want", "get", "find", "meet", "looking", "learn", "about", "more", "some", "who",
}


# --- Inputs / outputs ------------------------------------------------------------------------------------

@dataclass(frozen=True)
class Position:
    zone: str | None = None
    x: float | None = None  # venue coordinates in metres
    y: float | None = None


@dataclass(frozen=True)
class Subject:
    """Anything that can be scored: a person (user or target) or an event."""

    id: str
    role: str = "student"
    goals: tuple[str, ...] = ()
    skills: tuple[str, ...] = ()
    interests: tuple[str, ...] = ()
    offerings: tuple[str, ...] = ()
    seniority: int = 1  # 0 (first-year) .. max_seniority (exec / senior faculty)
    position: Position | None = None
    windows: tuple[tuple[datetime, datetime], ...] = ()  # free windows; empty = free for the horizon
    open_to_chat: bool = True
    in_session: bool = False
    embedding: tuple[float, ...] | None = None


@dataclass(frozen=True)
class ScoringContext:
    now: datetime
    travel_minutes: float | None = None  # overrides distance-based travel time
    interaction_minutes: float | None = None  # overrides ROI_CONFIG["interaction_minutes"]


@dataclass(frozen=True)
class ROIResult:
    score: float  # 0-100
    breakdown: dict[str, float]  # each factor in [0, 1]
    details: dict[str, float] = field(default_factory=dict)  # raw quantities used by explain()
    reason: str = ""


# --- Helpers --------------------------------------------------------------------------------------------------

def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def tokens(texts: Iterable[str]) -> set[str]:
    """Lower-cased content words; trailing plural 's' stripped so 'internships' matches 'internship'."""
    out: set[str] = set()
    for text in texts:
        for word in re.findall(r"[a-z0-9+#]+", text.lower()):
            if word in _STOPWORDS or len(word) < 2:
                continue
            out.add(word[:-1] if len(word) > 3 and word.endswith("s") and not word.endswith("ss") else word)
    return out


def overlap_coefficient(a: set[str], b: set[str]) -> float | None:
    """|A ∩ B| / min(|A|, |B|), or None if either set is empty."""
    if not a or not b:
        return None
    return len(a & b) / min(len(a), len(b))


def cosine(a: Iterable[float], b: Iterable[float]) -> float:
    a, b = list(a), list(b)
    norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return sum(x * y for x, y in zip(a, b)) / norm if norm else 0.0


def distance_m(a: Position | None, b: Position | None, cfg: dict[str, Any] = ROI_CONFIG) -> float | None:
    """Euclidean distance if both have coordinates, else a zone-based estimate, else None."""
    if a is None or b is None:
        return None
    if None not in (a.x, a.y, b.x, b.y):
        return math.hypot(a.x - b.x, a.y - b.y)  # type: ignore[operator]
    if a.zone and b.zone:
        return cfg["same_zone_distance_m"] if a.zone == b.zone else cfg["cross_zone_distance_m"]
    return None


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def overlap_minutes(
    a: Iterable[tuple[datetime, datetime]],
    b: Iterable[tuple[datetime, datetime]],
    now: datetime,
    horizon: timedelta,
) -> float:
    """Minutes from `now` onward during which both sides are free. Empty window list = free until now+horizon."""
    now = _aware(now)
    default = [(now, now + horizon)]
    a_windows = [(_aware(s), _aware(e)) for s, e in a] or default
    b_windows = [(_aware(s), _aware(e)) for s, e in b] or default
    total = 0.0
    for a_start, a_end in a_windows:
        for b_start, b_end in b_windows:
            start, end = max(a_start, b_start, now), min(a_end, b_end)
            if end > start:
                total += (end - start).total_seconds() / 60
    return total


# --- Factors ------------------------------------------------------------------------------------------------------

def goal_alignment(user: Subject, target: Subject, cfg: dict[str, Any] = ROI_CONFIG) -> float:
    """max(keyword overlap of user goals vs target role+offerings, role-keyword affinity, embedding cosine)."""
    goal_tokens = tokens(user.goals)
    if not goal_tokens:
        return cfg["neutral"]
    text = overlap_coefficient(goal_tokens, tokens((target.role, *target.offerings))) or 0.0
    role_keywords = cfg["goal_role_keywords"].get(target.role.lower(), set())
    affinity = 0.8 if goal_tokens & role_keywords else 0.0
    semantic = _clamp(cosine(user.embedding, target.embedding)) if user.embedding and target.embedding else 0.0
    return _clamp(max(text, affinity, semantic))


def skill_fit(user: Subject, target: Subject, cfg: dict[str, Any] = ROI_CONFIG) -> tuple[float, float, float]:
    """Returns (factor, overlap, complementarity).

    overlap         = overlap_coefficient(user.skills, target.skills)
    complementarity = how much of what the user wants (goals + interests minus existing skills)
                      the target brings (skills + offerings)
    """
    user_skills = tokens(user.skills)
    target_brings = tokens((*target.skills, *target.offerings))
    needs = tokens((*user.goals, *user.interests)) - user_skills
    overlap = overlap_coefficient(user_skills, tokens(target.skills))
    complement = overlap_coefficient(needs, target_brings)
    if overlap is None and complement is None:
        return cfg["neutral"], 0.0, 0.0
    overlap, complement = overlap or 0.0, complement or 0.0
    share = cfg["skill_overlap_share"]
    return _clamp(share * overlap + (1 - share) * complement), overlap, complement


def reachability(target: Subject, distance: float | None, cfg: dict[str, Any] = ROI_CONFIG) -> float:
    """openness * session_penalty * (0.5 + 0.5 * proximity), proximity = 1 / (1 + d / scale), unknown d -> 0.5."""
    openness = 1.0 if target.open_to_chat else cfg["closed_to_chat_reachability"]
    session = cfg["in_session_reachability"] if target.in_session else 1.0
    proximity = 0.5 if distance is None else 1.0 / (1.0 + distance / cfg["proximity_scale_m"])
    return _clamp(openness * session * (0.5 + 0.5 * proximity))


def availability(user: Subject, target: Subject, ctx: ScoringContext, cfg: dict[str, Any] = ROI_CONFIG) -> tuple[float, float]:
    """Returns (factor, overlap_minutes). factor = min(1, shared free minutes / minutes needed)."""
    needed = ctx.interaction_minutes or cfg["interaction_minutes"]
    horizon = timedelta(hours=cfg["availability_horizon_hours"])
    shared = overlap_minutes(user.windows, target.windows, ctx.now, horizon)
    return _clamp(shared / needed if needed > 0 else 1.0), shared


def seniority_fit(user: Subject, target: Subject, cfg: dict[str, Any] = ROI_CONFIG) -> float:
    """0.5 * role_influence + 0.5 * (0.5 + 0.5 * seniority_gap), seniority_gap in [-1, 1]."""
    influence = cfg["role_influence"].get(target.role.lower(), cfg["default_role_influence"])
    gap = (target.seniority - user.seniority) / cfg["max_seniority"]
    return _clamp(0.5 * influence + 0.5 * _clamp(0.5 + 0.5 * gap))


def effort_cost(
    user: Subject, target: Subject, ctx: ScoringContext, cfg: dict[str, Any] = ROI_CONFIG
) -> tuple[float, float, float | None]:
    """Returns (factor, travel_minutes, distance_m). factor = min(1, (travel + interaction) / max_effort)."""
    distance = distance_m(user.position, target.position, cfg)
    if ctx.travel_minutes is not None:
        travel = ctx.travel_minutes
    elif distance is not None:
        travel = distance / cfg["walking_speed_m_per_min"]
    else:
        travel = cfg["default_travel_minutes"]
    total = travel + (ctx.interaction_minutes or cfg["interaction_minutes"])
    return _clamp(total / cfg["max_effort_minutes"]), travel, distance


# --- Public API -------------------------------------------------------------------------------------------------------

def roi_score(
    user_profile: Subject,
    target: Subject,
    context: ScoringContext,
    config: dict[str, Any] | None = None,
) -> ROIResult:
    """Score how worthwhile it is for `user_profile` to engage `target` right now (see module docstring)."""
    cfg = {**ROI_CONFIG, **(config or {})}
    effort, travel, distance = effort_cost(user_profile, target, context, cfg)
    skill, skill_overlap, skill_complement = skill_fit(user_profile, target, cfg)
    avail, shared_minutes = availability(user_profile, target, context, cfg)
    breakdown = {
        "goal_alignment": goal_alignment(user_profile, target, cfg),
        "skill_overlap_or_complementarity": skill,
        "reachability": reachability(target, distance, cfg),
        "availability": avail,
        "seniority_or_influence_fit": seniority_fit(user_profile, target, cfg),
        "effort_cost": effort,
    }
    weights = cfg["weights"]
    value = sum(w * breakdown[name] for name, w in weights.items()) / sum(weights.values())
    raw = value * breakdown["reachability"] * breakdown["availability"] / (1 + cfg["effort_weight"] * effort)
    details = {
        "travel_minutes": travel,
        "overlap_minutes": shared_minutes,
        "skill_overlap": skill_overlap,
        "skill_complementarity": skill_complement,
        "in_session": float(target.in_session),
        "open_to_chat": float(target.open_to_chat),
    }
    if distance is not None:
        details["distance_m"] = distance
    result = ROIResult(score=round(100 * _clamp(raw), 1), breakdown={k: round(v, 3) for k, v in breakdown.items()}, details=details)
    return ROIResult(result.score, result.breakdown, result.details, explain(result))


def explain(result: ROIResult) -> str:
    """Short human-readable reason, e.g. 'Strong goal match, reachable now, 2 min walk'."""
    b, d = result.breakdown, result.details
    parts: list[str] = []
    goal = b["goal_alignment"]
    parts.append("Strong goal match" if goal >= 0.7 else "Good goal match" if goal >= 0.4 else "Weak goal match")
    if b["skill_overlap_or_complementarity"] >= 0.5:
        complementary = d.get("skill_complementarity", 0) >= d.get("skill_overlap", 0)
        parts.append("complementary skills" if complementary else "shared skills")
    if b["seniority_or_influence_fit"] >= 0.7:
        parts.append("well placed to help")
    if d.get("in_session"):
        parts.append("currently in a session")
    elif not d.get("open_to_chat", 1.0):
        parts.append("may not be open to chat")
    elif b["reachability"] >= 0.6:
        parts.append("reachable now")
    if b["availability"] < 0.5:
        parts.append("limited time overlap")
    travel = round(d.get("travel_minutes", 0))
    parts.append(f"{max(travel, 1)} min walk" if "distance_m" in d else f"~{max(travel, 1)} min away")
    return ", ".join(parts)


# --- Tests (pytest calculation.py) -------------------------------------------------------------------------------------

_NOW = datetime(2026, 10, 3, 18, 0, tzinfo=timezone.utc)
_STUDENT = Subject(
    id="u1", role="student", goals=("ML internship",), skills=("python", "pytorch"),
    interests=("computer vision",), seniority=1, position=Position("atrium", 0, 0),
)


def _target(**overrides: Any) -> Subject:
    base = dict(
        id="t1", role="recruiter", offerings=("ML internship referrals",), skills=("python", "computer vision"),
        seniority=4, position=Position("atrium", 30, 40),
    )
    return Subject(**{**base, **overrides})


def test_score_in_range_and_breakdown_complete() -> None:
    result = roi_score(_STUDENT, _target(), ScoringContext(now=_NOW))
    assert 0 <= result.score <= 100
    assert set(result.breakdown) == set(FACTORS)
    assert all(0 <= v <= 1 for v in result.breakdown.values())


def test_relevant_recruiter_beats_unrelated_peer() -> None:
    peer = _target(role="student", offerings=("study group",), skills=("history",), seniority=1)
    assert roi_score(_STUDENT, _target(), ScoringContext(_NOW)).score > roi_score(_STUDENT, peer, ScoringContext(_NOW)).score


def test_distance_and_unreachability_lower_score() -> None:
    near = roi_score(_STUDENT, _target(), ScoringContext(_NOW)).score
    far = roi_score(_STUDENT, _target(position=Position("hall-b", 900, 900)), ScoringContext(_NOW)).score
    busy = roi_score(_STUDENT, _target(in_session=True), ScoringContext(_NOW)).score
    closed = roi_score(_STUDENT, _target(open_to_chat=False), ScoringContext(_NOW)).score
    assert near > far and near > busy and near > closed


def test_no_time_overlap_scores_zero() -> None:
    past = ((_NOW - timedelta(hours=2), _NOW - timedelta(hours=1)),)
    assert roi_score(_STUDENT, _target(windows=past), ScoringContext(_NOW)).score == 0


def test_reason_string() -> None:
    reason = roi_score(_STUDENT, _target(), ScoringContext(_NOW)).reason
    assert reason.startswith("Strong goal match") and "reachable now" in reason and "min walk" in reason


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"ok  {name}")
    print(roi_score(_STUDENT, _target(), ScoringContext(_NOW)))
