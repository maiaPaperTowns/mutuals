"""Pytest setup: offline, isolated storage, dummy agent seeds. Real keys in .env are never used by tests."""

import logging
import os
import tempfile
import secrets
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from typing import Any

import pytest

_data_dir = tempfile.TemporaryDirectory(prefix=".test-data-", dir=Path(__file__).resolve().parents[1])
os.environ["DATA_DIR"] = _data_dir.name
os.environ["APP_ENV"] = "development"
os.environ["STORAGE_BACKEND"] = "json"
os.environ["ASI1_API_KEY"] = "test-key-not-real"
os.environ["PINECONE_API_KEY"] = ""
os.environ["VECTOR_DB_API_KEY"] = ""
os.environ["AGENT_MAILBOX"] = "false"
for _key in ("EXAMPLE", "PRE_EVENT", "MATCHMAKER", "PARTICIPANT", "FOLLOWUP", "REP_A", "REP_B"):
    os.environ[f"{_key}_AGENT_SEED"] = secrets.token_hex(32)

import fake_data  # noqa: E402
import integrations  # noqa: E402
from common import save  # noqa: E402


class FakeStorage:
    def __init__(self) -> None:
        self.data: dict[str, Any] = {}

    def get(self, key: str) -> Any:
        return self.data.get(key)

    def set(self, key: str, value: Any) -> None:
        self.data[key] = value


class FakeCtx:
    """Stand-in for uagents Context: records every ctx.send."""

    def __init__(self) -> None:
        self.sent: list[tuple[str, Any]] = []
        self.logger = logging.getLogger("test-agent")
        self.storage = FakeStorage()

    async def send(self, destination: str, message: Any) -> None:
        self.sent.append((destination, message))


@pytest.fixture(autouse=True)
def isolated_store(tmp_path):
    integrations.store.root = tmp_path
    yield tmp_path


@pytest.fixture
def ctx() -> FakeCtx:
    return FakeCtx()


@pytest.fixture
def seeded(isolated_store):
    """Fake profiles + events written to the store."""
    for profile in fake_data.profiles().values():
        save(integrations.PROFILES, profile.user_id, profile)
    for event in fake_data.events():
        save(integrations.EVENTS, event.event_id, event)
    return isolated_store

@pytest.fixture(autouse=True)
def offline_jwks(monkeypatch):
    import config
    import jwt
    from auth_helpers import AUDIENCE, ISSUER, ORGANIZER_TOKEN, offline_signing_key
    monkeypatch.setattr(config, "CLERK_ISSUER", ISSUER)
    monkeypatch.setattr(config, "CLERK_AUDIENCE", AUDIENCE)
    monkeypatch.setattr(config, "ORGANIZER_TOKEN", ORGANIZER_TOKEN)
    # Only key retrieval is offline; verify_token still checks signature, issuer, audience and expiry.
    monkeypatch.setattr(jwt.PyJWKClient, "get_signing_key_from_jwt", offline_signing_key)


@pytest.fixture(autouse=True)
def issued_chat_codes(monkeypatch):
    codes = {f"test-link-{user_id}-0123456789abcdef": user_id for user_id in ("alice", "bob", "ghost")}
    links = {}

    def redeem(code, sender):
        if code not in codes:
            raise ValueError("Invalid or consumed code")
        user_id = codes.pop(code)
        links[sender] = user_id
        return user_id

    monkeypatch.setattr(integrations.store, "redeem_link_code", redeem)
    monkeypatch.setattr(integrations.store, "user_for_messaging", links.get)
    return codes
