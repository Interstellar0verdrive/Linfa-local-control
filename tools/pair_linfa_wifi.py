#!/usr/bin/env python3
"""Pair a Linfa from its temporary AP using the observed local HTTP API.

Run only while connected to the greenhouse AP and with the router WAN unplugged.
The device token and home Wi-Fi password are prompted interactively;
neither is accepted on the command line or printed by this program.
"""

import argparse
import getpass
import ipaddress
import json
from urllib import error, request


def main() -> int:
    parser = argparse.ArgumentParser(description="Pairing locale della serra Linfa")
    parser.add_argument("--host", default="192.168.247.1", help="IP della serra sulla sua rete temporanea")
    args = parser.parse_args()
    try:
        address = ipaddress.IPv4Address(args.host)
        host = str(address)
        if not any(address in network for network in (
            ipaddress.IPv4Network("10.0.0.0/8"),
            ipaddress.IPv4Network("172.16.0.0/12"),
            ipaddress.IPv4Network("192.168.0.0/16"),
        )):
            parser.error("usa soltanto un indirizzo IPv4 privato della serra")
    except ValueError as exc:
        parser.error(str(exc))

    print("Usa questo programma solo sulla rete temporanea LINFA, con la WAN del router scollegata.")
    print("La richiesta può riavviare la radio e sostituire il token salvato nella serra.")
    ssid = input("SSID della rete domestica: ")
    password = getpass.getpass("Password della rete domestica: ")
    token = getpass.getpass("Token privato da associare alla serra (originale o nuovo): ")
    if not ssid or not password or not token:
        parser.error("SSID, password e token devono essere presenti")

    payload = json.dumps({
        "usr-token": token,
        "SSID": ssid,
        "security": "wpa2psk",
        "password": password,
        "encryption": "AES",
    }).encode("utf-8")
    req = request.Request(
        f"http://{host}/credentials",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=8) as response:
            print(f"Risposta HTTP: {response.status}. Controlla sul router il nuovo IP della serra.")
    except error.HTTPError as exc:
        print(f"Errore HTTP {exc.code}: pairing non confermato. Controlla la serra prima di riprovare.")
        return 1
    except (error.URLError, TimeoutError, OSError) as exc:
        print(f"Risposta interrotta ({type(exc).__name__}). La radio può essersi riavviata:")
        print("controlla sul router se la serra è entrata nella LAN; non ripetere subito la richiesta.")
        return 2
    finally:
        password = ""
        token = ""
        payload = b""
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
