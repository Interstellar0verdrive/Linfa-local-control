"""I casi critici di ripristino della pipeline foto, senza rete o hardware."""

import importlib.machinery
import importlib.util
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import call, patch


PHOTO = Path(__file__).resolve().parents[1] / "bridge" / "serra-foto"
loader = importlib.machinery.SourceFileLoader("serra_foto", str(PHOTO))
spec = importlib.util.spec_from_loader(loader.name, loader)
photo = importlib.util.module_from_spec(spec)
loader.exec_module(photo)


class PhotoPipelineWithoutHardwareTests(unittest.TestCase):
    def test_failed_flash_still_restores_lights_and_network(self):
        commands = []

        def fake_run(cmd, **kwargs):
            commands.append(cmd)
            return SimpleNamespace(returncode=0)

        with tempfile.TemporaryDirectory() as directory, \
                patch.object(photo, "LOCKFILE", str(Path(directory) / "photo.lock")), \
                patch.object(photo, "ping_ok", side_effect=[False, True]), \
                patch.object(photo, "leggi_mix_luci", return_value={"a": 20}), \
                patch.object(photo, "lights_mix", side_effect=[False, True]) as lights, \
                patch.object(photo, "scatta") as scatta, \
                patch.object(photo.time, "sleep"), \
                patch.object(photo, "run", side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, "flash non applicato"):
                photo.main()
        self.assertEqual(lights.call_args_list, [call(photo.FLASH_MIX), call({"a": 20})])
        self.assertIn(["serra", "net", "on"], commands)
        self.assertIn(["serra", "net", "off"], commands)
        scatta.assert_not_called()

    def test_unknown_mix_leaves_lights_untouched_and_turns_network_off(self):
        commands = []

        def fake_run(cmd, **kwargs):
            commands.append(cmd)
            return SimpleNamespace(returncode=0)

        with tempfile.TemporaryDirectory() as directory, \
                patch.object(photo, "LOCKFILE", str(Path(directory) / "photo.lock")), \
                patch.object(photo, "ping_ok", side_effect=[False, True]), \
                patch.object(photo, "leggi_mix_luci", return_value=None), \
                patch.object(photo, "lights_mix") as lights, \
                patch.object(photo.time, "sleep"), \
                patch.object(photo, "run", side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, "mix luci ignoto"):
                photo.main()
        lights.assert_not_called()
        self.assertIn(["serra", "net", "off"], commands)

    def test_failed_network_restore_is_reported_after_retry(self):
        def fake_run(cmd, **kwargs):
            return SimpleNamespace(returncode=1 if cmd[-1] == "off" else 0)

        with tempfile.TemporaryDirectory() as directory, \
                patch.object(photo, "LOCKFILE", str(Path(directory) / "photo.lock")), \
                patch.object(photo, "ping_ok", side_effect=[False, True]), \
                patch.object(photo, "leggi_mix_luci", return_value=None), \
                patch.object(photo, "pubblica_errore") as report, \
                patch.object(photo.time, "sleep"), \
                patch.object(photo, "run", side_effect=fake_run) as run:
            with self.assertRaisesRegex(RuntimeError, "mix luci ignoto"):
                photo.main()
        self.assertEqual(sum(c.args[0] == ["serra", "net", "off"] for c in run.call_args_list), 2)
        report.assert_called_once_with("ripristino rete post-foto fallito")

    def test_capture_rejects_a_stale_image_after_camera_error(self):
        old_image = b"\xff\xd8" + b"x" * 6000
        with patch.object(photo, "serra_ssh", return_value=SimpleNamespace(
                returncode=1, stdout=old_image)) as ssh:
            with self.assertRaisesRegex(RuntimeError, "scatto fallito"):
                photo.scatta()
        command = ssh.call_args.args[0]
        self.assertTrue(command.startswith("rm -f /tmp/foto.jpg; fswebcam"))


if __name__ == "__main__":
    unittest.main()
