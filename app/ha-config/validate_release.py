#!/usr/bin/env python3
"""Verifica statica dei file Home Assistant candidati al rilascio.

Richiede PyYAML. Non accede a Home Assistant e non aziona la serra.
"""

import json
import subprocess
import sys
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parent
PHASES = {"germinazione", "vegetativa", "fioritura", "flush", "essiccazione"}


class UniqueKeysLoader(yaml.SafeLoader):
    pass


def construct_mapping(loader, node):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node)
        if key in result:
            raise ValueError(f"chiave YAML duplicata: {key!r}")
        result[key] = loader.construct_object(value_node)
    return result


UniqueKeysLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, construct_mapping
)


def load_yaml(path):
    return yaml.load(path.read_text(encoding="utf-8"), Loader=UniqueKeysLoader)


package_path = ROOT / "serra_mqtt.yaml"
plan_path = ROOT / "serra_piano.yaml"
example_path = ROOT / "serra_piano.example.yaml"
parser_path = ROOT / "serra_piano_parse.py"
package_text = package_path.read_text(encoding="utf-8")
package = load_yaml(package_path)
plan = load_yaml(plan_path)
example = load_yaml(example_path)

assert len(package["automation"]) == 54
assert "serra_push_facoltativa" in package["script"]
assert "serra_notifica_servizio" in package["input_text"]
assert package["input_select"]["serra_varieta"]["options"] == [
    "Autofiorente", "Fotoperiodica"
]
assert "initial" not in package["input_boolean"]["serra_coltivazione_attiva"]
assert "initial" not in package["input_boolean"]["serra_dosatori_auto"]
assert "initial" not in package["input_boolean"]["serra_notifiche_push"]
assert "initial" not in package["input_boolean"]["serra_wifi"]
assert "initial" not in package["input_boolean"]["serra_taratura_clima_attiva"]
assert "input_boolean.serra_taratura_clima_attiva" in package_text
assert package_text.count("entity_id: script.serra_push_facoltativa") == 5
assert "script.announce_to_all" not in package_text
assert 'mobile_apps: "alberto"' not in package_text
assert "192.168.2." not in package_text

for candidate in (plan, example):
    for section in ("fasi", "eventi", "luci", "acqua", "ambiente", "nutrienti"):
        assert set(candidate[section]) == PHASES, section
assert any(plan["eventi"].values())
assert any(any(level > 0 for level in mix) for mix in plan["luci"].values())
assert any(config["ore"] for config in plan["acqua"].values())
assert all(not events for events in example["eventi"].values())
assert all(all(level == 0 for level in mix) for mix in example["luci"].values())
assert all(not config["ore"] for config in example["acqua"].values())
assert all(
    config[nutrient] == 0
    for periods in example["nutrienti"].values()
    for config in periods
    for nutrient in ("grow", "micro", "bloom")
)

# Il parser del progetto legge /config: lo adattiamo solo in memoria per
# verificare entrambi i piani, senza scrivere in /config né alterare il parser.
parser_source = parser_path.read_text(encoding="utf-8")
needle = 'open("/config/serra_piano.yaml"'
assert parser_source.count(needle) == 1
for path, inert in ((plan_path, False), (example_path, True)):
    source = parser_source.replace(needle, f"open({str(path)!r}", 1)
    result = subprocess.run(
        [sys.executable, "-c", source],
        capture_output=True,
        text=True,
        check=True,
    )
    parsed = json.loads(result.stdout)
    assert len(parsed["fasi"]) == 6  # cinque fasi + conclusa
    assert parsed["fotoperiodica"]["fasi"]
    if inert:
        assert not parsed["eventi"]
        assert all(not mix or all(level == 0 for level in mix) for mix in parsed["luci"].values())
    else:
        assert parsed["eventi"]
        assert parsed["fotoperiodica"]["eventi"]
print("OK: package YAML e due piani validi; esempio inerte")
