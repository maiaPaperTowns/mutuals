"""Production authentication and consent boundaries exercised with offline signed JWTs."""
import asyncio
import time

import jwt
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import common
import during
import integrations
import pre_event
from auth_helpers import ORGANIZER_TOKEN, token_for


@pytest.mark.parametrize("claims", [
    {"exp": int(time.time()) - 60},
    {"iss": "https://wrong-issuer.invalid"},
    {"aud": "other-app"},
])
def test_invalid_claims_are_rejected(claims):
    with pytest.raises(jwt.InvalidTokenError):
        asyncio.run(integrations.verify_token(token_for("alice", **claims)))


def test_bad_signature_is_rejected():
    from cryptography.hazmat.primitives.asymmetric import rsa
    wrong_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = jwt.encode({"sub": "alice", "iss": "https://offline-test.clerk.invalid", "aud": "mhacks-live-map", "exp": int(time.time()) + 300}, wrong_key, algorithm="RS256")
    with pytest.raises(jwt.InvalidSignatureError):
        asyncio.run(integrations.verify_token(token))


def test_http_requires_authentication_and_ownership():
    client = TestClient(pre_event.app)
    assert client.get("/profile/alice").status_code == 401
    assert client.get("/profile/alice", headers={"authorization": "Bearer invalid"}).status_code == 401
    headers = {"authorization": "Bearer " + token_for("alice")}
    assert client.post("/goals", json={"user_id": "bob", "goals": []}, headers=headers).status_code == 403
    assert integrations.store.get(integrations.PROFILES, "bob") is None
    assert client.get("/health").status_code == 200


def test_organizer_routes_reject_user_tokens():
    client = TestClient(pre_event.app)
    assert client.post("/events", json={}, headers={"authorization": "Bearer " + token_for("alice")}).status_code == 401
    assert client.post("/events", json={}, headers={"x-organizer-token": "wrong"}).status_code == 401
    assert client.post("/events", json={}, headers={"x-organizer-token": ORGANIZER_TOKEN}).status_code == 422


@pytest.mark.parametrize("headers,code", [({}, 4401), ({"authorization": "Bearer invalid"}, 4401), ({"authorization": "Bearer " + token_for("bob")}, 4403)])
def test_websocket_rejects_missing_invalid_and_other_user_identity(headers, code):
    client = TestClient(during.app)
    with pytest.raises(WebSocketDisconnect) as error:
        with client.websocket_connect("/ws/alice", headers=headers):
            pass
    assert error.value.code == code


def test_chat_code_can_only_be_redeemed_once(ctx):
    code = "test-link-alice-0123456789abcdef"
    assert asyncio.run(common.resolve_chat_user(ctx, "agent1alice", "link " + code))[0] == "alice"
    user_id, reply = asyncio.run(common.resolve_chat_user(ctx, "agent1attacker", "link " + code))
    assert user_id is None and "invalid or expired" in reply
    assert asyncio.run(common.resolve_chat_user(ctx, "agent1attacker", "link alice")) == (None, common.LINK_HELP)


def test_transcript_hidden_after_either_participant_revokes_consent():
    integrations.store.put(integrations.TRANSCRIPTS, "i1", {"text": "private conversation"})
    interaction = {"user_id": "alice", "target_id": "bob", "recording_consent": {"alice": True, "bob": True}}
    integrations.store.put(integrations.INTERACTIONS, "i1", interaction)
    assert asyncio.run(integrations.load_transcript("i1")) == "private conversation"
    interaction["recording_consent"]["bob"] = False
    integrations.store.put(integrations.INTERACTIONS, "i1", interaction)
    assert asyncio.run(integrations.load_transcript("i1")) == ""


def test_websocket_accepts_bearer_subprotocol_after_another_protocol():
    client = TestClient(during.app)
    with client.websocket_connect("/ws/alice", headers={"sec-websocket-protocol": "chat, bearer." + token_for("alice")}) as ws:
        ws.send_json({"type": "update"})
        assert ws.receive_json() == {"type": "ack"}
