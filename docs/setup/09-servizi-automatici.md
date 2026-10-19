# 09 · Attivare i servizi automatici

**Percorso guidato:** [Indice dei capitoli](../index.md)

Con il bridge già funzionante, configura i timer per spegnere la rete del VoCore dopo l'avvio e sincronizzare periodicamente lo stato.

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

## Continua il percorso

**Prima di proseguire:** I timer sono attivi e i relativi servizi risultano verificati.

[Passo 10 · Collegare Home Assistant →](10-home-assistant.md)

[← Passo 08 · Configurare il bridge MQTT](08-bridge-mqtt.md) · [Indice completo](../index.md)
