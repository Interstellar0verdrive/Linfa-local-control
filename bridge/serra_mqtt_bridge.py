#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
serra_mqtt_bridge.py
--------------------
Bridge MQTT -> CLI "serra"

Ascolta comandi MQTT e li esegue invocando la CLI `serra`
come subprocess separato (robusto, stateless).

Topic base (default): serra

SUB:
  serra/cmd/<id>        payload: stringa CLI (es: "lights on -i 80 -f 30")
  serra/cmd             come sopra, senza ack dedicato
  serra/cmd/json/<id>   payload JSON:
                          {"cmdline":"lights on -i 80 -f 30"}
                          {"cmd":["lights","on","-i","80","-f","30"]}

PUB:
  serra/ack/<id>        JSON con esito comando
  serra/status/last     ultimo esito (retain)
  serra/status/online   online/offline bridge (retain + LWT)

Config via ENV:
  SERRA_MQTT_HOST   (default 127.0.0.1)
  SERRA_MQTT_PORT   (default 1883)
  SERRA_MQTT_USER / SERRA_MQTT_PASS (opzionali)
  SERRA_MQTT_TOPIC  (default "serra")
  SERRA_MQTT_QOS    (default 0)
  SERRA_CLI         (default "serra")  # wrapper CLI
  SERRA_CMD_TIMEOUT (default 120)
