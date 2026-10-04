import asyncio
from types import SimpleNamespace

import pytest

import integrations
import pre_event
from common import load, save
from integrations import EVENTS, PROFILES, VectorDBClient
from models import UserProfile


class FakeIndex:
    def __init__(self):
        self.records = {}

    def upsert(self, *, vectors, namespace, **kwargs):
        for vector in vectors:
            self.records[(namespace, vector['id'])] = vector

    def query(self, *, vector, top_k, namespace, filter, include_metadata):
        return SimpleNamespace(matches=[SimpleNamespace(id=key, score=0.9, metadata=row['metadata'])
                                       for (ns, key), row in self.records.items() if ns == namespace][:top_k])

    def delete(self, *, ids, namespace):
        for key in ids:
            self.records.pop((namespace, key), None)


class FakePinecone:
    def __init__(self):
        self.index = FakeIndex()
        self.created = []
        self.embed_calls = []
        self.dimension = 1024
        self.inference = SimpleNamespace(embed=self.embed)

    def has_index(self, name):
        return bool(self.created)

    def create_index(self, **kwargs):
        self.created.append(kwargs)

    def describe_index(self, name):
        return SimpleNamespace(dimension=self.dimension, metric='cosine', host='fake-host')

    def Index(self, **kwargs):
        return self.index

    def embed(self, *, model, inputs, parameters):
        self.embed_calls.append((model, inputs, parameters))
        return SimpleNamespace(data=[SimpleNamespace(values=[0.1] * self.dimension)])


@pytest.fixture
def pc(monkeypatch):
    fake = FakePinecone()
    monkeypatch.setattr(integrations, 'pinecone_client', lambda key=None: fake, raising=False)
    monkeypatch.setattr(pre_event, 'vectors', VectorDBClient())
    return fake


def test_vector_roundtrip_and_metadata_cleaning(pc):
    client = VectorDBClient()
    asyncio.run(client.upsert(PROFILES, 'u', [0.1] * 1024, {'name': 'Test', 'absent': None, 'skills': ['python']}))
    assert pc.created[0]['dimension'] == 1024 and pc.created[0]['metric'] == 'cosine'
    matches = asyncio.run(client.query(PROFILES, [0.1] * 1024, 1))
    assert matches[0].id == 'u' and matches[0].score == 0.9
    assert matches[0].metadata == {'name': 'Test', 'skills': ['python']}
    asyncio.run(client.delete(PROFILES, 'u'))
    assert pc.index.records == {}


def test_incompatible_existing_index_is_not_overwritten(pc):
    pc.created.append({})
    pc.dimension = 3
    with pytest.raises(ValueError, match='dimension'):
        asyncio.run(VectorDBClient().upsert(PROFILES, 'u', [0.1] * 1024, {}))
    assert pc.created == [{}]


def test_hosted_embedding_uses_configured_dimensions(pc):
    assert len(asyncio.run(integrations.embed('Python engineer'))) == 1024
    model, inputs, parameters = pc.embed_calls[0]
    assert model == 'llama-text-embed-v2' and inputs == ['Python engineer']
    assert parameters['dimension'] == 1024 and parameters['input_type'] == 'passage'


def test_profile_index_uses_canonical_fields(monkeypatch, pc):
    put = integrations.store.put

    def canonical(collection, key, value):
        value.update(name='Map name', headline='Map headline', interests=['map interest'])
        put(collection, key, value)

    monkeypatch.setattr(integrations.store, 'put', canonical)
    result = asyncio.run(pre_event.index_and_save(UserProfile(user_id='u', name='Resume name', experience=['Vision lab'])))
    assert result.name == 'Map name'
    text = pc.embed_calls[0][1][0]
    assert 'Map headline' in text and 'map interest' in text and 'Vision lab' in text
    assert pc.index.records[(PROFILES, 'u')]['metadata']['name'] == 'Map name'


def test_provider_outage_keeps_profile_and_scans_events(monkeypatch, seeded):
    async def down(*args, **kwargs):
        raise ConnectionError('provider unavailable')

    monkeypatch.setattr(pre_event, 'embed', down)
    profile = asyncio.run(pre_event.index_and_save(UserProfile(user_id='u', skills=['python'])))
    assert load(UserProfile, PROFILES, 'u').skills == ['python']
    profile.embedding = [0.1] * 1024
    monkeypatch.setattr(pre_event.vectors, 'query', down)
    assert len(asyncio.run(pre_event.candidate_events(profile))) == len(integrations.store.list(EVENTS))


def test_empty_vector_candidates_fall_back_to_database(monkeypatch, seeded):
    async def empty(*args, **kwargs):
        return []

    monkeypatch.setattr(pre_event.vectors, 'query', empty)
    assert asyncio.run(pre_event.candidate_events(UserProfile(user_id='u', embedding=[0.1])))


