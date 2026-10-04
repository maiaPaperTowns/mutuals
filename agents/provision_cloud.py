"""Provision private SpacetimeDB provider configuration from ignored local credentials."""
from __future__ import annotations

import json
import re
import subprocess
import tomllib
import urllib.error
import urllib.request
from pathlib import Path

import config
from integrations import pinecone_client


def main() -> None:
    root = Path.home() / 'AppData/Local/SpacetimeDB'
    token = tomllib.loads((root / 'config/cli.toml').read_text())['spacetimedb_token']
    login = subprocess.run([str(root / 'spacetime.exe'), 'login', 'show'], capture_output=True, text=True, check=True)
    match = re.search(r'logged in as ([0-9a-f]{64})', login.stdout)
    if not match:
        raise RuntimeError('Could not determine the logged-in administrator identity')
    if not config.ASI1_API_KEY or not config.PINECONE_API_KEY:
        raise RuntimeError('Configure both provider keys in the ignored agents/.env')
    index = pinecone_client().describe_index(config.PINECONE_INDEX)
    if index.dimension != 1024 or index.metric != 'cosine':
        raise RuntimeError('The cloud backend requires a 1024-dimensional cosine index')
    values = {'asi_api_key': config.ASI1_API_KEY, 'pinecone_api_key': config.PINECONE_API_KEY,
              'pinecone_host': 'https://' + index.host}

    def sql(query: str) -> list:
        request = urllib.request.Request('https://maincloud.spacetimedb.com/v1/database/mhacks-live-map/sql',
            data=query.encode(), headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'text/plain'})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f'SpacetimeDB administration returned HTTP {exc.code}') from None

    existing = {row[0] for result in sql('SELECT name FROM cloud_provider_config') for row in result.get('rows', [])}
    for name, value in values.items():
        if name in existing:
            sql(f"DELETE FROM cloud_provider_config WHERE name = '{name}'")
        escaped = value.replace("'", "''")
        sql(f"INSERT INTO cloud_provider_config (name, value) VALUES ('{name}', '{escaped}')")
    admins = sql('SELECT COUNT(*) AS count FROM cloud_admin')
    if not any(row[0] for result in admins for row in result.get('rows', [])):
        sql(f"INSERT INTO cloud_admin (identity) VALUES (0x{match.group(1)})")
    print(json.dumps({'database': 'mhacks-live-map', 'private_provider_configuration': 'provisioned',
                      'administrator': 'provisioned', 'index': config.PINECONE_INDEX}))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # Never print SQL text, HTTP request headers or provider credential values.
        print(f'Cloud provisioning failed: {type(exc).__name__}')
        raise SystemExit(1)
