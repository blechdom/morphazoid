"""Local-only QA port-policy tests: no listening sockets or subprocesses."""
import errno
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "morphazoid_dev_server", Path(__file__).resolve().parents[1] / "scripts" / "dev-server.py"
)
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class PreviewPortPolicy(unittest.TestCase):
    def test_strict_port_never_switches_to_another_port(self):
        error = OSError(errno.EADDRINUSE, "occupied")
        with patch.object(server, "ThreadingHTTPServer", side_effect=error) as factory:
            with self.assertRaises(OSError):
                server.create_server(4381, strict_port=True)
        self.assertEqual(factory.call_count, 1)
        self.assertEqual(factory.call_args.args[0], ("127.0.0.1", 4381))

    def test_interactive_preview_keeps_its_existing_port_search(self):
        ready = object()
        with patch.object(server, "ThreadingHTTPServer",
                          side_effect=[OSError(errno.EADDRINUSE, "occupied"), ready]) as factory:
            self.assertIs(server.create_server(4381), ready)
        self.assertEqual([call.args[0][1] for call in factory.call_args_list], [4381, 4382])

    def test_server_uses_the_script_checkout_not_the_shell_directory(self):
        with patch.object(server, "ThreadingHTTPServer", return_value=object()) as factory:
            server.create_server(4381, strict_port=True)
        handler = factory.call_args.args[1]
        self.assertEqual(handler.keywords["directory"], str(server.PROJECT_ROOT))

    def test_permission_errors_do_not_trigger_a_port_search(self):
        with patch.object(server, "ThreadingHTTPServer",
                          side_effect=OSError(errno.EACCES, "denied")) as factory:
            with self.assertRaises(OSError):
                server.create_server(4381)
        self.assertEqual(factory.call_count, 1)


if __name__ == "__main__":
    unittest.main()
