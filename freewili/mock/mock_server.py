#!/usr/bin/env python3
"""A stand-in for the Photon bridge's badge API, for testing BridgeTransport without iMessage or Photon.

  python3 mock/mock_server.py 8799
  curl -XPOST localhost:8799/admin/phase -d '{"phase":"offer","matchId":"m1","reason":"also into CV"}'
  python3 main.py --phone "+15550100001" --bridge http://localhost:8799 --mock-device

Implements: POST /badge/register, GET /badge/<id>/state, POST /badge/<id>/{answer,presence,found},
plus POST /admin/phase to set what the badge sees next. Records every request in `log`.
"""
from __future__ import annotations

import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


class MockBridge:
    def __init__(self) -> None:
        self.state: dict[str, Any] = {"phase": "idle", "stats": {}}
        self.log: list[tuple[str, str, dict[str, Any]]] = []
        self.badges: dict[str, str] = {}

    def handle(self, method: str, path: str, body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        self.log.append((method, path, body))
        if path == "/admin/phase":
            self.state = {"stats": {}, **body}
            return 200, {"ok": True}
        if path == "/badge/register":
            self.badges[body["badge"]] = body["phone"]
            return 200, {"ok": True, "id": f"any;-;{body['phone']}", "name": "Test"}
        parts = path.strip("/").split("/")
        if len(parts) == 3 and parts[0] == "badge":
            if parts[1] not in self.badges:
                return 404, {"ok": False, "error": "unknown badge; register first"}
            action = parts[2]
            if method == "GET" and action == "state":
                return 200, self.state
            if action == "answer":
                self.state = {"phase": "waiting" if body.get("yes") else "idle", "matchId": self.state.get("matchId"), "stats": {}}
                return 200, {"ok": True}
            if action == "presence":
                self.state = {"phase": "idle" if body.get("open") else "offline", "stats": {}}
                return 200, {"ok": True}
            if action == "found":
                self.state = {"phase": "met", "matchId": body.get("matchId"), "stats": {}}
                return 200, {"ok": True}
        return 404, {"ok": False}

    def serve(self, port: int) -> ThreadingHTTPServer:
        bridge = self

        class H(BaseHTTPRequestHandler):
            def _do(self, method: str) -> None:
                n = int(self.headers.get("content-length") or 0)
                body = json.loads(self.rfile.read(n) or b"{}") if n else {}
                code, out = bridge.handle(method, self.path, body)
                data = json.dumps(out).encode()
                self.send_response(code)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self) -> None:  # noqa: N802
                self._do("GET")

            def do_POST(self) -> None:  # noqa: N802
                self._do("POST")

            def log_message(self, *a: Any) -> None:
                pass

        srv = ThreadingHTTPServer(("127.0.0.1", port), H)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        return srv


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8799
    MockBridge().serve(port)
    print(f"mock Photon bridge on http://localhost:{port}  (ctrl+C to stop)")
    threading.Event().wait()
