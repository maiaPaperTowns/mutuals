"""Authenticated clients for offline tests; production JWT verification stays enabled."""
import time
from types import SimpleNamespace
from urllib.parse import urlsplit

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient as RawTestClient

PRIVATE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
ISSUER = "https://offline-test.clerk.invalid"
AUDIENCE = "mhacks-live-map"
ORGANIZER_TOKEN = "offline-test-organizer"


def token_for(user_id, **claims):
    payload = {"sub": user_id, "iss": ISSUER, "aud": AUDIENCE, "exp": int(time.time()) + 300}
    payload.update(claims)
    return jwt.encode(payload, PRIVATE_KEY, algorithm="RS256", headers={"kid": "offline-test"})


def offline_signing_key(self, token):
    return SimpleNamespace(key=PRIVATE_KEY.public_key())


class TestClient(RawTestClient):
    """Supply credentials for restored behavior tests based on their explicit requested user."""
    __test__ = False

    def request(self, method, url, **kwargs):
        path = urlsplit(str(url)).path
        headers = dict(kwargs.pop("headers", {}) or {})
        if path in {"/events", "/followups/run"} and method.upper() == "POST":
            headers.setdefault("x-organizer-token", ORGANIZER_TOKEN)
        else:
            values = kwargs.get("json") or kwargs.get("data") or kwargs.get("params") or {}
            user_id = values.get("user_id") if isinstance(values, dict) else None
            if not user_id and path.startswith(("/profile/", "/opportunities/", "/followups/", "/roi-history/")):
                user_id = path.split("/")[2]
            headers.setdefault("authorization", "Bearer " + token_for(user_id or "alice"))
        return super().request(method, url, headers=headers, **kwargs)

    def websocket_connect(self, url, **kwargs):
        headers = dict(kwargs.pop("headers", {}) or {})
        headers.setdefault("authorization", "Bearer " + token_for(url.split("/")[-1]))
        return super().websocket_connect(url, headers=headers, **kwargs)
