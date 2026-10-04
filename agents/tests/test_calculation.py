from datetime import timedelta

import pytest

import calculation as calc
from calculation import Position, ScoringContext, Subject
from fake_data import NOW, events, live_update, profiles

ALICE = live_update("alice").to_subject()
BOB = live_update("bob").to_subject()
DAVE = live_update("dave").to_subject()


def test_tokens_normalises_case_plurals_and_stopwords():
    assert calc.tokens(["Find ML Internships", "the class"]) == {"ml", "internship", "class"}


@pytest.mark.parametrize("a,b,expected", [({"a", "b"}, {"b", "c", "d"}, 0.5), ({"a"}, set(), None), (set(), set(), None)])
def test_overlap_coefficient(a, b, expected):
    assert calc.overlap_coefficient(a, b) == expected


def test_cosine():
    assert calc.cosine([1, 0], [1, 0]) == pytest.approx(1.0)
    assert calc.cosine([1, 0], [0, 1]) == pytest.approx(0.0)
    assert calc.cosine([0, 0], [1, 1]) == 0.0


def test_distance_m_coordinates_zones_and_unknown():
    assert calc.distance_m(Position("a", 0, 0), Position("a", 3, 4)) == 5
    assert calc.distance_m(Position("a"), Position("a")) == calc.ROI_CONFIG["same_zone_distance_m"]
    assert calc.distance_m(Position("a"), Position("b")) == calc.ROI_CONFIG["cross_zone_distance_m"]
    assert calc.distance_m(Position(), Position("b")) is None
    assert calc.distance_m(None, Position("b")) is None


def test_overlap_minutes_clips_to_now_and_handles_open_windows():
    horizon = timedelta(hours=12)
    window = ((NOW - timedelta(minutes=30), NOW + timedelta(minutes=45)),)
    assert calc.overlap_minutes(window, (), NOW, horizon) == pytest.approx(45)
    assert calc.overlap_minutes((), (), NOW, horizon) == pytest.approx(720)
    past = ((NOW - timedelta(hours=2), NOW - timedelta(hours=1)),)
    assert calc.overlap_minutes(past, (), NOW, horizon) == 0
    naive = ((NOW.replace(tzinfo=None), (NOW + timedelta(minutes=10)).replace(tzinfo=None)),)
    assert calc.overlap_minutes(naive, (), NOW, horizon) == pytest.approx(10)


def test_goal_alignment():
    assert calc.goal_alignment(ALICE, BOB) >= 0.7  # internship goal vs recruiter offering referrals
    assert calc.goal_alignment(ALICE, DAVE) < 0.4
    assert calc.goal_alignment(Subject(id="x"), BOB) == calc.ROI_CONFIG["neutral"]
    with_embeddings = calc.goal_alignment(Subject(id="u", goals=("zzz",), embedding=(1, 0)), Subject(id="t", embedding=(1, 0)))
    assert with_embeddings == pytest.approx(1.0)


def test_skill_fit_overlap_vs_complement():
    factor, overlap, complement = calc.skill_fit(ALICE, BOB)
    assert 0 < factor <= 1 and overlap > 0
    assert calc.skill_fit(Subject(id="a"), Subject(id="b"))[0] == calc.ROI_CONFIG["neutral"]


def test_reachability_penalties():
    open_near = calc.reachability(BOB, 10)
    assert open_near > calc.reachability(BOB, 1000)
    assert open_near > calc.reachability(Subject(id="b", in_session=True), 10)
    assert open_near > calc.reachability(Subject(id="b", open_to_chat=False), 10)
    assert calc.reachability(BOB, None) == pytest.approx(0.75)


def test_availability_uses_free_until():
    busy_soon = live_update("bob", availability={"free_until": NOW + timedelta(minutes=5)}).to_subject()
    factor, minutes = calc.availability(ALICE, busy_soon, ScoringContext(NOW))
    assert minutes == pytest.approx(5) and factor == pytest.approx(0.5)


def test_seniority_fit_prefers_senior_influential_roles():
    assert calc.seniority_fit(ALICE, BOB) > calc.seniority_fit(ALICE, DAVE)


def test_effort_cost_sources():
    _, travel, distance = calc.effort_cost(ALICE, BOB, ScoringContext(NOW))
    assert distance == 20 and travel == pytest.approx(0.25)
    _, travel, _ = calc.effort_cost(ALICE, BOB, ScoringContext(NOW, travel_minutes=12))
    assert travel == 12
    _, travel, distance = calc.effort_cost(Subject(id="a"), Subject(id="b"), ScoringContext(NOW))
    assert distance is None and travel == calc.ROI_CONFIG["default_travel_minutes"]
    assert calc.effort_cost(ALICE, BOB, ScoringContext(NOW, interaction_minutes=500))[0] == 1.0


def test_roi_score_ranks_people_sensibly():
    bob = calc.roi_score(ALICE, BOB, ScoringContext(NOW))
    dave = calc.roi_score(ALICE, DAVE, ScoringContext(NOW))
    assert 0 <= dave.score < bob.score <= 100
    assert set(bob.breakdown) == set(calc.FACTORS)
    assert bob.reason == calc.explain(bob)


def test_roi_score_ranks_fake_events():
    alice = profiles()["alice"].to_subject()
    scored = {}
    for e in events():
        ctx = ScoringContext(NOW, travel_minutes=e.travel_minutes, interaction_minutes=e.duration_minutes)
        scored[e.event_id] = calc.roi_score(alice, e.to_subject(), ctx).score
    assert scored["past-talk"] == 0
    assert scored["career-fair"] > scored["poetry-night"]
    assert scored["vision-talk"] > scored["poetry-night"]


def test_roi_score_config_override():
    base = calc.roi_score(ALICE, BOB, ScoringContext(NOW)).score
    heavier_effort = calc.roi_score(ALICE, BOB, ScoringContext(NOW), config={"effort_weight": 5.0}).score
    assert heavier_effort < base


def test_explain_phrases():
    assert "currently in a session" in calc.roi_score(ALICE, live_update("bob", availability={"status": "in_session"}).to_subject(), ScoringContext(NOW)).reason
    assert "may not be open to chat" in calc.roi_score(ALICE, live_update("bob", availability={"open_to_chat": False}).to_subject(), ScoringContext(NOW)).reason
    assert calc.roi_score(ALICE, BOB, ScoringContext(NOW)).reason.endswith("min walk")
    assert calc.roi_score(Subject(id="a"), Subject(id="b"), ScoringContext(NOW)).reason.endswith("min away")
