# 07 · Installare e provare il controller CLI

**Percorso guidato:** [Indice dei capitoli](../index.md)

In questo passo copi gli script sul Raspberry e verifichi il **controller CLI** tramite UART. Il bridge MQTT e i servizi automatici saranno configurati nei passi 08 e 09.

**Assunzioni in ingresso (stato iniziale):**

- Raspberry pronto, con UART funzionante
- Nessun file serra_*.py ancora installato
- Nessun servizio serra-* attivo

Questi sono i file coinvolti nei passi 07–09:

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

> [!NOTE]
> Il file di stato è la fonte logica degli stati pubblicati su MQTT. Registra l'ultimo stato noto al controller; non è una misura hardware diretta.

---

## Continua il percorso

> [!TIP]
> **Verifica prima di proseguire:** Il comando `serra state sync` funziona dal Raspberry tramite UART.

| Passo precedente | Passo successivo |
| :--- | ---: |
| [← 06 · Verificare la rete](06-rete.md) | [08 · Configurare il bridge MQTT →](08-bridge-mqtt.md) |
