# 03 · Preparare il Raspberry Pi

**Percorso guidato:** [Indice dei capitoli](../index.md)

Obiettivo di questa sezione: preparare un Raspberry Pi “vergine” (solo OS + rete) con tutto l’ambiente necessario per:

- aprire la console UART della serra (debug con picocom)
- eseguire script Python (controller e bridge, che verranno copiati nel passo 06)
- parlare con MQTT (lato Python + strumenti CLI per test)
- predisporre permessi e cartelle standard

> [!IMPORTANT] Da sapere prima di iniziare
> Prima di iniziare: Raspberry con Debian/Raspberry Pi OS aggiornabile via APT, connesso alla rete domestica, adattatore USB→TTL a 3,3 V collegato e un utente con `sudo`. **Gli esempi usano l'utente `pi` e il percorso `/home/pi`: scegli `pi` durante la preparazione del sistema oppure sostituisci entrambi con il tuo nome utente e la tua home in tutti i comandi.** La password del Raspberry è distinta dalla password root della serra.

---

## Identificare il sistema e verifica connettività

Sul Raspberry (anche collegandoti via SSH dal tuo computer, che può usare macOS, Windows o Linux):

```bash
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

Se l'aggiornamento ha installato un nuovo kernel o richiede un riavvio, esegui `sudo reboot`, attendi il ritorno del Raspberry e riconnettiti via SSH prima dei passi successivi.

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
  nano \
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

Nel setup finale non è indispensabile perché `python3-paho-mqtt` e `python3-serial` vengono installati via APT. Se ti serve `pip` per altri progetti, puoi aggiungerlo:

```bash
sudo apt install -y python3-pip
```

---

## Verifica ambiente Python

Verifica versione:

```bash
python3 --version
```

**Risposta attesa:** Python **3.10 o successivo**. Il bridge usa sintassi introdotta in Python 3.10; se il sistema ha 3.9 o precedente, aggiorna Raspberry Pi OS prima di copiare gli script.

Verifica che i moduli necessari siano importabili **prima** di caricare gli script:

```bash
python3 -c "import paho.mqtt.client as c; print('paho OK')"
python3 -c "import serial; print('pyserial OK')"
```

```text {.expected-output}
paho OK
pyserial OK
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
```

**Risposta attesa:** almeno un dispositivo seriale, tipicamente `/dev/ttyUSB0`, appartenente al gruppo `dialout`. Il percorso può variare. Poiché il comando sopprime gli errori, non vedrai il messaggio “No such file or directory” per i pattern che non corrispondono. Se la tua porta non è `/dev/ttyUSB0`, usa il percorso effettivo nei passi 04 e 05 e imposta `SERRA_UART_PORT` nel file di configurazione del passo 07.

### Verifica gruppo dialout

L’utente che eseguirà i comandi (tipicamente pi) deve poter aprire la seriale.

```bash
groups
getent group dialout || true
ls -l /dev/ttyUSB0 2>/dev/null || true
```

**Risposta attesa:** `groups` include `dialout`, `getent group dialout` mostra il gruppo e `ls -l` mostra la porta seriale. Nomi, date e numeri variano da sistema a sistema.
Se la porta trovata sopra ha un nome diverso, sostituisci `/dev/ttyUSB0` nell'ultimo comando.

Se l'utente `pi` **non** è in `dialout`, aggiungilo (sostituisci `pi` se usi un altro utente):

```bash
sudo usermod -aG dialout pi
```

Poi disconnettiti e riconnettiti via SSH perché la nuova appartenenza al gruppo abbia effetto.

---

## Predisposizione cartelle e convenzioni

Per evitare confusione nei capitoli successivi, prepara già una struttura standard:

```bash
mkdir -p /home/pi/serra
mkdir -p /home/pi/serra/_bak
```

Suggerimento pratico:

- nel passo 06 copierai `serra_controller.py` e `serra_mqtt_bridge.py` in `/home/pi/`
- useremo poi un symlink per rendere disponibile il comando `serra`.

---

## (Opzionale) Verifica raggiungibilità broker MQTT prima di configurare il bridge

Se il broker MQTT esiste già (es. Mosquitto su `<BROKER_IP>`:1883), puoi fare un test. **Apri due terminali sul Raspberry:** nel primo avvia il subscriber; nel secondo pubblica il messaggio. Avviare il subscriber dopo la pubblicazione non mostrerebbe il messaggio, perché il test non usa un topic retained.

**Primo terminale:** resta in attesa di un messaggio.

```bash
mosquitto_sub -h <BROKER_IP> -p 1883 -u <MQTT_USER> -P '<MQTT_PASSWORD>' -t serra/test -C 1
```

**Secondo terminale:** invia il messaggio di prova.

```bash
mosquitto_pub -h <BROKER_IP> -p 1883 -u <MQTT_USER> -P '<MQTT_PASSWORD>' -t serra/test -m "hello"
```

Il primo terminale deve mostrare `hello` e terminare. Sostituisci tutti i segnaposto prima di eseguire i comandi.

In questa fase non creiamo ancora `/etc/serra-mqtt.env`: lo faremo più avanti, insieme ai file e ai servizi.

---

## Stato atteso a fine capitolo

Alla fine di questo capitolo, il Raspberry deve avere:

- ✅ sistema aggiornato
- ✅ python3 funzionante
- ✅ moduli python3-serial e python3-paho-mqtt disponibili (import OK)
- ✅ picocom installato; il test della UART è nel passo 04
- ✅ mosquitto-clients installato (per test futuri)
- ✅ utente scelto per i servizi (negli esempi, `pi`) in gruppo `dialout`
- ✅ cartelle predisposte per i file del progetto

---

## Continua il percorso

> [!TIP] Controllo
> **Verifica prima di proseguire:** Python, picocom, i pacchetti richiesti e i permessi seriali sono pronti.

<table width="100%" class="step-nav">
  <tr>
    <td width="50%" align="left"><strong>Passo precedente</strong><br><a href="02-hardware.md">← 02 · Hardware e collegamenti</a></td>
    <td width="50%" align="right"><strong>Passo successivo</strong><br><a href="04-uart.md">04 · Verificare la console UART →</a></td>
  </tr>
</table>
