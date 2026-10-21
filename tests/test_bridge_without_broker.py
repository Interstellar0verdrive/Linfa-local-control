"""Verifiche del bridge che non si collegano a MQTT e non invocano la CLI."""

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch


BRIDGE = Path(__file__).resolve().parents[1] / "bridge" / "serra_mqtt_bridge.py"
spec = importlib.util.spec_from_file_location("serra_mqtt_bridge", BRIDGE)
bridge_module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = bridge_module
spec.loader.exec_module(bridge_module)


class BridgeWithoutBrokerTests(unittest.TestCase):
    def test_password_save_cannot_be_requested_over_mqtt(self):
        with patch.object(bridge_module.subprocess, "run") as run:
            result = bridge_module.run_serra_command("serra", ["auth", "save"], 120)
        self.assertFalse(result.ok)
        run.assert_not_called()

    def make_bridge(self):
        bridge = object.__new__(bridge_module.SerraMqttBridge)
        bridge.cfg = bridge_module.BridgeConfig(host="127.0.0.1", timeout_s=120)
        bridge.client = MagicMock()
        return bridge

    def test_json_topic_without_id_is_subscribed(self):
        bridge = self.make_bridge()
        bridge._on_connect(bridge.client, None, None, 0)
        topics = [call.args[0] for call in bridge.client.subscribe.call_args_list]
        self.assertIn("serra/cmd/json", topics)
        self.assertIn("serra/cmd/json/+", topics)

    def test_rejected_login_does_not_announce_online(self):
        bridge = self.make_bridge()
        bridge._on_connect(bridge.client, None, None, 5)
        bridge.client.publish.assert_not_called()
        bridge.client.subscribe.assert_not_called()

    def test_keepalive_covers_long_cli_call(self):
        bridge = self.make_bridge()
        bridge.client.loop_forever.side_effect = KeyboardInterrupt
        with patch.object(bridge_module, "broker_reachable", return_value=True):
            bridge.run()
        self.assertGreaterEqual(bridge.client.connect.call_args.kwargs["keepalive"], 150)

    def test_unreachable_broker_skips_blocking_connect(self):
        bridge = self.make_bridge()
        with patch.object(bridge_module, "broker_reachable", side_effect=[False, KeyboardInterrupt]):
            with patch.object(bridge_module.time, "sleep") as sleep:
                bridge.run()
        bridge.client.connect.assert_not_called()
        sleep.assert_called_once_with(5)


if __name__ == "__main__":
    unittest.main()
