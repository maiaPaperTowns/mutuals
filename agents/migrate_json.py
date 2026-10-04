"""Idempotently import the six ASI JSON collections into the SpacetimeDB gateway."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


COLLECTIONS = {
    "profiles": "user_id",
    "events": "event_id",
    "interactions": "interaction_id",
    "transcripts": "interaction_id",
    "plans": "plan_id",
    "roi_history": "entry_id",
}


def request(method: str, path: str, token: str, body: Any = None) -> Any:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        path,
        data=data,
        method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        raw = response.read()
    return json.loads(raw) if raw else None


def main() -> int:
    root = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent / "data"))
    base = os.environ.get("SPACETIME_GATEWAY_URL", "http://127.0.0.1:8110").rstrip("/") + "/api/collections"
    token = os.environ.get("SPACETIME_GATEWAY_TOKEN", "")
    if not token:
        print("SPACETIME_GATEWAY_TOKEN is required.", file=sys.stderr)
        return 2

    failures = 0
    for collection, key_field in COLLECTIONS.items():
        folder = root / collection
        if not folder.exists():
            print(f"{collection}: source directory missing; skipped")
            continue
        endpoint = f"{base}/{collection}"
        existing = {row.get(key_field) for row in request("GET", endpoint, token) if row.get(key_field)}
        imported = skipped = failed = 0
        for path in sorted(folder.glob("*.json")):
            try:
                value = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(value, dict):
                    raise ValueError("record must be a JSON object")
                key = value.get(key_field)
                if not isinstance(key, str) or not key:
                    raise ValueError(f"missing {key_field}")
                if key in existing:
                    skipped += 1
                    continue
                quoted = urllib.parse.quote(key, safe="")
                request("PUT", f"{endpoint}/{quoted}", token, value)
                existing.add(key)
                imported += 1
            except (OSError, json.JSONDecodeError, ValueError, urllib.error.URLError, urllib.error.HTTPError) as exc:
                failed += 1
                failures += 1
                print(f"{collection}/{path.name}: {exc}", file=sys.stderr)
        print(f"{collection}: imported={imported} skipped_existing={skipped} failed={failed}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
