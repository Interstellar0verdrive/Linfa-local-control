"""Controlli della CLI che non aprono la porta seriale né comandano la serra."""

import importlib.util
import os
import stat
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


CONTROLLER = Path(__file__).resolve().parents[1] / "bridge" / "serra_controller.py"
spec = importlib.util.spec_from_file_location("serra_controller", CONTROLLER)
serra = importlib.util.module_from_spec(spec)
spec.loader.exec_module(serra)


class ControllerWithoutHardwareTests(unittest.TestCase):
    def test_manual_password_is_saved_privately_and_services_keep_env_priority(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "serra" / "root-password"
            with patch.object(serra, "LOCAL_PASSWORD_FILE", str(path)), \
                    patch.dict(os.environ, {"SERRA_ROOT_PASSWORD": ""}):
                serra._save_console_password("local-example")
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                self.assertEqual(stat.S_IMODE(path.parent.stat().st_mode), 0o700)
                self.assertEqual(serra.ConsoleConfig().password, "local-example")
                os.chmod(path, 0o644)
                with self.assertRaisesRegex(serra.SerraCommandError, "chmod 600"):
                    serra._resolve_console_password()
                os.environ["SERRA_ROOT_PASSWORD"] = "service-example"
                self.assertEqual(serra.ConsoleConfig().password, "service-example")

    def test_preset_scales_recipe_and_switches_unused_channels_off(self):
        command, channels = serra.light_preset_cmd("viola", 60, 2)
        self.assertEqual(channels, {"A": 0, "G": 0, "B": 24, "R": 60, "D": 60})
        self.assertEqual(command.count("/dev/tty-local"), 5)
        self.assertEqual(command.count(" && sleep "), 4)

    def test_mix_failure_is_reported_to_mqtt_bridge(self):
        with patch.object(serra, "step", return_value=False), patch.object(serra, "_record") as record:
            with self.assertRaises(serra.SerraCommandError):
                serra.do_lights_mix(None, 0, 20, 0, 40, 40, 0)
        self.assertFalse(record.call_args.args[1])

    def test_water_level_uses_empty_full_calibration(self):
        self.assertEqual(serra._water_level_pct([5, 0, 0], [0, 0, 0], [10, 0, 0]), 50.0)
        self.assertEqual(serra._water_level_pct([20, 0, 0], [0, 0, 0], [10, 0, 0]), 100.0)
        self.assertIsNone(serra._water_level_pct([1, 2, 3], [0, 0, 0], [0, 0, 0]))

    def test_state_file_remains_valid_after_replace(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "state.json")
            serra._save_state({"one": 1}, path)
            serra._save_state({"two": 2}, path)
            self.assertEqual(serra._load_state(path)["two"], 2)

    def test_ring_stays_on_when_fade_finishes(self):
        state = {"ring": {"state": {"mode": "on", "running": True, "until_ts": 0}}}
        serra._derive_running_flags(state)
        self.assertTrue(state["ring"]["state"]["running_now"])

    def test_missing_photo_pipeline_has_clear_error(self):
        with patch.object(serra.os.path, "isfile", return_value=False):
            with self.assertRaisesRegex(serra.SerraCommandError, "Pipeline foto non installata"):
                serra.do_foto()

    def test_photo_does_not_start_when_preflight_fails(self):
        with patch.object(serra.os.path, "isfile", return_value=True), \
                patch.object(serra.os, "access", return_value=True), \
                patch("subprocess.run", return_value=SimpleNamespace(
                    returncode=1, stdout="configurazione foto incompleta", stderr="")), \
                patch("subprocess.Popen") as launch:
            with self.assertRaisesRegex(serra.SerraCommandError, "configurazione foto incompleta"):
                serra.do_foto()
        launch.assert_not_called()

    def test_disconnect_callback_accepts_both_paho_versions(self):
        manager = serra.MQTTManager()
        manager._connected = True
        manager._on_disconnect(None, None, 0)
        self.assertFalse(manager._connected)
        manager._connected = True
        manager._on_disconnect(None, None, None, 0, None)
        self.assertFalse(manager._connected)


if __name__ == "__main__":
    unittest.main()
