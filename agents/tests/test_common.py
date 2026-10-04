import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from uagents_core.contrib.protocols.chat import ChatAcknowledgement, ChatMessage, EndSessionContent, TextContent

import common


def chat(text: str) -> ChatMessage:
    return ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=[TextContent(type="text", text=text)])


def handlers(protocol) -> dict:
    funcs = {**protocol._signed_message_handlers, **protocol._unsigned_message_handlers}.values()
    return {f.__name__: f for f in funcs}


def test_parse_json_object_tolerates_fences_and_chatter():
    assert common.parse_json_object('Sure!\n```json\n{"a": [1, 2]}\n```') == {"a": [1, 2]}
    with pytest.raises(ValueError):
        common.parse_json_object("no json here")


def test_resolve_chat_user_link_flow(ctx):
    assert asyncio.run(common.resolve_chat_user(ctx, "agent1x", "hello")) == (None, common.LINK_HELP)
    user_id, reply = asyncio.run(common.resolve_chat_user(ctx, "agent1x", "link test-link-alice-0123456789abcdef"))
    assert user_id == "alice" and "linked" in reply
    assert asyncio.run(common.resolve_chat_user(ctx, "agent1x", "which events?")) == ("alice", None)


@pytest.mark.parametrize("text,expected", [("bye", True), ("Done!", True), ("bye for now", False), ("hi", False)])
def test_wants_end(text, expected):
    assert common.wants_end(text) is expected


def test_chat_protocol_acks_then_replies(ctx):
    async def answer(c, sender, text):
        return f"echo:{text}", text == "bye"

    on_message = handlers(common.make_chat_protocol(answer))["handle_message"]
    msg = chat("hi")
    asyncio.run(on_message(ctx, "agent1user", msg))
    (_, ack), (_, reply) = ctx.sent
    assert isinstance(ack, ChatAcknowledgement) and ack.acknowledged_msg_id == msg.msg_id
    assert reply.content[0].text == "echo:hi" and len(reply.content) == 1

    ctx.sent.clear()
    asyncio.run(on_message(ctx, "agent1user", chat("bye")))
    assert isinstance(ctx.sent[1][1].content[-1], EndSessionContent)


def test_chat_protocol_survives_answer_errors(ctx):
    async def broken(c, sender, text):
        raise RuntimeError("boom")

    asyncio.run(handlers(common.make_chat_protocol(broken))["handle_message"](ctx, "agent1user", chat("hi")))
    assert "something went wrong" in ctx.sent[1][1].content[0].text


def test_llm_complete_uses_asi1_settings(monkeypatch):
    seen = {}

    def create(**kwargs):
        seen.update(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))])

    fake = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    monkeypatch.setattr(common, "_llm", lambda: fake)
    assert asyncio.run(common.llm_complete("sys", "user")) == "ok"
    assert seen["model"] == "asi1" and seen["messages"][0] == {"role": "system", "content": "sys"}


def test_llm_client_requires_key(monkeypatch):
    monkeypatch.setattr(common, "_client", None)
    monkeypatch.setattr(common.config, "ASI1_API_KEY", "")
    with pytest.raises(RuntimeError, match="ASI1_API_KEY"):
        common._llm()


def test_outbox_queues_messages():
    from models import ParticipantLeft
    from uagents import Agent

    agent = Agent(name="outbox-test", seed="outbox-test-seed-0123456789", loop=asyncio.new_event_loop())
    box = common.Outbox(agent)
    box.put("agent1dest", ParticipantLeft(user_id="u"))
    assert box._queue.get_nowait()[1].user_id == "u"
