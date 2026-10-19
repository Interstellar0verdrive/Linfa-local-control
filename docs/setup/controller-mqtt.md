# Controller CLI serra e MQTT Bridge (installazione e configurazione)

In questo capitolo installiamo **tutto il controllo attivo** sul Raspberry:

- CLI serra (controller Python)
- bridge MQTT → CLI
- file di stato
- file di configurazione MQTT
- servizi e timer systemd

**Assunzioni in ingresso (stato iniziale):**

- Raspberry pronto, con UART funzionante
- Nessun file serra_*.py ancora installato
- Nessun servizio serra-* attivo

Questi sono tutti i files coinvolti:

| FILE | DESCRIZIONE | NOTE |
| --- | --- | --- |
| /home/pi/serra_help.txt | **Help CLI**: è usato dal comando `serra --help` (il path è hardcoded nel controller) | Va copiato a mano nel Raspberry al primo setup. |
| /home/pi/serra_controller.py | **Controller**: cuore logico del sistema (CLI, UART, stato, MQTT publish) | Va copiato a mano nel Raspberry al primo setup. |
| /home/pi/serra_mqtt_bridge.py | **MQTT Bridge**: si occupa di fare la traduzione MQTT → CLI | Va copiato a mano nel Raspberry al primo setup. |
| /home/pi/.serra_state.json | **Stato runtime (source of truth logica):** cache JSON con ultimo stato noto dei componenti + ultimi comandi. Viene aggiornata dalla CLI ad ogni comando e usata per pubblicare serra/state/... su MQTT (retained). | Viene creata/aggiornata automaticamente dal controller al primo comando (serra ...). Non va caricata manualmente al primo setup.  |
| /etc/serra-mqtt.env | **Configurazione MQTT**: contiene segreti + parametri runtime | Va creato “a mano” nel Raspberry al primo setup. |
| /etc/systemd/system/serra-mqtt-bridge.service | **Service systemd del MQTT Bridge:** avvia e mantiene in esecuzione serra_mqtt_bridge.py (subscriber su serra/cmd → invoca CLI serra ... → pubblica serra/status/* + stati via controller). | Va creato “a mano” nel Raspberry al primo setup (insieme a /etc/serra-mqtt.env). Poi: daemon-reload + enable --now. È configurato con Restart=always per resilienza. |
| /etc/systemd/system/serra-netoff.service e .timer | Il service spegne la rete della serra; il timer lo richiama dopo il boot. | Vanno creati sul Raspberry. |
| /etc/systemd/system/serra-state-sync.service e .timer | Il service sincronizza lo stato; il timer lo richiama periodicamente. | Vanno creati sul Raspberry. |

File della repository: [controller CLI](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/serra_controller.py), [bridge MQTT](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/serra_mqtt_bridge.py) e [help CLI](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/serra_help.txt).

---

## Copia dei file Python sul Raspberry

Copia sul Raspberry i tre file principali. Sul computer da cui esegui la copia, clona la repository e usa i file della cartella `bridge/`:

```bash
git clone https://github.com/Interstellar0verdrive/Linfa-local-control.git
cd Linfa-local-control
scp bridge/serra_controller.py bridge/serra_mqtt_bridge.py bridge/serra_help.txt pi@<RASPBERRY_IP>:/home/pi/
```

Sostituisci `<RASPBERRY_IP>` prima di eseguire il comando. Per verificare, accedi al Raspberry:

```bash
ssh pi@<RASPBERRY_IP>
```

Impostare permessi di esecuzione:

```bash
chmod +x /home/pi/serra_controller.py /home/pi/serra_mqtt_bridge.py
```

Verifica:

```bash
ls -la /home/pi/serra_controller.py /home/pi/serra_mqtt_bridge.py

# Deve rispondere qualcosa tipo:
# -rwxrwxr-x 1 pi pi 53716 Jan 11 21:10 /home/pi/serra_controller.py
# -rwxrwxr-x 1 pi pi 15113 Jan 10 16:29 /home/pi/serra_mqtt_bridge.py
```

---

## Creazione symlink CLI /usr/local/bin/serra

Il comando serra **non è una copia**, ma un symlink al file Python.

Questo consente di:

- aggiornare il controller modificando solo `serra_controller.py`
- non toccare systemd o il PATH

```bash
sudo ln -sf /home/pi/serra_controller.py /usr/local/bin/serra
```

Verifica:

```bash
readlink -f /usr/local/bin/serra
which serra

# Deve rispondere:
# /home/pi/serra_controller.py
# /usr/local/bin/serra
```

---

## Test iniziale della CLI

Prima di introdurre il bridge MQTT, verificare che la CLI funzioni **localmente**.

Il controller non contiene una password root predefinita. In questa sessione di terminale imposta la password della console della **tua** serra senza scriverla nella cronologia della shell:

```bash
read -rsp 'Password della console della serra: ' SERRA_ROOT_PASSWORD; echo
export SERRA_ROOT_PASSWORD
```

Per i servizi automatici, la stessa variabile sarà inserita nel file locale `/etc/serra-mqtt.env`, che non deve essere caricato su GitHub.

```bash
serra --help
# Mostra l'help del comando
```

Test di comunicazione UART (non distruttivo):

```bash
serra state sync
# Deve rispondere: STATE SYNC OK
```

Eseguire alcuni comandi di test:

```bash
# accendiamo le luci con un fade in di 2 secondi:
serra lights on -f 2
# spegniamo le luci con un fade out di 2 secondi:
serra lights off -f 2
# accendiamo le ventole al 75% (velocità media):
serra fans on
# spegniamo le ventole:
serra fans off
```

Se questi comandi:

- non vanno in errore
- producono output coerente

allora il controller è operativo.

---

## File di stato locale

Il controller usa un file JSON per mantenere lo stato logico: `/home/pi/.serra_state.json`

Il file viene **creato automaticamente** al primo comando serra.

Non serve quindi caricarlo a mano ora.
Nel passaggio precedente abbiamo già dato alcuni comandi di test, quindi dovrebbe già esistere.

Verifica:

```bash
ls -la /home/pi/.serra_state.json
cat /home/pi/.serra_state.json | jq .

# Deve rispondere qualcosa tipo:
# -rw-r--r-- 1 pi pi 7442 Jan 25 13:16 /home/pi/.serra_state.json
# {
# "meta": {
# "schema": 1,
# "ts": 1769343395.0795484,
# "ts_iso": "2026-01-25T12:16:35.079548Z",
# "ts_local": "2026-01-25T13:16:35.079548+01:00"
# },
# "last_seen": {
# "ts": 1769343395.0793698,
# "ts_iso": "2026-01-25T12:16:35.079370Z",
# "ts_local": "2026-01-25T13:16:35.079370+01:00"
# },
# "lights": {
# "state": {
# ...
# ...
```

Nota:

- questo file è la *source of truth* per gli stati pubblicati su MQTT
- non è telemetria hardware diretta

---

## Creazione file /etc/serra-mqtt.env

Questo file contiene configurazione e credenziali locali, separate dal codice. Non copiarlo nella repository. Puoi partire dal [modello senza credenziali](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/serra-mqtt.env.example).

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

## Service + timer: spegnimento rete VoCore dopo boot

Questo service spegne la rete della serra (comando `serra net off`)
Il timer fa avvenire questa azione una sola volta, dopo 60 secondi dal boot

### Service one-shot

```bash
sudo nano /etc/systemd/system/serra-netoff.service
```

```bash
[Unit]
Description=Serra: disable VoCore network (net off)
After=network.target

[Service]
Type=oneshot
User=pi
EnvironmentFile=/etc/serra-mqtt.env
ExecStart=/usr/local/bin/serra net off
```

### Timer

```bash
sudo nano /etc/systemd/system/serra-netoff.timer
```

```bash
[Unit]
Description=Serra: run net off once after boot (60s)

[Timer]
OnBootSec=60
AccuracySec=1s
Persistent=false

[Install]
WantedBy=timers.target
```

### Enable

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now serra-netoff.timer
```

Verifica:

```bash
systemctl list-timers --all | grep serra

# Deve restituire qualcosa tipo:
# -                                 - Sun 2026-01-25 10:14:51 CET 3h 55min ago serra-netoff.timer           serra-netoff.service
```

---

## Service + timer: state sync periodico

Questo service fa un sync dello stato della serra (comando `serra state sync`)
Il timer ripete questa azione ogni 30 minuti

### Service

```bash
sudo nano /etc/systemd/system/serra-state-sync.service
```

```bash
[Unit]
Description=Serra: MQTT state sync

[Service]
Type=oneshot
User=pi
EnvironmentFile=/etc/serra-mqtt.env
ExecStart=/usr/local/bin/serra state sync
```

### Timer

Nota: viene usato OnBootSec + OnUnitActiveSec, così l’azione parte dopo ~ 2 minuti dal boot e poi ciclicamente viene ripetuta ogni 30 minuti.

```bash
sudo nano /etc/systemd/system/serra-state-sync.timer
```

```bash
[Unit]
Description=Serra: run state sync every 30 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=30min
AccuracySec=10s
Persistent=true

[Install]
WantedBy=timers.target
```

### Enable

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now serra-state-sync.timer
```

Verifica:

```bash
systemctl list-timers --all | grep serra
# Deve restituire qualcosa tipo:
# Sun 2026-01-25 14:16:34 CET    5min Sun 2026-01-25 13:46:34 CET    24min ago serra-state-sync.timer       serra-state-sync.service
# -                                 - Sun 2026-01-25 10:14:51 CET 3h 55min ago serra-netoff.timer           serra-netoff.service

journalctl -u serra-state-sync.service -n 50 --no-pager
# Deve restituire uno o più gruppi di righe come:
# Jan 25 13:46:34 serra systemd[1]: Starting serra-state-sync.service - Serra: MQTT state sync...
# Jan 25 13:46:35 serra serra[1850]: ✅ STATE SYNC OK
# Jan 25 13:46:35 serra systemd[1]: serra-state-sync.service: Deactivated successfully.
# Jan 25 13:46:35 serra systemd[1]: Finished serra-state-sync.service - Serra: MQTT state sync.
```

### Comandi utili per verificare i timer e services

```bash
# verificare timer A: One-shot: “net off” 60s dopo il boot:
systemctl status serra-netoff.timer --no-pager
systemctl list-timers --all | grep -i serra

# verifica e log timer B: Sync ogni 30 minuti: “serra state sync”:
systemctl status serra-state-sync.timer --no-pager
systemctl list-timers --all | grep -i serra
# ultimi log del sync:
sudo journalctl -u serra-state-sync.service -n 50 --no-pager

# vedere tutti i timer serra:
systemctl list-timers --all | grep -i serra

# forzare manualmente i singoli service:
sudo systemctl start serra-netoff.service
sudo systemctl start serra-state-sync.service
```

---

## Stato atteso a fine capitolo

A questo punto questo dovrebbe essere lo stato attuale:

- ✅ comando serra funzionante
- ✅ controllo serra via UART
- ✅ bridge MQTT attivo e resiliente
- ✅ stati MQTT retained coerenti
- ✅ rete VoCore spenta automaticamente dopo boot
- ✅ state sync periodico attivo

Da qui in poi:

- Home Assistant può essere configurato
- il Raspberry è l’unico punto di controllo e osservabilità

---

## Backup facoltativo dei file sul Raspberry

I file Python originali sono già nella repository. Se li hai modificati sul Raspberry, puoi scaricarne una copia locale dal tuo computer:

```bash
cd ~/Downloads
TS=$(date +"%Y%m%d_%H%M")

scp pi@<RASPBERRY_IP>:/home/pi/serra_controller.py \
    serra_controller_${TS}.py

scp pi@<RASPBERRY_IP>:/home/pi/serra_mqtt_bridge.py \
    serra_mqtt_bridge_${TS}.py
```

Sostituisci `<RASPBERRY_IP>` prima di eseguire i comandi. Il file `/etc/serra-mqtt.env` contiene segreti: se vuoi conservarne un backup, trattalo separatamente come materiale riservato e non caricarlo su GitHub.

---
