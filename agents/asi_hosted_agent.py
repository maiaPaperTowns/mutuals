"""Hosted entry point; build_asi_hosted.py creates the uploadable single-file artifact."""
import os
import httpx
from asi_networking_agent import make_protocol
from asi_hosted_backend import NativeChatBackend


async def native_rpc(name, args):
    token = os.environ.get('ASI_CHAT_SERVICE_TOKEN', '')
    if not token:
        raise RuntimeError('The dedicated service secret is not configured.')
    url = 'https://maincloud.spacetimedb.com/v1/database/mhacks-live-map/call/' + name
    async with httpx.AsyncClient(timeout=180) as client:
        response = await client.post(url, json=args, headers={'Authorization': 'Bearer ' + token})
    if not response.is_success:
        # Read native authorization errors, but never log raw responses/credentials.
        raise RuntimeError(response.text)
    return response.json() if response.content else None


async def backend(payload):
    if os.environ.get('ASI_CHAT_ENABLED', 'false').lower() != 'true':
        return {'reply': 'mutuals Hosted ACP is online. Private account access is not enabled yet. I support Pre and Post; During uses website GPS.'}
    return await NativeChatBackend(native_rpc)(payload)


# Agentverse provides this instance and its identity. Do not create a local Agent,
# run a listener, load .env, or copy a website/administrator token into this file.
agent.include(make_protocol(agent.address, backend), publish_manifest=True)  # noqa: F821
