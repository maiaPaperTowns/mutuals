import asyncio
import json
import importlib
import runpy


def test_hosted_link_and_authorization_use_native_scoped_procedures():
    app = importlib.import_module('asi_hosted_backend')
    calls = []
    async def rpc(name, args):
        calls.append((name, args))
        if name == 'get_asi_chat_context':
            raise RuntimeError('Chat authorization unavailable. Link again.')
        return '{"linked":true}'
    backend = app.NativeChatBackend(rpc)
    payload = {'sessionKey': 'a' * 64, 'requestId': 'asi-one', 'message': 'link ' + 'b' * 32}
    assert 'linked' in asyncio.run(backend(payload))['reply']
    assert calls == [('redeem_asi_link_code', ['b' * 32, 'a' * 64, 'asi-one'])]
    assert 'Link your account first' in asyncio.run(backend({**payload, 'message': 'events'}))['reply']


def test_hosted_keeps_event_selection_and_exact_request_ids_in_cloud():
    app = importlib.import_module('asi_hosted_backend')
    calls = []
    async def rpc(name, args):
        calls.append((name, args))
        if name == 'get_asi_chat_context':
            return json.dumps({'events': [{'event_id': 'e1', 'title': 'One', 'phase': 'post'}, {'event_id': 'e2', 'title': 'Two', 'phase': 'pre'}], 'selected_event_id': 'e1'})
        return '{"reply":"Actual cloud result"}'
    backend = app.NativeChatBackend(rpc)
    payload = {'sessionKey': 'a' * 64, 'requestId': 'asi-one', 'message': 'recap'}
    assert asyncio.run(backend(payload))['reply'] == 'Actual cloud result'
    assert calls[-1] == ('generate_asi_event_recap', ['a' * 64, 'e1', 'asi-one'])
    assert 'unavailable' in asyncio.run(backend({**payload, 'message': 'event victim-event'}))['reply']
    assert calls[-1][0] == 'get_asi_chat_context'
    asyncio.run(backend({**payload, 'message': 'Please save a draft'}))
    assert calls[-1] == ('send_asi_assistant_message', ['a' * 64, 'e1', 'Please save a draft', 'asi-one'])


def test_hosted_artifact_uses_the_preloaded_agent_without_a_local_runtime(monkeypatch):
    app = importlib.import_module('build_asi_hosted')
    included = []
    class HostedAgent:
        address = 'test-hosted-agent'
        def include(self, protocol, publish_manifest):
            included.append((protocol, publish_manifest))
    monkeypatch.setenv('ASI_CHAT_ENABLED', 'false')
    scope = runpy.run_path(str(app.build()), init_globals={'agent': HostedAgent()})
    assert len(included) == 1 and included[0][1]
    assert asyncio.run(scope['backend']({'message': 'hello'}))['reply'].startswith('mutuals Hosted ACP is online')
