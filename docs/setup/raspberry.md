# Preparazione del Raspberry

Obiettivo di questa sezione: preparare un Raspberry Pi “vergine” (solo OS + rete) con tutto l’ambiente necessario per:

- aprire la console UART della serra (debug con picocom)
- eseguire script Python (controller + bridge, che verranno copiati nel capitolo 8)
- parlare con MQTT (lato Python + strumenti CLI per test)
- predisporre permessi e cartelle standard

**Assunzioni in ingresso (stato iniziale):**

- Raspberry con Debian/Raspberry Pi OS installato e aggiornabile via APT (Pi OS Lite consigliato)
- Raspberry connesso alla rete domestica (via Wi-Fi o Ethernet)
- adattatore USB→TTL 3.3V già collegato e visibile come /dev/ttyUSB0 (o simile)
- utente del raspberry con permessi di root: `pi` (con password: `<DEVICE_PASSWORD>`)

---

## Identificare il sistema e verifica connettività

Sul Raspberry (eventualmente collegandosi dal Mac via SSH):

```bash
set -e

date
hostname
uname -a
cat /etc/os-release
```

Verificare rete (deve uscire su Internet per installare pacchetti):

```bash
ip a
ip r
ping -c 1 1.1.1.1
ping -c 1 deb.debian.org || true
```

---

## Aggiornare repository e pacchetti base

```bash
sudo apt update
sudo apt -y full-upgrade
sudo apt -y autoremove
```

---

## Installa i pacchetti necessari

### Pacchetti “core”

Questi servono al funzionamento reale (UART, Python, dipendenze Python via APT):

```bash
sudo apt install -y \
  python3 \
  python3-serial \
  python3-paho-mqtt \
  picocom \
  curl
```

### Pacchetti “tooling” consigliati (debug/test)

Non sono strettamente obbligatori, ma semplificano moltissimo test e troubleshooting:

```bash
sudo apt install -y \
  mosquitto-clients \
  jq \
  git
```

### (Opzionale ma consigliato) Installa pip

Nel setup finale non è indispensabile perché verranno usati p`ython3-paho-mqtt` e `python3-serial` via APT, ma lo installiamo comunque perché torna sempre utile:

```bash
sudo apt install -y python3-pip
```

---

## Verifica ambiente Python

Verifica versione:

```bash
python3 --version
# Deve restituire qualcosa tipo: Python 3.13.5
```

Verifica che i moduli necessari siano importabili **prima** di caricare gli script:

```bash
python3 -c "import paho.mqtt.client as c; print('paho OK')"
python3 -c "import serial; print('pyserial OK')"
# Deve restituire:
# paho OK
# pyserial OK
```

Verifica presenza strumenti (se installati):

```bash
which picocom python3 pip3 mosquitto_pub mosquitto_sub jq git || true
```

---

## Permessi seriale (dialout) e device UART

### Identifica la porta seriale

Con adattatore collegato:

```bash
ls -l /dev/ttyUSB* /dev/ttyACM* 2>/dev/null || true

# Deve restituire qualcosa tipo:
# ls: cannot access '/dev/ttyACM*': No such file or directory
# crw-rw---- 1 root dialout 188, 0 Jan 24 16:17  /dev/ttyUSB0
```

Tipicamente: `/dev/ttyUSB0`.

### Verifica gruppo dialout

L’utente che eseguirà i comandi (tipicamente pi) deve poter aprire la seriale.

```bash
groups
getent group dialout || true
ls -l /dev/ttyUSB0 2>/dev/null || true

# Deve restituire qualcosa tipo:
# pi adm dialout cdrom sudo audio video plugdev games users netdev gpio i2c spi render input
# dialout:x:20:pi
# crw-rw---- 1 root dialout 188, 0 Jan 25 10:46 /dev/ttyUSB0
```

Se pi **non** è in dialout, aggiungilo:

```bash
sudo usermod -aG dialout pi
# poi disconnetti e riconnettiti via SSH (logout/login)
```

---

## Predisposizione cartelle e convenzioni

Per evitare confusione nei capitoli successivi, prepara già una struttura standard:

```bash
mkdir -p /home/pi/serra
mkdir -p /home/pi/serra/_bak
```

Suggerimento pratico:

- nel capitolo 8 copierai serra_controller.py e serra_mqtt_bridge.py in /home/pi/
- oppure (più ordinato) dentro /home/pi/serra/ e poi farai symlink; scegliamo nel capitolo 8 e lo rendiamo “canonical”.

---

## (Opzionale) Verifica raggiungibilità broker MQTT prima di configurare il bridge

Se il broker MQTT esiste già (es. Home Assistant/Mosquitto su <LOCAL_IP>:1883), puoi fare un test “grezzo”:

```bash
mosquitto_pub -h <LOCAL_IP> -p 1883 -u <MQTT_USER> -P 'PASSWORD' -t serra/test -m "hello"
mosquitto_sub -h <LOCAL_IP> -p 1883 -u <MQTT_USER> -P 'PASSWORD' -t serra/test -C 1
```

In questa fase non creiamo ancora `/etc/serra-mqtt.env`: lo faremo più avanti, insieme ai file e ai servizi.

---

## Stato atteso a fine capitolo

Alla fine di questo capitolo, il Raspberry deve avere:

- ✅ sistema aggiornato
- ✅ python3 funzionante
- ✅ moduli python3-serial e python3-paho-mqtt disponibili (import OK)
- ✅ picocom installato e test UART riuscito
- ✅ mosquitto-clients installato (per test futuri)
- ✅ utente pi in gruppo dialout
- ✅ cartelle predisposte per i file del progetto

---
