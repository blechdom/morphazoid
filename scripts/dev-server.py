#!/usr/bin/env python3
"""Run Morphazoid on the first available localhost port."""

from __future__ import annotations

import argparse
import errno
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


DEFAULT_PORT = 3435
PORT_ATTEMPTS = 100
PROJECT_ROOT = Path(__file__).resolve().parent.parent


class DevelopmentRequestHandler(SimpleHTTPRequestHandler):
    """Serve the live worktree without reusing stale browser assets."""

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"first port to try (default: {DEFAULT_PORT})",
    )
    return parser.parse_args()


def create_server(start_port: int) -> ThreadingHTTPServer:
    handler = partial(DevelopmentRequestHandler, directory=str(PROJECT_ROOT))

    for port in range(start_port, start_port + PORT_ATTEMPTS):
        try:
            return ThreadingHTTPServer(("127.0.0.1", port), handler)
        except OSError as error:
            if error.errno != errno.EADDRINUSE:
                raise

    raise RuntimeError(
        f"No available localhost port from {start_port} "
        f"through {start_port + PORT_ATTEMPTS - 1}."
    )


def main() -> None:
    args = parse_args()
    if not 0 <= args.port <= 65535:
        raise SystemExit("Port must be between 0 and 65535.")

    server = create_server(args.port)
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
