"""Pinecone vectors, authenticated storage, and external provider stubs.

Callers catch NotImplementedError and degrade gracefully, so the backend runs before these are filled in.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from weakref import WeakValueDictionary

import config


# --- Vector database --------------------------------------------------------------------------------

_pinecone_lock = threading.Lock()
_pinecone_clients: dict[str, Any] = {}
_profile_operation_locks: WeakValueDictionary[str, asyncio.Lock] = WeakValueDictionary()


def profile_operation_lock(user_id: str) -> asyncio.Lock:
    return _profile_operation_locks.setdefault(user_id, asyncio.Lock())


def pinecone_client(api_key: str | None = None) -> Any:
    key = config.PINECONE_API_KEY if api_key is None else api_key
    if not key:
        raise NotImplementedError("Set PINECONE_API_KEY to enable Pinecone")
    with _pinecone_lock:
        if key not in _pinecone_clients:
            from pinecone import Pinecone

            _pinecone_clients[key] = Pinecone(api_key=key)
        return _pinecone_clients[key]

@dataclass
class VectorMatch:
    id: str
    score: float
    metadata: dict[str, Any] = field(default_factory=dict)


class VectorDBClient:
    """Pinecone cosine index with one namespace per collection."""

    def __init__(self, api_key: str | None = None, index_name: str | None = None) -> None:
        self.api_key = api_key
        self.index_name = index_name or config.PINECONE_INDEX
        self._index: Any = None

    def _get_index(self) -> Any:
        pc = pinecone_client(self.api_key)
        with _pinecone_lock:
            if self._index is None:
                if not pc.has_index(self.index_name):
                    from pinecone import ServerlessSpec

                    pc.create_index(name=self.index_name, dimension=config.PINECONE_DIMENSION, metric="cosine",
                                    spec=ServerlessSpec(cloud=config.PINECONE_CLOUD, region=config.PINECONE_REGION), timeout=60)
                description = pc.describe_index(self.index_name)
                if description.dimension != config.PINECONE_DIMENSION or description.metric != "cosine":
                    raise ValueError("Pinecone index dimension or metric does not match the configured embedding")
                self._index = pc.Index(host=description.host)
            return self._index

    async def upsert(self, collection: str, id: str, embedding: list[float], metadata: dict[str, Any]) -> None:
        clean = {key: value for key, value in metadata.items() if value is not None}
        await asyncio.to_thread(lambda: self._get_index().upsert(
            vectors=[{"id": id, "values": embedding, "metadata": clean}], namespace=collection,
        ))

    async def query(
        self,
        collection: str,
        embedding: list[float],
        top_k: int = 10,
        filters: dict[str, Any] | None = None,
    ) -> list[VectorMatch]:
        response = await asyncio.to_thread(lambda: self._get_index().query(
            vector=embedding, top_k=top_k, namespace=collection, filter=filters, include_metadata=True,
        ))
        return [VectorMatch(match.id, float(match.score), dict(match.metadata or {})) for match in response.matches]

    async def delete(self, collection: str, id: str) -> None:
        await asyncio.to_thread(lambda: self._get_index().delete(ids=[id], namespace=collection))


async def embed(text: str) -> list[float]:
    pc = pinecone_client()
    result = await asyncio.to_thread(lambda: pc.inference.embed(
        model=config.PINECONE_EMBED_MODEL, inputs=[text[:8000]],
        parameters={"input_type": "passage", "truncate": "END", "dimension": config.PINECONE_DIMENSION},
    ))
    return list(result.data[0].values)


async def delete_profile_vector(user_id: str) -> None:
    try:
        await VectorDBClient().delete(PROFILES, user_id)
    except NotImplementedError:
        pass  # No Pinecone key: this backend has not enabled vector storage.


# --- ElevenLabs (recording + speech-to-text) -----------------------------------------------------------

async def start_recording(session_id: str) -> None:
    """TODO(elevenlabs): begin capturing audio for `session_id` using config.ELEVENLABS_API_KEY. Returns None."""
    raise NotImplementedError("start_recording(session_id: str) -> None")


async def stop_recording(session_id: str) -> str:
    """TODO(elevenlabs): stop capture for `session_id`. Returns an opaque audio_ref (str)."""
    raise NotImplementedError("stop_recording(session_id: str) -> str  # audio_ref")


async def transcribe(audio_ref: str) -> str:
    """TODO(elevenlabs): speech-to-text for `audio_ref`. Returns the transcript text (str)."""
    raise NotImplementedError("transcribe(audio_ref: str) -> str")


# --- Documents ---------------------------------------------------------------------------------------------

def pdf_to_text(data: bytes) -> str:
    """Extract text from a PDF. Uses `pypdf` if installed. TODO(pdf): swap in a better parser if needed."""
    try:
        from io import BytesIO

        from pypdf import PdfReader
    except ImportError as exc:
        raise NotImplementedError("pdf_to_text(data: bytes) -> str  # pip install pypdf") from exc
    return "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(data)).pages)


# --- Auth, push, outbound messaging ----------------------------------------------------------------------------

async def verify_token(token: str) -> str:
    """Verify a Clerk JWT and return its trusted subject claim."""
    if not config.CLERK_ISSUER:
        raise ValueError("CLERK_ISSUER is not configured")
    try:
        import jwt
    except ImportError as exc:
        raise RuntimeError("Install PyJWT[crypto] to validate Clerk tokens") from exc

    jwks_url = config.CLERK_JWKS_URL or f"{config.CLERK_ISSUER.rstrip('/')}/.well-known/jwks.json"

    def decode() -> str:
        signing_key = jwt.PyJWKClient(jwks_url).get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            audience=config.CLERK_AUDIENCE,
            issuer=config.CLERK_ISSUER,
            options={"require": ["exp", "sub", "iss", "aud"]},
        )
        return claims["sub"]

    import asyncio

    return await asyncio.to_thread(decode)


async def send_push(user_id: str, title: str, body: str, data: dict[str, Any] | None = None) -> None:
    """TODO(push): deliver a push notification via config.PUSH_API_KEY. Returns None."""
    raise NotImplementedError("send_push(user_id, title, body, data) -> None")


async def send_outreach(channel: str, from_user_id: str, to_user_id: str, message: str) -> str:
    """TODO(outreach): send `message` over `channel` (a FollowUpChannel value). Returns a delivery id (str).

    Only ever called after explicit user approval.
    """
    raise NotImplementedError("send_outreach(channel, from_user_id, to_user_id, message) -> str  # delivery_id")


# --- Storage -------------------------------------------------------------------------------------------------

PROFILES = "profiles"
EVENTS = "events"
INTERACTIONS = "interactions"
TRANSCRIPTS = "transcripts"
PLANS = "plans"
ROI_HISTORY = "roi_history"


class JsonFileStore:
    """DEV-ONLY persistence shared by all processes: DATA_DIR/<collection>/<key>.json.

    TODO(storage): replace with a real database; keep these four method signatures.
    """

    def __init__(self, root: Path = config.DATA_DIR) -> None:
        self.root = Path(root)

    def _path(self, collection: str, key: str) -> Path:
        safe = re.sub(r"[^A-Za-z0-9_.@-]", "_", key)
        return self.root / collection / f"{safe}.json"

    def get(self, collection: str, key: str) -> dict[str, Any] | None:
        path = self._path(collection, key)
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    def put(self, collection: str, key: str, value: dict[str, Any]) -> None:
        path = self._path(collection, key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(value, default=str, indent=2), encoding="utf-8")
        os.replace(tmp, path)

    def list(self, collection: str) -> list[dict[str, Any]]:
        folder = self.root / collection
        if not folder.exists():
            return []
        return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(folder.glob("*.json"))]

    def delete(self, collection: str, key: str) -> None:
        self._path(collection, key).unlink(missing_ok=True)

    def resolve_identity(self, auth_subject: str) -> str:
        return auth_subject

    def create_link_code(self, user_id: str) -> dict[str, Any]:
        raise RuntimeError("ASI:One account linking requires the SpacetimeDB backend")

    def redeem_link_code(self, code: str, messaging_identity: str) -> str:
        raise RuntimeError("ASI:One account linking requires the SpacetimeDB backend")

    def user_for_messaging(self, messaging_identity: str) -> str | None:
        raise RuntimeError("ASI:One account linking requires the SpacetimeDB backend")

    def put_presence(self, user_id: str, payload: dict[str, Any]) -> None:
        self.put("presence", user_id, payload)

    def list_presence(self) -> list[dict[str, Any]]:
        return self.list("presence")

    def delete_presence(self, user_id: str) -> None:
        self.delete("presence", user_id)

    def delete_account(self, user_id: str) -> None:
        self.delete_presence(user_id)
        interactions = [
            row for row in self.list(INTERACTIONS)
            if row.get("user_id") == user_id or row.get("target_id") == user_id
        ]
        interaction_ids = {row["interaction_id"] for row in interactions}
        plans, history = self.list(PLANS), self.list(ROI_HISTORY)
        interaction_ids.update(row["interaction_id"] for row in plans if user_id in (row.get("user_a"), row.get("user_b")))
        interaction_ids.update(row["interaction_id"] for row in history if user_id in (row.get("user_id"), row.get("target_id")))
        self.delete(PROFILES, user_id)
        for interaction_id in interaction_ids:
            self.delete(INTERACTIONS, interaction_id)
            self.delete(TRANSCRIPTS, interaction_id)
        for row in plans:
            if user_id in (row.get("user_a"), row.get("user_b")) or row.get("interaction_id") in interaction_ids:
                self.delete(PLANS, row["plan_id"])
        for row in history:
            if user_id in (row.get("user_id"), row.get("target_id")) or row.get("interaction_id") in interaction_ids:
                self.delete(ROI_HISTORY, row["entry_id"])


class SpacetimeGatewayStore:
    """Production store backed by the private, allowlisted TypeScript gateway."""

    def __init__(self, url: str = config.SPACETIME_GATEWAY_URL, token: str = config.SPACETIME_GATEWAY_TOKEN) -> None:
        if not token:
            raise RuntimeError("SPACETIME_GATEWAY_TOKEN is required for the SpacetimeDB store")
        self.url = url.rstrip("/")
        self.token = token

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(
            f"{self.url}/api{path}",
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"SpacetimeDB gateway returned HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"SpacetimeDB gateway is unavailable: {exc.reason}") from exc
        return json.loads(raw) if raw else None

    def get(self, collection: str, key: str) -> dict[str, Any] | None:
        return self._request("GET", f"/collections/{collection}/{urllib.parse.quote(key, safe='')}")

    def put(self, collection: str, key: str, value: dict[str, Any]) -> None:
        self._request("PUT", f"/collections/{collection}/{urllib.parse.quote(key, safe='')}", value)

    def list(self, collection: str) -> list[dict[str, Any]]:
        return self._request("GET", f"/collections/{collection}")

    def delete(self, collection: str, key: str) -> None:
        self._request("DELETE", f"/collections/{collection}/{urllib.parse.quote(key, safe='')}")

    def resolve_identity(self, auth_subject: str) -> str:
        result = self._request("POST", "/identity/resolve", {"auth_subject": auth_subject})
        return result["user_id"]

    def create_link_code(self, user_id: str) -> dict[str, Any]:
        return self._request("POST", "/link-codes", {"user_id": user_id})

    def redeem_link_code(self, code: str, messaging_identity: str) -> str:
        result = self._request("POST", "/link-codes/redeem", {"code": code, "messaging_identity": messaging_identity})
        return result["user_id"]

    def user_for_messaging(self, messaging_identity: str) -> str | None:
        result = self._request("GET", f"/messaging/{urllib.parse.quote(messaging_identity, safe='')}")
        return result.get("user_id") if result else None

    def put_presence(self, user_id: str, payload: dict[str, Any]) -> None:
        self._request("PUT", f"/presence/{urllib.parse.quote(user_id, safe='')}", payload)

    def list_presence(self) -> list[dict[str, Any]]:
        return self._request("GET", "/presence")

    def delete_presence(self, user_id: str) -> None:
        self._request("DELETE", f"/presence/{urllib.parse.quote(user_id, safe='')}")

    def delete_account(self, user_id: str) -> None:
        self._request("DELETE", f"/users/{urllib.parse.quote(user_id, safe='')}")


store: JsonFileStore | SpacetimeGatewayStore = (
    SpacetimeGatewayStore() if config.STORAGE_BACKEND == "spacetimedb" else JsonFileStore()
)


async def load_transcript(transcript_ref: str | None) -> str:
    """Return transcript text only while both participants' recording consent remains active."""
    if not transcript_ref:
        return ""
    record = store.get(TRANSCRIPTS, transcript_ref)
    interaction = store.get(INTERACTIONS, transcript_ref)
    if not record or not interaction:
        return ""
    consent = interaction.get("recording_consent", {})
    if not all(consent.get(user_id) is True for user_id in (interaction.get("user_id"), interaction.get("target_id"))):
        return ""
    return record.get("text", "")
