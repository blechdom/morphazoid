#!/usr/bin/env python3
"""Run Morphazoid on the first available localhost port."""

from __future__ import annotations

import argparse
import errno
import http.client
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


DEFAULT_PORT = 3435
PORT_ATTEMPTS = 100
PROJECT_ROOT = Path(__file__).resolve().parent.parent
NATIVE_DELAY_PORT = 3436
NATIVE_DELAY_PREFIX = "/api/l-system-delay/"
NATIVE_DELAY_ACTIONS = {
    "GET": {"state", "status", "preview"},
    "POST": {"parameters", "performance", "audio", "strike", "reset"},
}
MAX_NATIVE_CONTROL_BODY = 16 * 1024


def valid_native_proxy_origin(host: str | None, origin: str | None, port: int) -> bool:
    """Only this loopback webapp may forward native device controls."""
    hosts = {f"localhost:{port}", f"127.0.0.1:{port}"}
    return host in hosts and (origin is None or origin == f"http://{host}")


class DevelopmentRequestHandler(SimpleHTTPRequestHandler):
    """Serve live workspace files without retaining stale instrument UI assets."""

    def __init__(self, *args, native_delay_port: int = NATIVE_DELAY_PORT, **kwargs):
        self.native_delay_port = native_delay_port
        super().__init__(*args, **kwargs)

    def do_GET(self) -> None:
        if not self._proxy_native_delay():
            super().do_GET()

    def do_POST(self) -> None:
        if not self._proxy_native_delay():
            self.send_error(404, "Unknown local control route")

    def _native_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _proxy_native_delay(self) -> bool:
        path = urlsplit(self.path).path
        if not path.startswith(NATIVE_DELAY_PREFIX):
            return False
        if not valid_native_proxy_origin(
            self.headers.get("Host"), self.headers.get("Origin"), self.server.server_port
        ):
            self._native_json(403, {"error": "Use this webapp's local address"})
            return True
        action = path.removeprefix(NATIVE_DELAY_PREFIX)
        if action not in NATIVE_DELAY_ACTIONS.get(self.command, set()):
            self._native_json(404, {"error": "Unknown native delay control route"})
            return True
        body = None
        if self.command == "POST":
            if self.headers.get("Transfer-Encoding") is not None:
                self._native_json(400, {"error": "Native controls require a bounded JSON body"})
                return True
            try:
                length = int(self.headers.get("Content-Length", "-1"))
            except ValueError:
                length = -1
            if not 0 <= length <= MAX_NATIVE_CONTROL_BODY:
                self._native_json(413, {"error": "Native control body is too large or missing"})
                return True
            if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                self._native_json(415, {"error": "Native controls require application/json"})
                return True
            body = self.rfile.read(length)
            if len(body) != length:
                self._native_json(400, {"error": "Incomplete native control body"})
                return True
        connection = http.client.HTTPConnection("127.0.0.1", self.native_delay_port, timeout=10)
        native_host = f"127.0.0.1:{self.native_delay_port}"
        try:
            connection.request(self.command, f"/api/{action}", body=body, headers={
                "Host": native_host,
                "Origin": f"http://{native_host}",
                "Content-Type": "application/json",
            })
            response = connection.getresponse()
            payload = response.read()
            self.send_response(response.status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except (OSError, http.client.HTTPException):
            # A missing optional native engine is valid for the static webapp.
            # Mutations fail explicitly; read-only discovery leaves Audio off.
            self._native_json(200 if self.command == "GET" else 503, {
                "nativeAvailable": False, "audio": False,
                "error": "The local Rust audio service is not running.",
            })
        finally:
            connection.close()
        return True

    def translate_path(self, path: str) -> str:
        request_path = urlsplit(path).path.lstrip("/")
        if request_path in {"", "index.html"}:
            return str(PROJECT_ROOT / "src" / "pages" / "index.html")
        if "/" not in request_path and request_path.endswith(".html"):
            source_page = PROJECT_ROOT / "src" / "pages" / request_path
            if source_page.is_file():
                return str(source_page)
        return super().translate_path(path)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        if urlsplit(self.path).path in {
            "/simd-resonator.html",
            "/simd-audio-lab.html",
            "/simd-lab.html",
            "/src/simd-audio-worker.js",
        }:
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"first port to try (default: {DEFAULT_PORT})",
    )
    parser.add_argument(
        "--strict-port",
        action="store_true",
        help="fail if the requested port is occupied (used by automated QA)",
    )
    parser.add_argument(
        "--native-delay-port", type=int, default=NATIVE_DELAY_PORT,
        help=f"local Rust delay service port (default: {NATIVE_DELAY_PORT})",
    )
    return parser.parse_args()


def create_server(start_port: int, *, strict_port: bool = False,
                  native_delay_port: int = NATIVE_DELAY_PORT) -> ThreadingHTTPServer:
    handler = partial(DevelopmentRequestHandler, directory=str(PROJECT_ROOT))
    handler = partial(handler, native_delay_port=native_delay_port)

    attempts = 1 if strict_port else PORT_ATTEMPTS
    for port in range(start_port, min(65536, start_port + attempts)):
        try:
            return ThreadingHTTPServer(("127.0.0.1", port), handler)
        except OSError as error:
            if strict_port or error.errno != errno.EADDRINUSE:
                raise

    raise RuntimeError(
        f"No available localhost port from {start_port} "
        f"through {min(65535, start_port + attempts - 1)}."
    )


def main() -> None:
    args = parse_args()
    if not 0 <= args.port <= 65535:
        raise SystemExit("Port must be between 0 and 65535.")
    if not 1 <= args.native_delay_port <= 65535:
        raise SystemExit("Native delay port must be between 1 and 65535.")

    server = create_server(args.port, strict_port=args.strict_port,
                           native_delay_port=args.native_delay_port)
    port = server.server_address[1]
    print(f"Morphazoid running at http://localhost:{port}/", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Morphazoid.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