"""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from zoneinfo import ZoneInfo

try:
    import paho.mqtt.client as mqtt
except ImportError:
    print("ERRORE: manca paho-mqtt. Installa con:", file=sys.stderr)
    print("  sudo apt-get update && sudo apt-get install -y python3-paho-mqtt", file=sys.stderr)
    sys.exit(2)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ROME_TZ = ZoneInfo("Europe/Rome")

# Exit codes (seguono convenzioni standard)
EXIT_OK = 0
EXIT_TIMEOUT = 124
EXIT_NOT_FOUND = 127


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def _env_int(key: str, default: int) -> int:
    """Parse environment variable as int with fallback."""
    val = os.environ.get(key, "").strip()
    if not val:
        return default
    try:
        return int(val)
    except ValueError:
        return default


def _env_str(key: str, default: str) -> str:
    """Get environment variable with fallback."""
    return os.environ.get(key, "").strip() or default


@dataclass(frozen=True)
class BridgeConfig:
    """Configuration for MQTT bridge (immutable)."""

    host: str = field(default_factory=lambda: _env_str("SERRA_MQTT_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: _env_int("SERRA_MQTT_PORT", 1883))
    username: str | None = field(default_factory=lambda: os.environ.get("SERRA_MQTT_USER") or None)
    password: str | None = field(default_factory=lambda: os.environ.get("SERRA_MQTT_PASS") or None)
    base_topic: str = field(default_factory=lambda: _env_str("SERRA_MQTT_TOPIC", "serra"))
    qos: int = field(default_factory=lambda: _env_int("SERRA_MQTT_QOS", 0))
    cli: str = field(default_factory=lambda: _env_str("SERRA_CLI", "serra"))
    timeout_s: int = field(default_factory=lambda: _env_int("SERRA_CMD_TIMEOUT", 120))
    client_id: str = field(
        default_factory=lambda: _env_str(
            "SERRA_MQTT_CLIENT_ID",
            f"serra-bridge-{uuid.uuid4().hex[:6]}"
        )
    )


# ---------------------------------------------------------------------------
# Utility Functions
# ---------------------------------------------------------------------------

def eprint(*args: Any, **kwargs: Any) -> None:
    """Print to stderr."""
    print(*args, file=sys.stderr, **kwargs)


def topic_join(base: str, *parts: str) -> str:
    """Join MQTT topic parts, stripping slashes."""
    base = base.strip().strip("/")
    tail = "/".join(p.strip().strip("/") for p in parts if p)
    return f"{base}/{tail}" if tail else base


def now_ts() -> dict[str, Any]:
    """Return current timestamp in multiple formats."""
    t = time.time()
    dt_utc = datetime.fromtimestamp(t, tz=timezone.utc)
    dt_local = dt_utc.astimezone(ROME_TZ)
    return {
        "ts": t,
        "ts_iso": dt_utc.isoformat().replace("+00:00", "Z"),
        "ts_local": dt_local.isoformat(),
    }


# ---------------------------------------------------------------------------
# Message Parsing
# ---------------------------------------------------------------------------

@dataclass
class ParseResult:
    """Result of parsing an MQTT message."""

    msg_id: str | None
    tokens: list[str] | None
    error: str | None

    @property
    def ok(self) -> bool:
        return self.error is None and self.tokens is not None


def _parse_json_payload(text: str, msg_id: str | None) -> ParseResult:
    """Parse JSON payload format."""
    try:
        obj = json.loads(text)
    except json.JSONDecodeError as e:
        return ParseResult(msg_id, None, f"JSON invalido: {e}")

    if not isinstance(obj, dict):
        return ParseResult(msg_id, None, "JSON deve essere un oggetto")

    # Format: {"cmdline": "lights on -i 80"}
    if "cmdline" in obj:
        try:
            tokens = shlex.split(str(obj["cmdline"]))
            return ParseResult(msg_id, tokens, None)
        except ValueError as e:
            return ParseResult(msg_id, None, f"cmdline non parsabile: {e}")

    # Format: {"cmd": ["lights", "on", "-i", "80"]}
    if "cmd" in obj and isinstance(obj["cmd"], list):
        tokens = [str(x) for x in obj["cmd"]]
        return ParseResult(msg_id, tokens, None)

    return ParseResult(msg_id, None, "JSON supportato: {'cmdline': '...'} oppure {'cmd': [...]}")


def parse_message(base_topic: str, topic: str, payload: bytes) -> ParseResult:
    """
    Parse incoming MQTT message.

    Returns ParseResult with msg_id, tokens (command args), and optional error.
    """
    topic = topic.strip("/")
    base = base_topic.strip().strip("/")

    # Extract relative topic
    if topic.startswith(base + "/"):
        rel = topic[len(base) + 1:]
    else:
        rel = topic

    parts = rel.split("/")

    # Validate topic structure
    if not parts or parts[0] != "cmd":
        return ParseResult(None, None, "topic non valido (atteso <base>/cmd/...)")

    # Determine message ID and format
    is_json = False
    msg_id = None

    if len(parts) >= 2 and parts[1] == "json":
        is_json = True
        msg_id = parts[2] if len(parts) >= 3 else None
    elif len(parts) >= 2:
        msg_id = parts[1]

    # Decode payload
    text = payload.decode("utf-8", errors="replace").strip()
    if not text:
        return ParseResult(msg_id, None, "payload vuoto")

    # Parse based on format
    if is_json or text.startswith("{"):
        return _parse_json_payload(text, msg_id)

    # Plain text format
    try:
        tokens = shlex.split(text)
        return ParseResult(msg_id, tokens, None)
    except ValueError as e:
        return ParseResult(msg_id, None, f"payload non parsabile: {e}")


# ---------------------------------------------------------------------------
# Command Execution
# ---------------------------------------------------------------------------

@dataclass
class CommandResult:
    """Result of executing a serra command."""

    ok: bool
    return_code: int
    stdout: str
    stderr: str


def run_serra_command(cli: str, tokens: list[str], timeout_s: int) -> CommandResult:
    """
    Execute serra CLI command.

    Args:
        cli: Path to serra CLI executable
        tokens: Command arguments
        timeout_s: Timeout in seconds

    Returns:
        CommandResult with execution status and output
    """
    cmd = [cli] + tokens

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            check=False,  # Don't raise on non-zero exit
        )
        return CommandResult(
            ok=(result.returncode == EXIT_OK),
            return_code=result.returncode,
            stdout=result.stdout.strip(),
            stderr=result.stderr.strip(),
        )

    except subprocess.TimeoutExpired:
        return CommandResult(
            ok=False,
            return_code=EXIT_TIMEOUT,
            stdout="",
            stderr=f"timeout dopo {timeout_s}s",
        )

    except FileNotFoundError:
        return CommandResult(
            ok=False,
            return_code=EXIT_NOT_FOUND,
            stdout="",
            stderr=f"CLI non trovata: {cli}",
        )

    except OSError as e:
        return CommandResult(
            ok=False,
            return_code=1,
            stdout="",
            stderr=f"errore OS: {e}",
        )


# ---------------------------------------------------------------------------
# MQTT Bridge
# ---------------------------------------------------------------------------

class SerraMqttBridge:
    """MQTT bridge for serra CLI commands."""

    def __init__(self, config: BridgeConfig):
        self.cfg = config
        self.client = self._create_client()
        self._setup_callbacks()

    def _create_client(self) -> mqtt.Client:
        """Create and configure MQTT client."""
        try:
            # paho-mqtt >= 2.0
            client = mqtt.Client(
                mqtt.CallbackAPIVersion.VERSION2,
                client_id=self.cfg.client_id,
            )
        except AttributeError:
            # paho-mqtt < 2.0 fallback
            client = mqtt.Client(client_id=self.cfg.client_id)

        if self.cfg.username:
            client.username_pw_set(self.cfg.username, self.cfg.password)

        # Set Last Will and Testament
        will_payload = json.dumps({
            "ok": False,
            "msg": "bridge offline",
            "cli": self.cfg.cli,
            **now_ts(),
        })
        client.will_set(
            topic_join(self.cfg.base_topic, "status", "online"),
            will_payload,
            qos=self.cfg.qos,
            retain=True,
        )

        return client

    def _setup_callbacks(self) -> None:
        """Setup MQTT callbacks."""
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message

    def _publish(self, topic: str, payload: dict[str, Any], retain: bool = False) -> None:
        """Publish JSON payload to topic."""
        self.client.publish(
            topic,
            json.dumps(payload, ensure_ascii=False),
            qos=self.cfg.qos,
            retain=retain,
        )

    def _publish_status_last(self, obj: dict[str, Any]) -> None:
        """Publish to status/last (retained)."""
        self._publish(
            topic_join(self.cfg.base_topic, "status", "last"),
            obj,
            retain=True,
        )

    def _publish_status_last_seen(self, extra: dict[str, Any] | None = None) -> None:
        """Publish to status/last_seen (retained)."""
        payload = {
            "ok": True,
            "source": "mqtt-bridge",
            **now_ts(),
        }
        if extra:
            payload.update(extra)

        self._publish(
            topic_join(self.cfg.base_topic, "status", "last_seen"),
            payload,
            retain=True,
        )

    def _publish_ack(self, msg_id: str | None, obj: dict[str, Any]) -> None:
        """Publish acknowledgment for specific message ID."""
        if not msg_id:
            return

        self._publish(
            topic_join(self.cfg.base_topic, "ack", msg_id),
            obj,
            retain=False,
        )

    def _on_connect(
        self,
        client: mqtt.Client,
        userdata: Any,
        flags: Any,
        reason_code: Any,
        properties: Any = None,
    ) -> None:
        """Handle MQTT connection."""
        rc = getattr(reason_code, "value", reason_code)

        # Publish online status
        online_payload = {
            "ok": True,
            "msg": "bridge online",
            "cli": self.cfg.cli,
            **now_ts(),
        }
        self._publish(
            topic_join(self.cfg.base_topic, "status", "online"),
            online_payload,
            retain=True,
        )

        self._publish_status_last_seen({"msg": "bridge online"})

        # Subscribe to command topics
        subscriptions = [
            topic_join(self.cfg.base_topic, "cmd"),
            topic_join(self.cfg.base_topic, "cmd", "+"),
            topic_join(self.cfg.base_topic, "cmd", "json"),
            topic_join(self.cfg.base_topic, "cmd", "json", "+"),
        ]

        for topic in subscriptions:
            client.subscribe(topic, qos=self.cfg.qos)

        print(f"[mqtt] connected rc={rc} base={self.cfg.base_topic} cli={self.cfg.cli}")

    def _on_message(
        self,
        client: mqtt.Client,
        userdata: Any,
        msg: mqtt.MQTTMessage,
    ) -> None:
        """Handle incoming MQTT message."""
        parsed = parse_message(self.cfg.base_topic, msg.topic, msg.payload)
        ts = now_ts()

        # Handle parse errors
        if not parsed.ok:
            error_obj = {
                "ok": False,
                "error": parsed.error,
                "topic": msg.topic,
                **ts,
            }
            self._publish_status_last(error_obj)
            self._publish_ack(parsed.msg_id, error_obj)
            print(f"[mqtt] ERR: {parsed.error}")
            return

        # Execute command
        result = run_serra_command(self.cfg.cli, parsed.tokens, self.cfg.timeout_s)

        result_obj = {
            "ok": result.ok,
            "rc": result.return_code,
            "cmd": parsed.tokens,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "topic": msg.topic,
            **ts,
        }

        self._publish_status_last(result_obj)
        self._publish_ack(parsed.msg_id, result_obj)

        # Log result
        label = "OK" if result.ok else "ERR"
        cmd_str = " ".join(parsed.tokens) if parsed.tokens else ""
        print(f"[mqtt] {label}: {cmd_str} (rc={result.return_code})")

    def run(self) -> None:
        """Run the bridge (blocking, with auto-reconnect)."""
        while True:
            try:
                self.client.connect(self.cfg.host, self.cfg.port, keepalive=60)
                self.client.loop_forever()
            except KeyboardInterrupt:
                print("\n[mqtt] interrupted, shutting down...")
                break
            except OSError as e:
                eprint(f"[mqtt] connect/loop error: {e} (retry in 5s)")
                time.sleep(5)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    """Main entry point."""
    config = BridgeConfig()

    print(f"[mqtt] starting bridge...")
    print(f"[mqtt] host={config.host}:{config.port} topic={config.base_topic}")
    print(f"[mqtt] cli={config.cli} timeout={config.timeout_s}s")

    bridge = SerraMqttBridge(config)
    bridge.run()

    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