def test_mixed_catalog_includes_events_without_vectors(monkeypatch, seeded):
    events = integrations.store.list(EVENTS)
    events[0]['embedding'] = [0.1]
    integrations.store.put(EVENTS, events[0]['event_id'], events[0])

    async def indexed_only(*args, **kwargs):
        return [integrations.VectorMatch(events[0]['event_id'], 0.9)]

    monkeypatch.setattr(pre_event.vectors, 'query', indexed_only)
    candidates = asyncio.run(pre_event.candidate_events(UserProfile(user_id='u', embedding=[0.1])))
    assert {event.event_id for event in candidates} == {event['event_id'] for event in events}


@pytest.mark.parametrize('stage', ['embed', 'upsert'])
def test_inflight_indexing_does_not_recreate_deleted_account(monkeypatch, pc, stage):
    async def delete_during_embed(text):
        integrations.store.delete_account('u')
        return [0.1] * 1024

    async def delete_during_upsert(*args, **kwargs):
        await VectorDBClient().upsert(*args, **kwargs)
        integrations.store.delete_account('u')

    if stage == 'embed':
        monkeypatch.setattr(pre_event, 'embed', delete_during_embed)
    else:
        monkeypatch.setattr(pre_event.vectors, 'upsert', delete_during_upsert)
    with pytest.raises(RuntimeError, match='deleted'):
        asyncio.run(pre_event.index_and_save(UserProfile(user_id='u', skills=['python'])))
    assert load(UserProfile, PROFILES, 'u') is None
    assert (PROFILES, 'u') not in pc.index.records


def test_inflight_embedding_does_not_overwrite_newer_profile(monkeypatch, pc):
    async def update_during_embed(text):
        profile = load(UserProfile, PROFILES, 'u')
        profile.goals = ['new goal']
        profile.updated_at = profile.updated_at.replace(year=profile.updated_at.year + 1)
        save(PROFILES, 'u', profile)
        return [0.1] * 1024

    monkeypatch.setattr(pre_event, 'embed', update_during_embed)
    result = asyncio.run(pre_event.index_and_save(UserProfile(user_id='u', goals=['old goal'])))
    assert result.goals == ['new goal'] and result.embedding is None
    assert (PROFILES, 'u') not in pc.index.records


@pytest.mark.parametrize('channel', ['http', 'messaging'])
def test_account_deletion_waits_for_inflight_vector_write(monkeypatch, pc, ctx, channel):
    import common
    from fastapi import Request

    async def scenario():
        started, release = asyncio.Event(), asyncio.Event()

        async def paused_upsert(*args, **kwargs):
            started.set()
            await release.wait()
            await VectorDBClient().upsert(*args, **kwargs)

        monkeypatch.setattr(pre_event.vectors, 'upsert', paused_upsert)
        monkeypatch.setattr(integrations.store, 'user_for_messaging', lambda sender: 'u')
        indexing = asyncio.create_task(pre_event.index_and_save(UserProfile(user_id='u')))
        await asyncio.wait_for(started.wait(), 3)
        if channel == 'http':
            request = Request({'type': 'http', 'state': {'auth_user_id': 'u'}})
            deletion = asyncio.create_task(pre_event.delete_my_account(request))
        else:
            deletion = asyncio.create_task(common.resolve_chat_user(ctx, 'sender', 'DELETE ME'))
        await asyncio.sleep(0.05)
        release.set()
        await indexing
        await deletion

    asyncio.run(scenario())
    assert load(UserProfile, PROFILES, 'u') is None
    assert (PROFILES, 'u') not in pc.index.records


def test_http_account_deletion_removes_profile_vector(monkeypatch, pc):
    from fastapi import Request

    save(PROFILES, 'u', UserProfile(user_id='u'))
    pc.index.records[(PROFILES, 'u')] = {'id': 'u'}
    request = Request({'type': 'http', 'state': {'auth_user_id': 'u'}})
    assert asyncio.run(pre_event.delete_my_account(request)) == {'status': 'deleted'}
    assert (PROFILES, 'u') not in pc.index.records


def test_messaging_account_deletion_removes_profile_vector(monkeypatch, ctx, pc):
    import common

    save(PROFILES, 'u', UserProfile(user_id='u'))
    pc.index.records[(PROFILES, 'u')] = {'id': 'u'}
    monkeypatch.setattr(integrations.store, 'user_for_messaging', lambda sender: 'u')
    assert 'deleted' in asyncio.run(common.resolve_chat_user(ctx, 'sender', 'DELETE ME'))[1]
    assert (PROFILES, 'u') not in pc.index.records
