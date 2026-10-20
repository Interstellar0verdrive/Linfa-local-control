# 07 · Attivare i servizi automatici

**Percorso guidato:** [Indice dei capitoli](../index.md)

Con il bridge già funzionante, configura i timer per spegnere la rete del VoCore dopo l'avvio e sincronizzare periodicamente lo stato.

## Service + timer: spegnimento rete VoCore dopo boot

Questo service spegne la rete della serra (comando `serra net off`)
Il timer fa avvenire questa azione una sola volta, dopo 60 secondi dal boot

La serra deve essere già accesa e raggiungibile via UART quando il timer scatta. Se si accende più tardi, controlla il log con `journalctl -u serra-netoff.service -n 30 --no-pager` ed esegui `sudo systemctl start serra-netoff.service` dopo averla accesa: questo timer non riprova automaticamente.

### Service one-shot

```bash
sudo nano /etc/systemd/system/serra-netoff.service
```

```ini {.file-content}
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

```ini {.file-content}
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
```

**Risposta attesa:** una riga con `serra-netoff.timer` e `serra-netoff.service`. Essendo un timer che scatta una sola volta dopo il boot, la prossima esecuzione può apparire come `-` dopo che è già partito. Date, orari e spaziatura dipendono dal sistema.

---

## Service + timer: state sync periodico

Questo service fa un sync dello stato della serra (comando `serra state sync`)
Il timer ripete questa azione ogni 30 minuti

### Service

```bash
sudo nano /etc/systemd/system/serra-state-sync.service
```

```ini {.file-content}
[Unit]
Description=Serra: MQTT state sync

[Service]
Type=oneshot
User=pi
EnvironmentFile=/etc/serra-mqtt.env
ExecStart=/usr/local/bin/serra state sync
```

### Timer

> [!NOTE] Nota
> Il timer usa `OnBootSec` e `OnUnitActiveSec`: la sincronizzazione parte circa 2 minuti dopo il boot e si ripete ogni 30 minuti.

```bash
sudo nano /etc/systemd/system/serra-state-sync.timer
```

```ini {.file-content}
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
journalctl -u serra-state-sync.service -n 50 --no-pager
```

**Risposta attesa:** nell'elenco compaiono `serra-state-sync.timer` associato a `serra-state-sync.service` e `serra-netoff.timer` associato a `serra-netoff.service`. Il log del servizio di sincronizzazione deve contenere `STATE SYNC OK` e una conclusione senza errori. Date e intervalli sono variabili.

### Comandi utili per verificare i timer e services

Per verificare il timer che spegne la rete dopo il boot:

```bash
systemctl status serra-netoff.timer --no-pager
systemctl list-timers --all | grep -i serra
```

Per verificare il timer di sincronizzazione e gli ultimi log:

```bash
systemctl status serra-state-sync.timer --no-pager
systemctl list-timers --all | grep -i serra
sudo journalctl -u serra-state-sync.service -n 50 --no-pager
```

Per elencare tutti i timer della serra:

```bash
systemctl list-timers --all | grep -i serra
```

Se serve eseguire manualmente i servizi **dopo aver acceso la serra**, avviali uno alla volta:

```bash
sudo systemctl start serra-netoff.service
```

```bash
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

> [!TIP] Controllo
> **Verifica prima di proseguire:** I timer sono attivi e i relativi servizi risultano verificati.

<table width="100%" class="step-nav">
  <tr>
    <td width="50%" align="left"><strong>Passo precedente</strong><br><a href="06-bridge-mqtt.md">← 06 · Configurare il bridge MQTT</a></td>
    <td width="50%" align="right"><strong>Passo successivo</strong><br><a href="08-home-assistant.md">08 · Collegare Home Assistant →</a></td>
  </tr>
</table>
