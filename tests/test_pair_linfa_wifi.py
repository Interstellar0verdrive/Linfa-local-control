"""Offline checks for the local pairing request; no greenhouse is contacted."""

import importlib.util
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout


SCRIPT = Path(__file__).resolve().parents[1] / "tools" / "pair_linfa_wifi.py"
SPEC = importlib.util.spec_from_file_location("pair_linfa_wifi", SCRIPT)
PAIR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PAIR)


class FakeResponse:
    status = 201

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class PairingTest(unittest.TestCase):
    def test_payload_and_no_secret_output(self):
        captured = []

        def fake_urlopen(req, timeout):
            captured.append((req, timeout))
            return FakeResponse()

        output = io.StringIO()
        with (
            patch.object(sys, "argv", ["pair_linfa_wifi.py", "--host", "192.168.247.1"]),
            patch("builtins.input", return_value="Test-SSID"),
            patch.object(PAIR.getpass, "getpass", side_effect=["private-wifi-password", "private-device-token"]),
            patch.object(PAIR.request, "urlopen", side_effect=fake_urlopen),
            redirect_stdout(output),
        ):
            self.assertEqual(PAIR.main(), 0)

        req, timeout = captured[0]
        self.assertEqual(req.full_url, "http://192.168.247.1/credentials")
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(timeout, 8)
        self.assertEqual(
            PAIR.json.loads(req.data),
            {
                "usr-token": "private-device-token",
                "SSID": "Test-SSID",
                "security": "wpa2psk",
                "password": "private-wifi-password",
                "encryption": "AES",
            },
        )
        self.assertNotIn("private-wifi-password", output.getvalue())
        self.assertNotIn("private-device-token", output.getvalue())

    def test_interrupted_response_warns_against_immediate_retry(self):
        output = io.StringIO()
        with (
            patch.object(sys, "argv", ["pair_linfa_wifi.py"]),
            patch("builtins.input", return_value="Test-SSID"),
            patch.object(PAIR.getpass, "getpass", side_effect=["private-wifi-password", "private-device-token"]),
            patch.object(PAIR.request, "urlopen", side_effect=TimeoutError()),
            redirect_stdout(output),
        ):
            self.assertEqual(PAIR.main(), 2)
        self.assertIn("non ripetere subito", output.getvalue())


if __name__ == "__main__":
    unittest.main()
