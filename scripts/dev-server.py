#!/usr/bin/env python3
"""Run Morphazoid on the first available localhost port."""

from __future__ import annotations

import argparse
import errno
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


DEFAULT_PORT = 3435
PORT_ATTEMPTS = 100
PROJECT_ROOT = Path(__file__).resolve().parent.parent


class DevelopmentRequestHandler(SimpleHTTPRequestHandler):
    """Serve live workspace files without retaining stale instrument UI assets."""

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
    return parser.parse_args()


def create_server(start_port: int, *, strict_port: bool = False) -> ThreadingHTTPServer:
    handler = partial(DevelopmentRequestHandler, directory=str(PROJECT_ROOT))

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

    server = create_server(args.port, strict_port=args.strict_port)
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
