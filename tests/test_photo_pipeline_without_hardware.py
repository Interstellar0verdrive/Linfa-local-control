"""Safety checks for the UART photo pipeline without touching hardware or MQTT."""

import importlib.machinery
import importlib.util
import hashlib
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


PHOTO = Path(__file__).resolve().parents[1] / 'bridge' / 'serra-foto'
controller = types.ModuleType('serra_controller')
controller.ConsoleConfig = type('ConsoleConfig', (), {})
controller.SerraConsole = Mock()
controller.make_console = Mock()
controller._channels_to_cmd = lambda channels, fade: 'restore-all-groups'
paho = types.ModuleType('paho')
paho_mqtt = types.ModuleType('paho.mqtt')
paho_client = types.ModuleType('paho.mqtt.client')
paho.mqtt = paho_mqtt
paho_mqtt.client = paho_client
loader = importlib.machinery.SourceFileLoader('serra_foto_uart_test', str(PHOTO))
spec = importlib.util.spec_from_loader(loader.name, loader)
photo = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {
    'serra_controller': controller,
    'paho': paho, 'paho.mqtt': paho_mqtt, 'paho.mqtt.client': paho_client,
}):
    loader.exec_module(photo)


class PhotoPipelineWithoutHardwareTests(unittest.TestCase):
    def test_wifi_photo_uses_binary_transfer_and_checks_digest(self):
        raw = b'\xff\xd8' + b'x' * 6000 + b'\xff\xd9'
        console = Mock(active_transport='wifi')
        console.run_binary.return_value = raw
        with patch.dict(photo.os.environ, {'SERRA_TRANSPORT': 'wifi'}), \
                patch.object(photo, 'metadata', return_value=(len(raw), hashlib.sha256(raw).hexdigest())), \
                patch.object(photo, 'connect_console', return_value=console), \
                patch.object(photo, 'read_chunk') as uart_chunk:
            self.assertEqual(photo.transfer(), raw)
        uart_chunk.assert_not_called()
        console.close.assert_called_once()

    def test_camera_failure_restores_leds_before_releasing_uart(self):
        console = Mock()
        mix = {ch: 0 for ch in photo.CHANNELS}
        commands = []

        def run(console_arg, command, timeout=15):
            commands.append(command)
            if 'fswebcam' in command:
                raise RuntimeError('camera failure')

        with patch.object(photo, 'connect_console', return_value=console), \
                patch.object(photo, 'read_lights', return_value=mix), \
                patch.object(photo, 'checked', side_effect=run), \
                patch.object(photo.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, 'camera failure'):
                photo.capture()
        self.assertTrue(any('2Bff000' in cmd and '5Bff000' in cmd for cmd in commands))
        self.assertIn('2B00000', commands[-1])
        self.assertIn('5B00000', commands[-1])
        self.assertIn('restore-all-groups', commands[-1])
        console.close.assert_called_once()

    def test_missing_light_state_never_changes_leds(self):
        console = Mock()
        with patch.object(photo, 'connect_console', return_value=console), \
                patch.object(photo, 'read_lights', side_effect=RuntimeError('mix luci ignoto')), \
                patch.object(photo, 'checked') as checked:
            with self.assertRaisesRegex(RuntimeError, 'mix luci ignoto'):
                photo.capture()
        checked.assert_not_called()
        console.close.assert_called_once()

    def test_transfer_rejects_corrupted_jpeg(self):
        raw = b'\xff\xd8' + b'x' * 6000 + b'\xff\xd9'
        with patch.object(photo, 'metadata', return_value=(len(raw), '0' * 64)), \
                patch.object(photo, 'read_chunk', return_value=raw), \
                patch.object(photo.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, 'checksum JPEG diverso'):
                photo.transfer()

    def test_truncated_uart_block_is_rejected(self):
        console = Mock()
        console.run_capture.return_value = 'begin-base64 644 chunk\nYQ==\n'
        with patch.object(photo, 'connect_console', return_value=console):
            with self.assertRaisesRegex(RuntimeError, 'blocco UART 0 incompleto'):
                photo.read_chunk(0)
        console.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
