"""Hosted transport adapter; all account permissions and business logic stay native."""
import json
import re


class NativeChatBackend:
    def __init__(self, rpc):
        self.rpc = rpc

    async def __call__(self, payload):
        key, request, message = payload['sessionKey'], payload['requestId'], payload['message'].strip()
        if message.lower() == 'unlink':
            await self.rpc('unlink_asi_chat', [key])
            return {'reply': 'This chat is disconnected from your mutuals account.'}
        if re.match(r'^link\s+', message, re.I):
            code = re.sub(r'^link\s+', '', message, flags=re.I).strip()
            if not re.fullmatch(r'[a-f0-9]{32}', code):
                return {'reply': 'Use link <code> with the five-minute code from your website account.'}
            try:
                await self.rpc('redeem_asi_link_code', [code, key, request])
                return {'reply': 'Your mutuals account is linked to this chat for up to 24 hours. Send events to choose an event; send unlink to disconnect.'}
            except RuntimeError as e:
                if re.search(r'code|profile|switching accounts', str(e), re.I):
                    return {'reply': 'The code could not be redeemed. Save your website profile and generate a new code; unlink first to switch accounts.'}
                raise
        try:
            context = json.loads(await self.rpc('get_asi_chat_context', [key]))
        except RuntimeError as e:
            if re.search(r'authorization|link.*again|website profile', str(e), re.I):
                return {'reply': 'Link your account first: sign in at https://mutuals.tech/events, generate a code, then send link <code>. Pre and Post work here; During uses website GPS.'}
            raise
        events = context['events']
        choices = '\n'.join(f"{e['title']} ({e['phase']}) — event {e['event_id']}" for e in events)
        if message.lower() == 'events':
            return {'reply': choices or 'You have not joined an event on the mutuals website yet.'}
        if re.match(r'^event\s+', message, re.I):
            event_id = re.sub(r'^event\s+', '', message, flags=re.I).strip()
            selected = next((e for e in events if e['event_id'] == event_id), None)
            if not selected:
                return {'reply': 'That event is unavailable to your account.\n' + choices}
            await self.rpc('select_asi_event', [key, event_id])
            return {'reply': f"Selected {selected['title']} ({selected['phase']}). Ask your Pre/Post assistant a question. In Post, send recap."}
        selected = next((e for e in events if e['event_id'] == context['selected_event_id']), None)
        if not selected and len(events) == 1:
            selected = events[0]
        if not selected:
            return {'reply': 'Select an event by sending its event command:\n' + choices if events else 'Join an event on the mutuals website first.'}
        if message.lower() in ('recap', '回顾', '总结活动') and selected['phase'] == 'post':
            return json.loads(await self.rpc('generate_asi_event_recap', [key, selected['event_id'], request]))
        return json.loads(await self.rpc('send_asi_assistant_message', [key, selected['event_id'], message, request]))
