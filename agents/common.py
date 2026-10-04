"""Plumbing shared by the agent files: event loop, LLM, ASI:One chat protocol, outbox, runner, typed store access."""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
import re
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import Any, TypeVar
from uuid import uuid4

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from openai import OpenAI
from pydantic import BaseModel
from uagents import Agent, Context, Model, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    TextContent,
    chat_protocol_spec,
)

import config
from integrations import delete_profile_vector, profile_operation_lock, store, verify_token

T = TypeVar("T", bound=BaseModel)
log = logging.getLogger("common")


def new_loop() -> asyncio.AbstractEventLoop:
    """One loop per process, shared by every Agent (pass loop=...) and the HTTP server."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    return loop


# --- LLM (ASI:One, OpenAI-compatible) -------------------------------------------------------------------------------

_client: OpenAI | None = None


def _llm() -> OpenAI:
    global _client
    if _client is None:
        if not config.ASI1_API_KEY:
            raise RuntimeError("ASI1_API_KEY is not set")
        _client = OpenAI(base_url=config.ASI1_BASE_URL, api_key=config.ASI1_API_KEY)
    return _client


async def llm_complete(system: str, user: str, max_tokens: int = 1024) -> str:
    def call() -> str:
        r = _llm().chat.completions.create(
            model=config.ASI1_MODEL,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            max_tokens=max_tokens,
        )
        return str(r.choices[0].message.content or "")

    return await asyncio.to_thread(call)


def parse_json_object(text: str) -> dict[str, Any]:
    """Pull the first {...} block out of an LLM reply (tolerates code fences and chatter)."""
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError(f"No JSON object in LLM output: {text[:200]!r}")
    return json.loads(match.group(0))


# --- ASI:One chat protocol -------------------------------------------------------------------------------------------

ChatAnswer = Callable[[Context, str, str], Awaitable[tuple[str, bool]]]  # (ctx, sender, text) -> (reply, end_session)
END_WORDS = {"bye", "end", "exit", "quit", "done", "stop"}


def make_chat_protocol(answer: ChatAnswer) -> Protocol:
    protocol = Protocol(spec=chat_protocol_spec)

    @protocol.on_message(ChatMessage)
    async def handle_message(ctx: Context, sender: str, msg: ChatMessage) -> None:
        await ctx.send(sender, ChatAcknowledgement(timestamp=datetime.now(timezone.utc), acknowledged_msg_id=msg.msg_id))
        text = "".join(item.text for item in msg.content if isinstance(item, TextContent)).strip()
        try:
            reply, end_session = await answer(ctx, sender, text)
        except Exception:
            ctx.logger.exception("chat handler failed")
            reply, end_session = "Sorry, something went wrong on my side. Please try again.", False
        content: list[Any] = [TextContent(type="text", text=reply)]
        if end_session:
            content.append(EndSessionContent(type="end-session"))
        await ctx.send(sender, ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=content))

    @protocol.on_message(ChatAcknowledgement)
    async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement) -> None:
        pass

    return protocol


LINK_HELP = 'Sign in to the MHacks app, request a one-time link code, then send "link <code>" here.'


def install_api_auth(app: FastAPI) -> None:
    """Require a verified Clerk token for user routes and an organizer token for catalog/admin writes."""
    @app.middleware("http")
    async def authenticate_request(request: Request, call_next: Callable[..., Awaitable[Any]]) -> Any:
        path = request.url.path
        if path == "/health":
            return await call_next(request)
        if request.method == "POST" and path in {"/events", "/followups/run"}:
            if not config.ORGANIZER_TOKEN:
                return JSONResponse({"detail": "Organizer access is not configured."}, status_code=503)
            supplied = request.headers.get("x-organizer-token", "")
            if not hmac.compare_digest(supplied, config.ORGANIZER_TOKEN):
                return JSONResponse({"detail": "Organizer authentication required."}, status_code=401)
            request.state.is_organizer = True
            return await call_next(request)

        authorization = request.headers.get("authorization", "")
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token:
            return JSONResponse({"detail": "Bearer authentication required."}, status_code=401)
        try:
            subject = await verify_token(token)
        except Exception:
            return JSONResponse({"detail": "Invalid or expired bearer token."}, status_code=401)
        try:
            user_id = await asyncio.to_thread(store.resolve_identity, subject)
        except Exception:
            log.exception("could not resolve authenticated account")
            return JSONResponse({"detail": "Authenticated account is not linked to a SpacetimeDB profile."}, status_code=403)
        request.state.auth_subject = subject
        request.state.auth_user_id = user_id
        return await call_next(request)


def assert_current_user(request: Request, user_id: str) -> None:
    if getattr(request.state, "auth_user_id", None) != user_id:
        raise HTTPException(403, "The requested user does not match the authenticated account.")


async def resolve_chat_user(ctx: Context, sender: str, text: str) -> tuple[str | None, str | None]:
    """Map an authenticated ASI:One sender to an account through a one-time code."""
    if text.strip().casefold() == "delete me":
        try:
            user_id = store.user_for_messaging(sender)
            if not user_id:
                return None, LINK_HELP
            async with profile_operation_lock(user_id):
                await delete_profile_vector(user_id)
                store.delete_account(user_id)
            return None, "Your account data has been deleted."
        except Exception:
            ctx.logger.exception("account deletion failed")
            return None, "I couldn't delete your account data right now. Please try again shortly."
    match = re.fullmatch(r"\s*link\s+([A-Za-z0-9_-]{16,96})\s*", text, re.IGNORECASE)
    if match:
        try:
            user_id = store.redeem_link_code(match.group(1), sender)
        except Exception as exc:
            ctx.logger.warning("account link failed: %s", exc)
            return None, "That link code is invalid or expired. Request a new one in the app."
        return user_id, "Your account is linked. Ask me anything."
    try:
        user_id = store.user_for_messaging(sender)
    except Exception:
        ctx.logger.exception("could not resolve ASI:One account link")
        return None, "I can't reach the account service right now. Please try again shortly."
    return (user_id, None) if user_id else (None, LINK_HELP)


def wants_end(text: str) -> bool:
    return text.lower().strip(" .!") in END_WORDS


# --- HTTP -> agent bridge ------------------------------------------------------------------------------------------------

class Outbox:
    """Lets HTTP/WebSocket handlers send agent messages: they enqueue, the agent drains via ctx.send."""

    def __init__(self, agent: Agent, period: float = 0.25) -> None:
        self._queue: asyncio.Queue[tuple[str, Model]] = asyncio.Queue()

        @agent.on_interval(period=period)
        async def drain(ctx: Context) -> None:
            while not self._queue.empty():
                destination, message = self._queue.get_nowait()
                await ctx.send(destination, message)

    def put(self, destination: str, message: Model) -> None:
        self._queue.put_nowait((destination, message))


def add_health(agent: Agent) -> None:
    """A REST route keeps the agent's own server (and Agentverse inspector) up on its port even with mailbox=True."""
    from models import HealthResponse

    @agent.on_rest_get("/health", HealthResponse)
    async def health(ctx: Context) -> HealthResponse:
        return HealthResponse(status="ok", agent=agent.name)


def run(loop: asyncio.AbstractEventLoop, agents: list[Agent], app: FastAPI, http_port: int) -> None:
    if not config.ASI1_API_KEY:
        logging.getLogger("common").warning("ASI1_API_KEY is empty (check .env); LLM features will fail")
    server = uvicorn.Server(uvicorn.Config(app, host=config.HTTP_HOST, port=http_port, log_level="info"))

    async def main() -> None:
        await asyncio.gather(server.serve(), *(agent.run_async() for agent in agents))

    try:
        loop.run_until_complete(main())
    except KeyboardInterrupt:
        pass
    finally:
        loop.close()


# --- Typed store access ----------------------------------------------------------------------------------------------------

def load(model: type[T], collection: str, key: str) -> T | None:
    data = store.get(collection, key)
    return model.model_validate(data) if data else None


def load_all(model: type[T], collection: str) -> list[T]:
    return [model.model_validate(d) for d in store.list(collection)]


def save(collection: str, key: str, record: BaseModel) -> None:
    store.put(collection, key, record.model_dump(mode="json"))
