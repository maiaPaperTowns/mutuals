"""Shared models.

Two families, because uagents.Model is pydantic v1 and FastAPI only accepts pydantic v2:
  * Domain / HTTP models (pydantic v2 BaseModel): persisted records and request bodies.
  * Agent messages (uagents.Model): everything sent between agents with ctx.send.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Annotated, Dict, List, Optional, Tuple

from pydantic import AfterValidator, BaseModel, Field
from uagents import Model

from calculation import Position, Subject


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


UtcDatetime = Annotated[datetime, AfterValidator(_as_utc)]  # naive inputs are interpreted as UTC
TimeWindow = Tuple[UtcDatetime, UtcDatetime]


# --- Follow-up channels ----------------------------------------------------------------------------------------

class FollowUpChannel(str, Enum):
    """Extensible: add a member here and give it a rank in CHANNEL_INVASIVENESS."""

    NONE = "none"
    LINKEDIN = "linkedin"
    EMAIL = "email"
    INSTAGRAM = "instagram"
    INTERVIEW = "interview_scheduling"


# Lower = less invasive. Used for the no-agreement fallback.
CHANNEL_INVASIVENESS: Dict[FollowUpChannel, int] = {
    FollowUpChannel.NONE: 0,
    FollowUpChannel.LINKEDIN: 1,
    FollowUpChannel.EMAIL: 2,
    FollowUpChannel.INSTAGRAM: 3,
    FollowUpChannel.INTERVIEW: 4,
}


# --- Domain / HTTP models (pydantic v2) --------------------------------------------------------------------------------

class FollowUpPreferences(BaseModel):
    allowed_channels: List[FollowUpChannel] = [FollowUpChannel.LINKEDIN, FollowUpChannel.EMAIL]  # most preferred first
    handles: Dict[str, str] = {}  # channel value -> handle/address, e.g. {"linkedin": "in/jane"}
    notes: str = ""


class UserProfile(BaseModel):
    user_id: str
    name: str = ""
    role: str = "student"
    headline: str = ""
    skills: List[str] = []
    experience: List[str] = []
    interests: List[str] = []
    goals: List[str] = []
    offerings: List[str] = []  # what this person can give others
    introduction: str = ""  # private, cumulative web intake text
    resume_filename: Optional[str] = None  # metadata only; uploaded bytes are never stored
    seniority: int = 1  # 0..5
    free_windows: List[TimeWindow] = []
    discoverable: bool = False  # opt-in to be shown to others during the event
    followup_prefs: FollowUpPreferences = FollowUpPreferences()
    embedding: Optional[List[float]] = None
    updated_at: datetime = Field(default_factory=utcnow)

    def to_subject(self) -> Subject:
        return Subject(
            id=self.user_id, role=self.role, goals=tuple(self.goals), skills=tuple(self.skills),
            interests=tuple(self.interests), offerings=tuple(self.offerings), seniority=self.seniority,
            windows=tuple(self.free_windows), embedding=tuple(self.embedding) if self.embedding else None,
        )


class EventInfo(BaseModel):
    event_id: str
    title: str
    description: str = ""
    host_role: str = "event"
    topics: List[str] = []
    offerings: List[str] = []  # e.g. "Google recruiters", "resume reviews"
    seniority: int = 3
    start: UtcDatetime
    end: UtcDatetime
    zone: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None
    travel_minutes: Optional[float] = None
    embedding: Optional[List[float]] = None

    def to_subject(self) -> Subject:
        return Subject(
            id=self.event_id, role=self.host_role, skills=tuple(self.topics),
            offerings=(self.title, *self.offerings, *self.topics), seniority=self.seniority,
            position=Position(self.zone, self.x, self.y), windows=((self.start, self.end),),
            embedding=tuple(self.embedding) if self.embedding else None,
        )

    @property
    def duration_minutes(self) -> float:
        return (self.end - self.start).total_seconds() / 60


class EventRecommendation(BaseModel):
    event: EventInfo
    roi_score: float
    breakdown: Dict[str, float]
    reason: str


class Interaction(BaseModel):
    interaction_id: str
    user_id: str  # initiator
    target_id: str
    status: str = "requested"  # requested | accepted | declined | recorded
    roi_score_at_match: float = 0.0
    reason: str = ""
    recording_consent: Dict[str, bool] = {}
    recording_active: bool = False
    audio_ref: Optional[str] = None
    transcript_ref: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)

    def parties(self) -> Tuple[str, str]:
        return self.user_id, self.target_id


class NextStepPlan(BaseModel):
    plan_id: str
    interaction_id: str
    user_a: str
    user_b: str
    channels: List[FollowUpChannel]
    agreed: bool  # False = negotiation failed and the least-invasive fallback was used
    drafts: Dict[str, str]  # user_id -> outreach message written for that user to send
    suggested_timing: str
    rationale: str
    negotiation_log: List[str] = []
    approvals: Dict[str, bool] = {}
    send_status: Dict[str, str] = {}
    created_at: datetime = Field(default_factory=utcnow)


class RoiHistoryEntry(BaseModel):
    entry_id: str
    user_id: str
    target_id: str
    interaction_id: str
    plan_id: Optional[str] = None
    roi_score_at_match: float = 0.0
    outcome: Optional[str] = None  # e.g. "replied", "interview", "offer", "no_response"
    recorded_at: datetime = Field(default_factory=utcnow)


class GoalsRequest(BaseModel):
    user_id: str
    goals: List[str]
    free_windows: Optional[List[TimeWindow]] = None
    discoverable: Optional[bool] = None


class ConnectRequest(BaseModel):
    user_id: str
    target_id: str


class ConnectResponse(BaseModel):
    interaction_id: str
    user_id: str  # the target answering the request
    accept: bool


class RecordConsentRequest(BaseModel):
    interaction_id: str
    user_id: str
    consent: bool


class RecordRequest(BaseModel):
    interaction_id: str
    user_id: str


class PreferencesRequest(BaseModel):
    user_id: str
    allowed_channels: List[FollowUpChannel]
    handles: Dict[str, str] = {}
    notes: str = ""


class ApproveRequest(BaseModel):
    user_id: str


class OutcomeRequest(BaseModel):
    user_id: str
    outcome: str


# --- Agent messages (uagents.Model) ----------------------------------------------------------------------------------------

class Location(Model):
    zone: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None


class Availability(Model):
    status: str = "free"  # free | busy | in_session
    open_to_chat: bool = True
    free_until: Optional[datetime] = None


class ProfileUpdate(Model):
    """ParticipantAgent -> MatchmakerAgent: live profile + location + status."""

    user_id: str
    name: str = ""
    role: str = "student"
    goals: List[str] = []
    skills: List[str] = []
    interests: List[str] = []
    offerings: List[str] = []
    seniority: int = 1
    location: Location = Location()
    availability: Availability = Availability()
    discoverable: bool = False
    timestamp: datetime

    def to_subject(self) -> Subject:
        a = self.availability
        windows = ((self.timestamp, a.free_until),) if a.free_until else ()
        return Subject(
            id=self.user_id, role=self.role, goals=tuple(self.goals), skills=tuple(self.skills),
            interests=tuple(self.interests), offerings=tuple(self.offerings), seniority=self.seniority,
            position=Position(self.location.zone, self.location.x, self.location.y), windows=windows,
            open_to_chat=a.open_to_chat and a.status != "busy", in_session=a.status == "in_session",
        )


class ParticipantLeft(Model):
    user_id: str


class OpportunityCard(Model):
    target_id: str
    target_name: str
    role: str
    location: Location
    roi_score: float
    reason_for_connection: str
    breakdown: Dict[str, float]


class MatchesUpdate(Model):
    """MatchmakerAgent -> ParticipantAgent: ranked cards for one user."""

    user_id: str
    cards: List[OpportunityCard]
    generated_at: datetime


class ConnectIntent(Model):
    """MatchmakerAgent -> target's ParticipantAgent."""

    interaction_id: str
    from_user_id: str
    from_name: str
    target_id: str
    roi_score: float
    reason: str


class NegotiationStart(Model):
    """FollowUpAgent -> representative of user_a."""

    session_id: str
    interaction_id: str
    user_a: str
    user_b: str
    max_turns: int


class NegotiationTurn(Model):
    """Representative <-> representative. State travels with the message, so representatives are stateless."""

    session_id: str
    interaction_id: str
    user_a: str
    user_b: str
    turn: int
    max_turns: int
    from_side: str  # "a" | "b"
    proposal: Optional[str] = None  # FollowUpChannel value
    rejected: List[str] = []
    log: List[str] = []


class NegotiationResult(Model):
    """Representative -> FollowUpAgent."""

    session_id: str
    interaction_id: str
    user_a: str
    user_b: str
    agreed: bool
    channels: List[str]
    log: List[str]


class HealthResponse(Model):
    status: str
    agent: str
