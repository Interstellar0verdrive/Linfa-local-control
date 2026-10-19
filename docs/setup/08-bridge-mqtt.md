# 08 · Configurare il bridge MQTT

**Percorso guidato:** [Indice dei capitoli](../index.md)

Prosegui dopo aver verificato il controller CLI nel passo 07. Qui configuri il broker, il servizio e una prova MQTT completa.

## Prima di configurare il bridge: broker MQTT

### Broker MQTT

È necessario un broker MQTT raggiungibile sia da:

- Raspberry
- Home Assistant

Soluzioni tipiche:

- Mosquitto add-on su Home Assistant
- Broker MQTT esterno (NAS, server Linux)

Requisiti minimi:

- porta 1883
- autenticazione user/password
- supporto messaggi retained

---

### Credenziali MQTT

Le stesse credenziali devono essere:

- in `/etc/serra-mqtt.env` sul Raspberry
- configurate in Home Assistant

Esempio (usato nel setup):

```bash
host: <LOCAL_IP>
port: 1883
user: <MQTT_USER>
password: <MQTT_PASSWORD>
```

---

## Creazione file /etc/serra-mqtt.env

> [!CAUTION]
> `/etc/serra-mqtt.env` contiene le credenziali MQTT e la password root della serra. Conservalo solo sul Raspberry e non caricarlo nella repository o nelle issue.

Puoi partire dal [modello senza credenziali](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/serra-mqtt.env.example).

```bash
sudo nano /etc/serra-mqtt.env
```

Contenuto (tutti i dati qui riportato sono quelli del broker MQTT, che nel nostro caso sarà mosquitto in Home Assistant):

```bash
SERRA_MQTT_HOST=<LOCAL_IP>
SERRA_MQTT_PORT=1883
SERRA_MQTT_USER=<MQTT_USER>
SERRA_MQTT_PASS=<MQTT_PASSWORD>
SERRA_MQTT_TOPIC=serra
SERRA_CLI=serra
SERRA_ROOT_PASSWORD=<DEVICE_ROOT_PASSWORD>
```

Permessi:

```bash
sudo chown root:root /etc/serra-mqtt.env
sudo chmod 600 /etc/serra-mqtt.env
```

Verifica i permessi senza stampare le credenziali: `sudo stat -c '%a %U:%G' /etc/serra-mqtt.env` deve mostrare `600 root:root`.

---

## Service systemd: MQTT Bridge

Avvia e mantiene in esecuzione serra_mqtt_bridge.py (subscriber su serra/cmd → invoca CLI serra ... → pubblica serra/status/* + stati via controller).

È configurato con Restart=always per resilienza.

### File service

```bash
sudo nano /etc/systemd/system/serra-mqtt-bridge.service
```

Contenuto:

```bash
[Unit]
Description=Serra MQTT Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
EnvironmentFile=/etc/serra-mqtt.env
ExecStart=/usr/bin/python3 /home/pi/serra_mqtt_bridge.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Enable e start

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now serra-mqtt-bridge.service
```

Verifica:

```bash
systemctl status serra-mqtt-bridge.service --no-pager
journalctl -u serra-mqtt-bridge.service -n 100 --no-pager

# Deve restituire qualcosa tipo:
# ● serra-mqtt-bridge.service - Serra MQTT Bridge
# Loaded: loaded (/etc/systemd/system/serra-mqtt-bridge.service; enabled; preset: enabled)
# Active: active (running) since Sat 2026-01-24 22:07:57 CET; 15h ago
# Invocation: 02b877426811403fb1f1736729a9bc28
# Main PID: 1021 (python3)
# Tasks: 1 (limit: 764)
# CPU: 7.403s
# CGroup: /system.slice/serra-mqtt-bridge.service
# └─1021 /usr/bin/python3 /home/pi/serra_mqtt_bridge.py
# # Jan 24 22:07:57 serra systemd[1]: Started serra-mqtt-bridge.service - Serra MQTT Bridge.
```

---

## Verifica MQTT end-to-end

### Stato bridge

Il bridge pubblica:

```
serra/status/online
serra/status/last_seen
```

Verifica:

```bash
mosquitto_sub -h <LOCAL_IP> -u <MQTT_USER> -P '<DEVICE_PASSWORD>' -t "serra/status/#" -v

# Deve rispondere qualcosa che comincia con:
# serra/status/online {"ok": true, "msg": "bridge online", "cli": "serra"... ... ...
```

Per uscire: `CTRL + C`

### Comando via MQTT

```bash
# Proviamo ad accendere le luci con un fade in di 3 secondi:
mosquitto_pub -h <LOCAL_IP> -u <MQTT_USER> -P '<DEVICE_PASSWORD>' \
  -t serra/cmd -m "lights on -f 3"

# Poi per spegnere:
mosquitto_pub -h <LOCAL_IP> -u <MQTT_USER> -P '<DEVICE_PASSWORD>' \
  -t serra/cmd -m "lights off"
```

Verifica che lo stato venga aggiornato su `serra/state/...`:

```bash
mosquitto_sub -h <LOCAL_IP> -u <MQTT_USER> -P '<DEVICE_PASSWORD>' -t "serra/status/last" -v
# Deve rispondere con qualcosa che indichi l'ultimo comando dato (nel nostro caso lights off):
# serra/status/last {"ok": true, "rc": 0, "cmd": ["lights", "off"], "stdout": "✅ LIGHTS OFF (fade ~0.0s)", "stderr": "", "topic": "serra/cmd", "ts": 1769346265.2262807, "ts_iso": "2026-01-25T13:04:25.226281Z", "ts_local": "2026-01-25T14:04:25.226281+01:00"}
```

Per uscire: `CTRL + C`

---

## Continua il percorso

> [!TIP]
> **Verifica prima di proseguire:** Il servizio bridge è attivo e i topic di stato e comando rispondono.

| Passo precedente | Passo successivo |
| :--- | ---: |
| [← 07 · Installare e provare il controller CLI](07-controller-cli.md) | [09 · Attivare i servizi automatici →](09-servizi-automatici.md) |
