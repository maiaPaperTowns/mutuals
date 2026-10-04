"""Verify real Pinecone inference and vector storage using temporary synthetic data."""

from __future__ import annotations

import asyncio
import json
from uuid import uuid4

import config
from integrations import VectorDBClient, embed


async def main() -> None:
    client = VectorDBClient()
    index = await asyncio.to_thread(client._get_index)
    print(f"Connected to Pinecone index {config.PINECONE_INDEX}", flush=True)
    values = await embed("Synthetic connection check: a Python engineer interested in machine learning.")
    if len(values) != config.PINECONE_DIMENSION:
        raise ValueError("Embedding dimension does not match the configured index")
    namespace = f"connection-check-{uuid4().hex}"
    key = "synthetic-check"
    try:
        await client.upsert(namespace, key, values, {"synthetic": True})
        for _ in range(45):
            fetched = await asyncio.to_thread(index.fetch, ids=[key], namespace=namespace)
            matches = await client.query(namespace, values, top_k=1)
            if key in fetched.vectors and matches and matches[0].id == key:
                break
            await asyncio.sleep(1)
        else:
            raise TimeoutError("Test vector was not visible to fetch and query within 45 polls")
        print(json.dumps({"inference": "passed", "model": config.PINECONE_EMBED_MODEL,
                          "dimension": len(values), "upsert": "passed", "fetch": "passed",
                          "query": "passed", "self_similarity": round(matches[0].score, 4)}), flush=True)
    finally:
        await client.delete(namespace, key)
        for _ in range(45):
            fetched = await asyncio.to_thread(index.fetch, ids=[key], namespace=namespace)
            if key not in fetched.vectors:
                break
            await asyncio.sleep(1)
        else:
            raise TimeoutError("Test vector deletion was not visible within 45 polls")
        print("Temporary synthetic vector deleted and absence verified.", flush=True)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        # SDK exceptions can include request details; never echo credentials.
        message = str(exc)
        for secret in (config.PINECONE_API_KEY, config.ASI1_API_KEY):
            if secret:
                message = message.replace(secret, "[redacted]")
        print(f"Pinecone check failed ({type(exc).__name__}): {message[:500]}")
        raise SystemExit(1)
