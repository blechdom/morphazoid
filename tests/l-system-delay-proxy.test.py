"""Native routing and origin checks without sockets or device audio."""
import http.client
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location(
    "native_delay_preview", Path(__file__).resolve().parents[1] / "scripts" / "dev-server.py"
)
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


def handler(action="state", method="GET", *, host="localhost:3437",
            origin=None, body=b"{}", length=None, content_type="application/json"):
    request = object.__new__(preview.DevelopmentRequestHandler)
    request.path = f"/api/l-system-delay/{action}"
    request.command = method
    request.native_delay_port = 4567
    request.server = SimpleNamespace(server_port=3437)
    request.headers = {"Host": host, "Content-Type": content_type,
                       "Content-Length": str(len(body)) if length is None else length}
    if origin is not None:
        request.headers["Origin"] = origin
    request.rfile, request.wfile = io.BytesIO(body), io.BytesIO()
    request.send_response = Mock()
    request.send_header = Mock()
    request.end_headers = Mock()
    return request


def backend(payload=b'{"audio":false}', status=200):
    connection = Mock()
    connection.getresponse.return_value = SimpleNamespace(
        read=lambda: payload, status=status
    )
    return connection


class NativeDelayProxy(unittest.TestCase):
    def test_state_status_and_preview_stay_same_origin_and_preserve_response(self):
        for action in ("state", "status", "preview"):
            request = handler(action, origin="http://localhost:3437")
            connection = backend()
            with patch.object(preview.http.client, "HTTPConnection", return_value=connection) as factory:
                self.assertTrue(request._proxy_native_delay())
            factory.assert_called_once_with("127.0.0.1", 4567, timeout=10)
            args, kwargs = connection.request.call_args
            self.assertEqual(args, ("GET", f"/api/{action}"))
            self.assertEqual(kwargs["headers"]["Host"], "127.0.0.1:4567")
            self.assertEqual(kwargs["headers"]["Origin"], "http://127.0.0.1:4567")
            request.send_response.assert_called_once_with(200)
            self.assertEqual(request.wfile.getvalue(), b'{"audio":false}')
            connection.close.assert_called_once()

    def test_all_explicit_control_actions_forward_json_unchanged(self):
        body = b'{"enabled":true}'
        for action in ("parameters", "performance", "audio", "strike", "reset"):
            request = handler(action, "POST", body=body)
            connection = backend(b'{"error":"rejected"}', 400)
            with patch.object(preview.http.client, "HTTPConnection", return_value=connection):
                request._proxy_native_delay()
            self.assertEqual(connection.request.call_args.args, ("POST", f"/api/{action}"))
            self.assertEqual(connection.request.call_args.kwargs["body"], body)
            request.send_response.assert_called_once_with(400)

    def test_cross_origin_null_origin_and_rebinding_hosts_never_reach_native(self):
        for host, origin in (("attacker.example:3437", None),
                             ("localhost:3437", "https://attacker.example"),
                             ("localhost:3437", "null"),
                             ("localhost:3437", "http://localhost:3435"),
                             ("127.0.0.1:3437", "http://localhost:3437")):
            request = handler("audio", "POST", host=host, origin=origin)
            with patch.object(preview.http.client, "HTTPConnection") as factory:
                request._proxy_native_delay()
            factory.assert_not_called()
            request.send_response.assert_called_once_with(403)

    def test_unknown_routes_traversal_and_wrong_methods_never_reach_native(self):
        for action, method in (("../audio", "POST"), ("%2e%2e/audio", "POST"),
                               ("audio", "GET"), ("state", "POST"),
                               ("arbitrary-url", "GET")):
            request = handler(action, method)
            with patch.object(preview.http.client, "HTTPConnection") as factory:
                request._proxy_native_delay()
            factory.assert_not_called()
            request.send_response.assert_called_once_with(404)

    def test_control_bodies_are_bounded_and_json_only(self):
        for length, content_type, status in (("-1", "application/json", 413),
                                             ("bogus", "application/json", 413),
                                             (str(16 * 1024 + 1), "application/json", 413),
                                             ("2", "text/plain", 415)):
            request = handler("audio", "POST", length=length, content_type=content_type)
            with patch.object(preview.http.client, "HTTPConnection") as factory:
                request._proxy_native_delay()
            factory.assert_not_called()
            request.send_response.assert_called_once_with(status)
        request = handler("audio", "POST")
        request.headers["Transfer-Encoding"] = "chunked"
        with patch.object(preview.http.client, "HTTPConnection") as factory:
            request._proxy_native_delay()
        factory.assert_not_called()
        request.send_response.assert_called_once_with(400)

    def test_optional_backend_discovery_is_off_and_mutations_fail_explicitly(self):
        for method, action, status in (("GET", "state", 200), ("POST", "audio", 503)):
            request = handler(action, method)
            connection = Mock()
            connection.request.side_effect = OSError("offline")
            with patch.object(preview.http.client, "HTTPConnection", return_value=connection):
                request._proxy_native_delay()
            request.send_response.assert_called_once_with(status)
            payload = json.loads(request.wfile.getvalue())
            self.assertIs(payload["nativeAvailable"], False)
            self.assertIs(payload["audio"], False)
            connection.close.assert_called_once()

    def test_regular_site_requests_do_not_use_native_proxy(self):
        request = handler()
        request.path = "/l-mic.html"
        with patch.object(preview.http.client, "HTTPConnection") as factory:
            self.assertFalse(request._proxy_native_delay())
        factory.assert_not_called()


if __name__ == "__main__":
    unittest.main()
