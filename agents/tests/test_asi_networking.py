import asyncio
import importlib
from datetime import datetime, timezone
from uuid import uuid4

from uagents_core.contrib.protocols.chat import ChatMessage, ChatAcknowledgement, TextContent


def transport():
    return importlib.import_module('asi_networking_agent')


def test_session_and_request_keys_isolate_senders_sessions_and_retries():
    app = transport()
    a = app.session_key('agent-a', 'sender-a', 'session-a')
    assert a != app.session_key('agent-a', 'sender-b', 'session-a')
    assert a != app.session_key('agent-a', 'sender-a', 'session-b')
    assert app.request_key(a, 'message-a') == app.request_key(a, 'message-a')
    assert app.request_key(a, 'message-a') != app.request_key(a, 'message-b')


def test_protocol_acknowledges_then_returns_backend_result_with_stable_request(ctx):
    app = transport()
    ctx.session = uuid4()
    calls = []
    async def backend(payload):
        calls.append(payload)
        return {'reply': 'Your draft was saved.'}
    protocol = app.make_protocol('agent-a', backend)
    msg = ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=[TextContent(type='text', text='Help me follow up')])
    handler = next(fn for fn in protocol.signed_message_handlers.values() if fn.__name__ == 'handle_message')
    asyncio.run(handler(ctx, 'sender-a', msg))
    assert isinstance(ctx.sent[0][1], ChatAcknowledgement)
    assert ctx.sent[0][1].acknowledged_msg_id == msg.msg_id
    assert ctx.sent[1][1].content[0].text == 'Your draft was saved.'
    assert calls[0]['message'] == 'Help me follow up'
    first = calls[0]['requestId']
    asyncio.run(handler(ctx, 'sender-a', msg))
    assert calls[1]['requestId'] == first


def test_protocol_rejects_missing_session_and_reports_backend_failure(ctx):
    app = transport()
    calls = []
    async def backend(payload):
        calls.append(payload)
        raise RuntimeError('secret server token')
    protocol = app.make_protocol('agent-a', backend)
    handler = next(fn for fn in protocol.signed_message_handlers.values() if fn.__name__ == 'handle_message')
    msg = ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=[TextContent(type='text', text='Hi')])
    ctx.session = None
    asyncio.run(handler(ctx, 'sender-a', msg))
    assert not calls
    assert 'session' in ctx.sent[-1][1].content[0].text.lower()
    ctx.session = uuid4()
    asyncio.run(handler(ctx, 'sender-a', msg))
    answer = ctx.sent[-1][1].content[0].text
    assert 'secret' not in answer
    assert 'retry' in answer.lower()
