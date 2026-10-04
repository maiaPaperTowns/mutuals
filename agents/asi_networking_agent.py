"""ACP transport for the native mutuals Pre/Post backend; no business data lives here."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from uuid import uuid4

from uagents import Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement, ChatMessage, EndSessionContent, TextContent, chat_protocol_spec,
)


def session_key(address: str, sender: str, session: str) -> str:
    return hashlib.sha256(json.dumps([address, sender, session]).encode()).hexdigest()


def request_key(session: str, message_id: str) -> str:
    return 'asi_' + hashlib.sha256(json.dumps([session, message_id]).encode()).hexdigest()


def make_protocol(address: str, backend) -> Protocol:
    protocol = Protocol(spec=chat_protocol_spec)

    @protocol.on_message(ChatMessage)
    async def handle_message(ctx: Context, sender: str, msg: ChatMessage):
        await ctx.send(sender, ChatAcknowledgement(timestamp=datetime.now(timezone.utc), acknowledged_msg_id=msg.msg_id))
        text = ''.join(item.text for item in msg.content if isinstance(item, TextContent)).strip()
        ended = any(isinstance(item, EndSessionContent) for item in msg.content)
        session = getattr(ctx, 'session', None)
        reply = 'Welcome to mutuals. I help with event preparation and follow-up. Link your website account with link <code>.'
        if not session:
            reply = 'A verified chat session is required. Please start a new ASI:One session.'
        elif text or ended:
            key = session_key(address, sender, str(session))
            # Metadata only: never log the message, binding code or private reply.
            ctx.logger.info(f'ACP session={key} request={request_key(key, str(msg.msg_id))}')
            try:
                result = await backend({'sessionKey': key, 'requestId': request_key(key, str(msg.msg_id)),
                                        'message': 'unlink' if ended else text})
                reply = result['reply']
            except Exception:
                reply = 'The mutuals service could not complete this request. Please retry.'
        content = [TextContent(type='text', text=reply)]
        if ended:
            content.append(EndSessionContent(type='end-session'))
        await ctx.send(sender, ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=content))

    @protocol.on_message(ChatAcknowledgement)
    async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
        pass

    return protocol


