"""Temporary live-upload check; print only synthetic verification results."""
import json
import sys
import tomllib
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'agents'))
import config
from integrations import pinecone_client

BACKUP = ROOT / 'reports/.resume-upload-private-backup.json'
token = tomllib.loads((Path.home() / 'AppData/Local/SpacetimeDB/config/cli.toml').read_text())['spacetimedb_token']


def sql(query):
    request = urllib.request.Request('https://maincloud.spacetimedb.com/v1/database/mhacks-live-map/sql',
        data=query.encode(), headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'text/plain'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return [row for result in json.load(response) for row in result.get('rows', [])]


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def main():
    mode = sys.argv[1]
    if mode == 'backup':
        if BACKUP.exists():
            raise RuntimeError('Backup already exists')
        profiles = sql('SELECT user_id, payload_json FROM agent_profile')
        if len(profiles) != 1 or json.loads(profiles[0][1]).get('name') != 'terry':
            raise RuntimeError('Expected one known testing account')
        user_id, profile = profiles[0]
        map_profile = sql(f'SELECT agent_profile_json FROM user_profile WHERE identity = 0x{user_id}')[0][0]
        BACKUP.write_text(json.dumps({'id': user_id, 'profile': profile, 'map': map_profile}), encoding='utf-8')
        print(json.dumps({'private_profile_backup': True}))
        return
    saved = json.loads(BACKUP.read_text(encoding='utf-8'))
    user_id = saved['id']
    current = sql(f'SELECT payload_json FROM agent_profile WHERE user_id = {quote(user_id)}')[0][0]
    current_map = sql(f'SELECT agent_profile_json FROM user_profile WHERE identity = 0x{user_id}')[0][0]
    if mode == 'abort':
        if current != saved['profile'] or current_map != saved['map']:
            raise RuntimeError('Profile changed; keeping backup for review')
        BACKUP.unlink()
        print(json.dumps({'original_private_profile_unchanged': True, 'temporary_backup_removed': True}))
        return
    client = pinecone_client()
    index = client.Index(host=client.describe_index(config.PINECONE_INDEX).host)
    if mode == 'inspect':
        profile = json.loads(current)
        found = index.fetch(ids=[user_id], namespace='profiles').vectors
        saved.update(tested=current, tested_map=current_map)
        BACKUP.write_text(json.dumps(saved), encoding='utf-8')
        print(json.dumps({'test_pdf_filename_saved': profile.get('resume_filename') == 'resume-upload-smoke-test.pdf',
            'test_skills_extracted': all(skill in profile.get('skills', []) for skill in ('Rust', 'GraphQL')),
            'vector_status': profile.get('vector_status'), 'vector_present': user_id in found}))
    elif mode == 'restore':
        if current != saved.get('tested') or current_map != saved.get('tested_map'):
            raise RuntimeError('Profile changed after test inspection; refusing to overwrite')
        if sql(f'SELECT COUNT(*) AS count FROM cloud_operation WHERE user_id = {quote(user_id)}')[0][0]:
            raise RuntimeError('A profile operation is still running')
        original = json.loads(saved['profile'])
        index.upsert(vectors=[{'id': user_id, 'values': original['embedding']}], namespace='profiles')
        sql(f'UPDATE agent_profile SET payload_json = {quote(saved["profile"])} WHERE user_id = {quote(user_id)} AND payload_json = {quote(current)}')
        sql(f'UPDATE user_profile SET agent_profile_json = {quote(saved["map"])} WHERE identity = 0x{user_id} AND agent_profile_json = {quote(current_map)}')
        restored = sql(f'SELECT payload_json FROM agent_profile WHERE user_id = {quote(user_id)}')[0][0]
        restored_map = sql(f'SELECT agent_profile_json FROM user_profile WHERE identity = 0x{user_id}')[0][0]
        if restored != saved['profile'] or restored_map != saved['map']:
            raise RuntimeError('Restoration did not complete')
        print(json.dumps({'original_private_profile_restored': True, 'original_vector_restore_requested': True}))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('Resume probe failed: ' + type(exc).__name__)
        raise SystemExit(1)
