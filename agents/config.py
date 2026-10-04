"""Central configuration. Every secret and tunable comes from environment variables."""

from __future__ import annotations

import os
from pathlib import Path

try:  # optional: load a local .env during development
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass


def _int(name: str, default: int) -> int:
    return int(os.getenv(name, default))


def _float(name: str, default: float) -> float:
    return float(os.getenv(name, default))


# --- Secrets -----------------------------------------------------------------
ASI1_API_KEY = os.getenv("ASI1_API_KEY", "")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
VECTOR_DB_URL = os.getenv("VECTOR_DB_URL", "")
VECTOR_DB_API_KEY = os.getenv("VECTOR_DB_API_KEY", "")
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY") or VECTOR_DB_API_KEY
PINECONE_INDEX = os.getenv("PINECONE_INDEX", "networking-roi")
PINECONE_CLOUD = os.getenv("PINECONE_CLOUD", "aws")
PINECONE_REGION = os.getenv("PINECONE_REGION", "us-east-1")
PINECONE_EMBED_MODEL = os.getenv("PINECONE_EMBED_MODEL", "llama-text-embed-v2")
PINECONE_DIMENSION = _int("PINECONE_DIMENSION", 1024)
PUSH_API_KEY = os.getenv("PUSH_API_KEY", "")
APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "spacetimedb" if APP_ENV == "production" else "json").strip().lower()
SPACETIME_GATEWAY_URL = os.getenv("SPACETIME_GATEWAY_URL", "http://127.0.0.1:8110").rstrip("/")
SPACETIME_GATEWAY_TOKEN = os.getenv("SPACETIME_GATEWAY_TOKEN", "")
CLERK_ISSUER = os.getenv("CLERK_ISSUER", "")
CLERK_AUDIENCE = os.getenv("CLERK_AUDIENCE", "mhacks-live-map")
CLERK_JWKS_URL = os.getenv("CLERK_JWKS_URL", "")
ORGANIZER_TOKEN = os.getenv("ORGANIZER_TOKEN", "")

# --- LLM -----------------------------------------------------------------------
ASI1_BASE_URL = os.getenv("ASI1_BASE_URL", "https://api.asi1.ai/v1")
ASI1_MODEL = os.getenv("ASI1_MODEL", "asi1")

# --- Agents ------------------------------------------------------------------------
# Seed env var per agent: <KEY>_AGENT_SEED, e.g. PRE_EVENT_AGENT_SEED. The seed IS the agent's identity.
# Set AGENT_MAILBOX=false for local/offline runs (skips Agentverse polling, which 401s for unconnected agents).
USE_MAILBOX = os.getenv("AGENT_MAILBOX", "true").strip().lower() not in ("0", "false", "no")

AGENT_KEYS = ("example", "pre_event", "matchmaker", "participant", "followup", "rep_a", "rep_b")

AGENT_PORTS = {
    "example": _int("EXAMPLE_AGENT_PORT", 8000),
    "pre_event": _int("PRE_EVENT_AGENT_PORT", 8001),
    "matchmaker": _int("MATCHMAKER_AGENT_PORT", 8002),
    "participant": _int("PARTICIPANT_AGENT_PORT", 8003),
    "followup": _int("FOLLOWUP_AGENT_PORT", 8004),
    "rep_a": _int("REP_A_AGENT_PORT", 8005),
    "rep_b": _int("REP_B_AGENT_PORT", 8006),
}


def agent_seed(key: str) -> str:
    """Return the seed for agent `key` from env `<KEY>_AGENT_SEED`; fail loudly if unset."""
    env_name = f"{key.upper()}_AGENT_SEED"
    seed = os.getenv(env_name)
    if not seed:
        raise RuntimeError(f"Missing env var {env_name}. Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\"")
    return seed


# --- HTTP (mobile-facing API) ------------------------------------------------------------------
HTTP_HOST = os.getenv("HTTP_HOST", "0.0.0.0")
WEB_ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv("WEB_ALLOWED_ORIGINS", "").split(",") if origin.strip()]
if any("*" in origin for origin in WEB_ALLOWED_ORIGINS):
    raise RuntimeError("WEB_ALLOWED_ORIGINS requires explicit origins, without wildcards.")
HTTP_PORTS = {
    "pre_event": _int("PRE_EVENT_HTTP_PORT", 8101),
    "during": _int("DURING_HTTP_PORT", 8102),
    "post_event": _int("POST_EVENT_HTTP_PORT", 8103),
}

# --- Storage -------------------------------------------------------------------------------------
DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).resolve().parent / "data"))

if STORAGE_BACKEND not in {"json", "spacetimedb"}:
    raise RuntimeError("STORAGE_BACKEND must be 'json' or 'spacetimedb'.")
if APP_ENV == "production" and STORAGE_BACKEND != "spacetimedb":
    raise RuntimeError("Production services require STORAGE_BACKEND=spacetimedb.")

# --- Pre-event -------------------------------------------------------------------------------
TOP_N_EVENTS = _int("TOP_N_EVENTS", 5)
VECTOR_TOP_K = _int("VECTOR_TOP_K", 50)

# --- During ---------------------------------------------------------------------------------------
MATCH_THRESHOLD = _float("MATCH_THRESHOLD", 35.0)  # minimum ROI (0-100) for an OpportunityCard
MATCH_INTERVAL_S = _float("MATCH_INTERVAL_S", 5.0)
STALE_TIMEOUT_S = _float("STALE_TIMEOUT_S", 300.0)
MAX_CARDS = _int("MAX_CARDS", 10)

# --- Post-event --------------------------------------------------------------------------------------
MAX_NEGOTIATION_TURNS = _int("MAX_NEGOTIATION_TURNS", 4)
FOLLOWUP_SCAN_S = _float("FOLLOWUP_SCAN_S", 0.0)  # >0 enables periodic auto-negotiation of new interactions
