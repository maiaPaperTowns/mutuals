"""Inspect cloud storage and vector status without printing profiles or credentials."""
from __future__ import annotations

import json
import tomllib
import urllib.request
from collections import Counter
from pathlib import Path

import config
from integrations import pinecone_client


def main() -> None:
    path = Path.home() / 'AppData/Local/SpacetimeDB/config/cli.toml'
    token = tomllib.loads(path.read_text())['spacetimedb_token']

    def rows(query: str) -> list:
        request = urllib.request.Request('https://maincloud.spacetimedb.com/v1/database/mhacks-live-map/sql',
            data=query.encode(), headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'text/plain'})
        with urllib.request.urlopen(request, timeout=30) as response:
            return [row for result in json.load(response) for row in result.get('rows', [])]

    profiles = [json.loads(row[0]) for row in rows('SELECT payload_json FROM agent_profile')]
    ids = [profile['user_id'] for profile in profiles]
    client = pinecone_client()
    index = client.Index(host=client.describe_index(config.PINECONE_INDEX).host)
    found = index.fetch(ids=ids, namespace='profiles').vectors if ids else {}
    counts = {table: rows(f'SELECT COUNT(*) AS count FROM {table}')[0][0]
              for table in ('user_profile', 'event', 'agent_presence', 'interaction', 'follow_up_plan')}
    print(json.dumps({'database': 'mhacks-live-map', 'counts': counts,
        'private_profiles': len(profiles), 'profile_index_states': dict(Counter(profile.get('vector_status', 'unknown') for profile in profiles)),
        'profile_vectors_fetched': len(found), 'all_profile_vectors_present': all(user_id in found for user_id in ids)}))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'Cloud state check failed: {type(exc).__name__}')
        raise SystemExit(1)
