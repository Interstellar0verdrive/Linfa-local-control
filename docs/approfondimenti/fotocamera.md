# Foto della serra via UART

La fotocamera è facoltativa. Sul prototipo, il Raspberry fa scattare la webcam interna al VoCore tramite la console USB/UART, trasferisce il JPEG sulla stessa seriale e lo pubblica sul broker MQTT. **La Wi-Fi del VoCore resta spenta**; solo il Raspberry usa la rete domestica per parlare con Home Assistant.

Questa procedura è stata verificata sulla serra dell'autore con firmware VoCore 1.4. Non è ancora stata provata su una seconda unità: prima di installarla, controlla che il tuo firmware abbia `fswebcam`, `uuencode`, `sha256sum` e `/dev/video0`. Il resto del controllo locale funziona anche se salti la fotocamera.

## Come avviene uno scatto

1. Il pulsante nell'app Home Assistant richiama `script.serra_foto_scatta`, che pubblica `foto` su `serra/cmd/ha`. Il bridge MQTT sul Raspberry esegue `serra foto`.
2. La pipeline [`serra-foto`](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/serra-foto) legge il mix luci corrente. Se manca anche un solo canale, annulla lo scatto prima di toccare i LED.
3. Spegne temporaneamente i canali normali, accende solo le sottosezioni **B2 e B5** al 100%, attende un secondo e scatta con `fswebcam` a **640×480, JPEG qualità 95, rotazione 180° e bilanciamento del bianco automatico**. È il profilo fotografico diurno individuato nel firmware originale 1.4. Non ritaglia né corregge i colori.
4. Ripristina le luci in ogni caso, anche se lo scatto fallisce. Il JPEG passa dal VoCore al Raspberry in blocchi UART; ogni blocco rilascia la seriale per permettere agli altri comandi di procedere. Il Raspberry controlla la dimensione e lo SHA-256 prima di pubblicarlo.
5. Il Raspberry pubblica il file integrale su `serra/camera/latest` e il timestamp su `serra/camera/latest_ts`. Home Assistant lo mostra tramite `camera.serra_foto` e, nella configurazione dell'autore, lo copia nell'archivio con `camera.snapshot`.

> [!WARNING] Prima prova
> Le luci cambiano per alcuni secondi. Prova la funzione mentre puoi osservare la serra e verifica che tornino al mix precedente. Se il ripristino fallisce, la pipeline pubblica un errore su `serra/status/last`. Il trasferimento richiede alcune decine di secondi: durante ogni blocco UART un altro comando può attendere, poi prosegue quando la seriale viene rilasciata. Chi può leggere il topic MQTT della fotocamera può vedere l'interno della serra.

## Verifiche preliminari

Apri la console UART come nel [passo 04](../setup/04-uart.md) e, **nella shell del VoCore**, verifica senza cambiare nulla:

```sh
command -v fswebcam
command -v uuencode
command -v sha256sum
ls -l /dev/video0
```

Esci dalla console prima di proseguire, in modo da liberare la porta seriale. Il [passo 03](../setup/03-raspberry.md) installa già `python3-serial` e `python3-paho-mqtt` sul Raspberry. Il [passo 06](../setup/06-controller-cli.md) mette `serra_controller.py` in `/home/pi/`; il [passo 07](../setup/07-bridge-mqtt.md) configura bridge, broker e credenziali private.

## Installazione sul Raspberry

Dal computer che contiene il clone della repository, copia lo script:

```bash
scp bridge/serra-foto pi@<RASPBERRY_IP>:/home/pi/
```

Poi, **sul Raspberry**:

```bash
sudo install -o root -g root -m 755 /home/pi/serra-foto /usr/local/bin/serra-foto
sudo systemd-run --wait --collect --pipe -p User=pi \
  -p EnvironmentFile=/etc/serra-mqtt.env \
  /usr/local/bin/serra-foto --check
```

Sostituisci `<RASPBERRY_IP>` con l'indirizzo reale del Raspberry. `--check` deve mostrare `pipeline UART pronta`: verifica dipendenze e variabili, **senza scattare o modificare le luci**. La password della console resta nel file privato `~/.config/serra/root-password`, creato al passo 06; non pubblicarlo. Non serve configurare un indirizzo IP della serra o installare `sshpass`, Pillow o un encoder WebP.

## Prima prova

Quando puoi controllare visivamente i LED, usa il pulsante foto dell'app Home Assistant. Se l'app non è installata, pubblica il payload testuale `foto` sul topic `serra/cmd/ha` **senza retain** tramite MQTT Explorer, come nel [passo 09](../setup/09-home-assistant.md#prova-con-mqtt-explorer). Il comando torna subito e la pipeline lavora in background. Sul Raspberry puoi seguirla con:

```bash
tail -f /tmp/serra-foto.log
```

Attendi il messaggio `JPEG integrale pubblicato`. Verifica che le luci siano tornate allo stato precedente e che `camera.serra_foto` mostri la nuova immagine. Sul prototipo il JPEG archiviato da Home Assistant era identico byte per byte a quello sul Raspberry, sempre 640×480. Se lo scatto fallisce, controlla il log e il ripristino delle luci prima di riprovare.

---

<nav class="step-nav single" aria-label="Torna alla guida"><a href="../index.md">← Torna all'indice della guida</a></nav>
