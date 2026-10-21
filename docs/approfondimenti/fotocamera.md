# Foto della serra (facoltativo)

Il controllo locale di luci, ventole e pompe **non richiede la fotocamera**. La pipeline foto è un'aggiunta facoltativa: il Raspberry riattiva temporaneamente la Wi-Fi della serra, acquisisce un'immagine dalla fotocamera interna via SSH, ripristina le luci e la rete, poi pubblica l'immagine sul broker MQTT. L'app Home Assistant può mostrarla e archiviarla; la sua configurazione completa verrà pubblicata con l'app.

Questa procedura deriva dal prototipo. **Non è stata verificata su una seconda serra**: controlla prima che il tuo firmware abbia `fswebcam`, `/dev/video0` e un server SSH raggiungibile dal Raspberry quando la Wi-Fi della serra è accesa. La serra deve già conoscere una rete Wi-Fi raggiungibile dal Raspberry. Se uno di questi requisiti manca, lascia la funzione foto disattivata: il resto della guida funziona comunque.

> [!WARNING] Durante lo scatto
> La pipeline cambia per qualche secondo il mix delle luci. Se non riesce a leggere lo stato precedente, annulla la foto; se il ripristino fallisce, pubblica un errore su `serra/status/last`. Fai la prima prova solo mentre puoi osservare la serra e controllare le luci al termine. La funzione usa la password root della serra: conservala solo nel file privato `/etc/serra-mqtt.env` sul Raspberry. Chi può leggere i topic MQTT della fotocamera può vedere l'interno della serra.

## Verifiche preliminari

Dal Raspberry, apri la console UART della serra come nel [passo 04](../setup/04-uart.md). **Nella shell della serra**, verifica senza modificare nulla:

```sh
command -v fswebcam
ls -l /dev/video0
command -v dropbear
```

Sul prototipo, `fswebcam` e `/dev/video0` erano presenti; il server SSH era disponibile. Se la terza verifica non trova `dropbear`, controlla se il firmware usa un altro server SSH. Esci dalla console e lascia libera la porta UART prima di proseguire.

## Installazione sul Raspberry

La [pipeline `serra-foto`](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/serra-foto) è inclusa nella repository. Richiede il controller e il bridge MQTT già installati, Python con `paho-mqtt` e Pillow, e `sshpass`. Per la correzione colore con un riferimento fotografico usa anche NumPy; senza NumPy applica una correzione più semplice.

Sul computer da cui hai clonato la repository nel [passo 06](../setup/06-controller-cli.md), copia lo script sul Raspberry:

```bash
scp bridge/serra-foto pi@<RASPBERRY_IP>:/home/pi/
```

Sostituisci `<RASPBERRY_IP>` con il suo indirizzo reale. Poi, **sul Raspberry**:

```bash
sudo apt update
sudo apt install sshpass python3-pil python3-numpy
sudo install -m 755 /home/pi/serra-foto /usr/local/bin/serra-foto
```

Il [passo 03](../setup/03-raspberry.md) installa `paho-mqtt` per il controller.

Nel file privato `/etc/serra-mqtt.env` aggiungi l'indirizzo **della tua serra**, per esempio:

```text {.reference-example}
SERRA_FOTO_DEVICE_IP=<IP_DELLA_SERRA>
```

Il file contiene già `SERRA_ROOT_PASSWORD` e i dati MQTT se hai seguito il [passo 07](../setup/07-bridge-mqtt.md). Mantieni i permessi `600 root:root`. Non copiare il file compilato su GitHub.

Se vuoi usare la correzione del colore con un riferimento, salva sul Raspberry un'immagine della **serra vuota** in `/home/pi/serra/flatfield.jpg`, acquisita con le stesse impostazioni della fotocamera e delle luci. Un'immagine di un'altra serra o ottenuta con un altro mix di luci darebbe colori sbagliati. La funzione resta utilizzabile senza questo file e passa alla correzione automatica semplice. Il riferimento del prototipo non è incluso nella repository.

Verifica la configurazione **senza scattare né attivare la rete o le luci**:

```bash
sudo systemd-run --wait --collect --unit=serra-foto-check \
  -p User=pi -p EnvironmentFile=/etc/serra-mqtt.env \
  /usr/local/bin/serra-foto --check
journalctl -u serra-foto-check -n 20 --no-pager
```

**Risposta attesa:** `configurazione foto pronta (senza prova di scatto)` e servizio concluso con `status=0/SUCCESS`. Il controllo conferma file, librerie e variabili d'ambiente, **non** la connessione SSH alla serra né l'acquisizione della camera.

## Prima prova e risultato

Quando puoi osservare la serra, pubblica il payload testuale `foto` sul topic `serra/cmd` **senza retain**, usando MQTT Explorer come nel [passo 09](../setup/09-home-assistant.md#prova-con-mqtt-explorer). Il bridge esegue il comando con la configurazione privata caricata. `serra foto` da una normale shell del Raspberry funziona solo se hai caricato nello stesso processo le variabili di `/etc/serra-mqtt.env`; non stampare o copiare le credenziali in un comando. Il comando torna subito; la pipeline prosegue in background. Controlla il log e verifica che luci e Wi-Fi tornino allo stato precedente:

```bash
tail -n 80 /tmp/serra-foto.log
```

La pipeline pubblica l'immagine JPEG come messaggio retained in `serra/camera/latest` e l'ora dello scatto in `serra/camera/latest_ts`. Conserva l'ultima foto in `/home/pi/serra/foto/latest.jpg`. La pubblicazione MQTT è il passaggio previsto per la visualizzazione in Home Assistant; l'archivio storico sul prototipo è gestito da Home Assistant, **non** dallo script sul Raspberry.

Se lo scatto fallisce, il log indica la causa e `serra/status/last` riceve un errore. Non ripetere il comando finché non hai verificato il ripristino delle luci e della Wi-Fi.

---

<nav class="step-nav single" aria-label="Torna alla guida"><a href="../index.md">← Torna all'indice della guida</a></nav>
