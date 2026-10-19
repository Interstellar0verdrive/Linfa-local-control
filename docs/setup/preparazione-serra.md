# Preparazione della serra

> Parte di questa procedura (segnata come “[OPTIONAL]”) è superflua per la riuscita del progetto. Viene qui documentata per completezza.

### [OPTIONAL] Osservazione del traffico di rete tramite m**an-in-the-middle proxy (.HAR / .mitm)

La procedura è stata fatta per **sniffare/registrare il traffico applicativo** tra serra/app e cloud, con l’obiettivo di capire **endpoint, token, payload e flussi** (eventualmente anche comandi), non per estrarre il filesystem della serra.

---

## Sniff traffico serra ↔ cloud (HAR + .mitm)

### 1) Intento

- **Osservare e registrare** le comunicazioni tra serra (e/o app) e backend Robonica.
- Ricavare:
    - domini e percorsi (API / websocket)
    - token/credenziali di sessione (se transitano in chiaro a livello applicativo)
    - payload e parametri (es. configurazioni, comandi, eventi)
    - sequenza dei flussi (bootstrap → autenticazione → canali websocket → invio/ricezione messaggi)

Obiettivo pratico: avere una traccia ripetibile per analizzare “come parla” la serra col cloud e quali chiamate/azioni avvengono.

---

### 2) Cosa è stato usato e con che approccio

Approccio: **Man-in-the-middle proxy** (MITM) a livello HTTP/HTTPS.

Strumenti:

- **mitmproxy / mitmdump** su Mac
- Esportazione in:
    - **.mitm** = cattura raw nel formato di mitmproxy
    - **.har** = export strutturato (HTTP Archive) per analisi con browser/devtools o tool HAR

Note:

- Questo è un approccio diverso da tcpdump/wireshark:
    - qui si “intercetta” a livello applicativo tramite proxy
    - con TLS decifrato **solo** se il client accetta il certificato MITM
- Questa cattura registra il traffico generato dal Mac (browser/webapp).
Non necessariamente il traffico *diretto* della serra, se la serra *non* usa il Mac come proxy.

---

### 3) Procedura da seguire (passi)

1. Collegarsi alla rete temporanea creata dalla serra con il Mac
2. Dal Terminale del Mac:

```bash
# se non è installato:
brew install mitmproxy
# Il pacchetto mitmproxy include: mitmproxy, mitmdump, mitmweb

#avviare mitmdump
mitmdump -p 8080 -w ~/Desktop/serra_ALL.mitm
# Nota: NON** deve aprirsi nessuna UI, il terminale resta apparentemente “fermo”.
# NON premere nulla: s**e il prompt sembra bloccato non è un problema, è normale.
```

1. Impostare il proxy di macOS su localhost
**Impostazioni → Rete → Wi-Fi → Dettagli → Proxy**
✅ Proxy Web (HTTP): 127.0.0.1 porta 8080
✅ Proxy Web Sicuro (HTTPS): 127.0.0.1 porta 8080
Nota: questa impostazione vale per la connessione Wi-Fi attuale.
Quando si passa alla Wi-Fi della serra, meglio ricontrollare che sia ancora attiva (di solito resta attiva, ma macOS a volte la “resetta” per reti nuove).
2. (Se serve) abilitare la lettura HTTPS:
Con proxy attivo, aprire dal browser: http://mitm.it
Scaricare il certificato **macOS**, installarlo nel Portachiavi e impostare **“Sempre attendibile”**.
3. **Ora fare la procedura della serra**
    1. aprire la webapp da browser (https://mylinfa.robonica.it/#/mylinfa)
    2. Avviare **aggiunta nuova serra**
    3. quando la serra chiede di passare alla Wi-Fi della serra → accettare e procedere
    4. Lanciare il checkup
    👉 mitmproxy/mitmdump continuerà a vedere tutto, perché è locale al Mac
    5. Quando finisce → chiudere il browser
4. Tornare al Terminale dove gira mitmdump e premere: CTRL + C
5. Verificare che il file esista: `ls -lh ~/Desktop/serra_ALL.mitm`
Se esiste un file > **0 byte** → PROCEDURA OK
6. Per visualizzare il file si può usare il comando:

```bash
mitmproxy -r ~/Desktop/serra_ALL.mitm

# FILTRI UTILI (Dentro mitmproxy)
# Solo IP locali:
	f
~dst 192.168.

# Solo POST:
f
~m POST

# Entrambi i filtri combinati:
f
~m POST & ~dst 192.168.
```

1. Ora dobbiamo trasformare il file mitm in un fine HAR
Probabilmente sarà un HAR “minimal” (manca timing corretto, cookies, queryString, ecc.). Ma bene per analisi funzionale anche se non è un HAR “completo”.
    1. Crea l’addon har_dump.py

        ```bash
        nano ~/.mitmproxy/har_dump.py
        ```

        Incollare esattamente questo codice e salvare (CTRL + O → INVIO → CTRL + X):

        ```bash
        import json
        from mitmproxy import ctx, http, options, version
        from mitmproxy.addons import core

        class Hardump:
            def __init__(self):
                self.flows = []

            def load(self, loader):
                loader.add_option(
                    name="har_dump_path",
                    typespec=str,
                    default="dump.har",
                    help="Path to the HAR file to write"
                )

            def response(self, flow: http.HTTPFlow):
                self.flows.append(flow)

            def done(self):
                har = {
                    "log": {
                        "version": "1.2",
                        "creator": {
                            "name": "mitmproxy",
                            "version": version.MITMPROXY
                        },
                        "entries": []
                    }
                }

                for f in self.flows:
                    if not f.response:
                        continue

                    entry = {
                        "startedDateTime": f.request.timestamp_start,
                        "time": 0,
                        "request": {
                            "method": f.request.method,
                            "url": f.request.pretty_url,
                            "httpVersion": "HTTP/1.1",
                            "headers": [
                                {"name": k, "value": v}
                                for k, v in f.request.headers.items(multi=True)
                            ],
                            "postData": {
                                "mimeType": f.request.headers.get("Content-Type", ""),
                                "text": f.request.text or ""
                            },
                        },
                        "response": {
                            "status": f.response.status_code,
                            "statusText": f.response.reason,
                            "httpVersion": "HTTP/1.1",
                            "headers": [
                                {"name": k, "value": v}
                                for k, v in f.response.headers.items(multi=True)
                            ],
                            "content": {
                                "mimeType": f.response.headers.get("Content-Type", ""),
                                "text": f.response.text or ""
                            },
                        },
                    }

                    har["log"]["entries"].append(entry)

                path = ctx.options.har_dump_path
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(har, f, indent=2)

        addons = [Hardump()]
        ```

    2. Dare questo comando:

        ```bash
        mitmdump -r ~/Desktop/serra_ALL.mitm \
          -s ~/.mitmproxy/har_dump.py \
          --set har_dump_path=~/Desktop/serra_ALL_OK.har
        ```

    3. Viene generato il file serra_ALL_OK.har.


### 3) Risultati

Dal file HAR si vede chiaramente che:

- la serra mantiene una **connessione persistente verso il cloud**
- usa:
    - WebSocket **oppure**
    - HTTPS long-polling
- con:
    - token statico per dispositivo
    - device_id
- Il **bottom è solo uno slave,** il **top è il cervello e comanda pompe e luci**
- il bottom **NON decide nulla,** riceve: segnali, enable/disable, PWM / on-off
- ESISTE codice locale che comanda i componenti (es. luci e pompe), NON è esposto via HTTP come API, è chiamabile internamente dal firmware

### [OPTIONAL] Entrare nella serra

1. Collegarsi alla rete temporanea creata dalla serra con il Mac, via SSH:

    ```bash
    ssh root@<LOCAL_IP>
    # Non dovrebbe servire password
    ```

2. Oppure dal Terminale del Mac collegarsi al Raspberry (collegato via UART) via SSH:

    ```bash
    ssh pi@<LOCAL_IP>
    # Oppure (se wifi):
    ssh pi@<LOCAL_IP>
    # Oppure:
    ssh pi@serra.local

    # Usare la password impostata - nel mio caso: <DEVICE_PASSWORD>
    ```

3. Verificare che l’FT232 sia visto dal sistema:

    ```bash
    ls -l /dev/ttyUSB*
    # Dovrebbe restituire qualcosa tipo:
    # /dev/ttyUSB0
    ```

4. Installare minicom nel Raspberry: `sudo apt install -y minicom`
5. Avviare minicom:

    ```bash
    sudo minicom -D /dev/ttyUSB0 -b 115200
    # Per uscire: CTRL + A  →  X

    # Se voglio salvare in un log tutto quello che vede:
    sudo minicom -D /dev/ttyUSB0 -b 115200 -C /home/pi/serra_uart.log

    # Poi per vedere il log:
    tail -n 200 /home/pi/serra_uart.log
    ```

6. Accendere la serra (oppure staccare e riattaccare l’alimentazione). Dovrebbe fare il boot e fermarsi al comando:
`Welcome to Buildroot`
7. Nel caso si voglia copiare il file log nel mac:

    ```bash
    scp pi@serra:/home/pi/serra_uart.log ~/Desktop/serra_uart.log

    # Se l’hostname "serra" non risolve, basta usare l’IP del Raspberry, quindi se è connesso via wifi:
    scp pi@<LOCAL_IP>:/home/pi/serra_uart.log ~/Desktop/serra_uart.log
    #o se è connesso via ethernet:
    scp pi@<LOCAL_IP>:/home/pi/serra_uart.log ~/Desktop/serra_uart.log
    ```

8. Per entrare nella serra, questi sono i parametri di accesso: user: root / password: *(vuota)* → premi solo INVIO
9. Per testare se funziona, dare come comando: `echo OK` e premere invio. Si dovrebbe ricevere indietro “OK”
10. Per vedere i processi in corso, dare questo: `ps aux`

## Cambiare la password della serra (consigliato!)

1. Collegare la UART tra serra e raspberry
2. Eventualmente collegarsi al raspberry via SSH dal mac:

    ```bash
    ssh pi@<LOCAL_IP>
    # Oppure (se wifi):
    ssh pi@<LOCAL_IP>
    # Oppure:
    ssh pi@serra.local

    # Usare la password impostata - nel mio caso: <DEVICE_PASSWORD>
    ```

3. Dare questo comando via ssh:

    ```bash
    grep '^root:' /etc/shadow || grep '^root:' /etc/passwd
    # Dovrebbe rispondere con qualcosa tipo:
    # root::10933:0:99999:7:::
    ```

    Significa che non c’è una password impostata (campo vuoto).

4. Impostare una nuova password con questo comando:

    ```bash
    passwd
    # Chiederà di ripetere 2 volte la password (non si vede niente a schermo mentre si digita, è normale)
    # Io ho scelto questa password: <DEVICE_PASSWORD>
    ```

5. A questo punto si può usare questa password quando ci si collega via SSH.
Ad esempio, se sia il mac sia la serra sono collegati alla stessa rete (quella temporanea creata dalla serra), posso collegarmi così:

    ```bash
     ssh root@<LOCAL_IP>
     # Usare la password scelta al punto precedente, ad esempio <DEVICE_PASSWORD>
    ```

    Quindi ora è possibile connettersi senza passare dal Raspberry/UART.


### [OPTIONAL] Fare il dump del modulo robocontrol (rcc.js, properties, ecc.)

Sulla serra (shell # via UART) dal **Mac**, devi essere collegato con: `ssh root@<LOCAL_IP>`

---

1. Lanciare questo comando:

    ```bash
    ls -la /usr/lib/node_modules/@robonica
    # Output atteso tipo:
    # drwxr-xr-x  ... robocontrol
    ```

2. Entrare nella directory:

    ```bash
    cd /usr/lib/node_modules/@robonica/robocontrol || echo "CD FAILED"
    pwd
    # pwd **DEVE** stampare:
    # /usr/lib/node_modules/@robonica/robocontrol
    ```

3. Verifichiamo che tar esista:

    ```bash
    which tar || tar --version
    ```

4. Creare il TAR e il GZIP:

    ```bash
    # Prima crea il tar:
    cd /usr/lib/node_modules/@robonica
    tar -cf /tmp/robocontrol.tar robocontrol

    # Poi comprimi con gzip:
    gzip /tmp/robocontrol.tar
    # Questo crea /tmp/robocontrol.tar.gz
    ```

5. Verificare **che il file esista:**

    ```bash
    ls -lh /tmp/robocontrol.tar.gz
    # Output atteso tipo:
    # -rw-r--r-- 1 root root 1.1M /tmp/robocontrol.tar.gz
    ```

6. Scaricare il file sul mac:

    ```bash
    scp root@<LOCAL_IP>:/tmp/robocontrol.tar.gz ~/Desktop/
    # Usare la password: <DEVICE_PASSWORD>
    ```

    Se scp fallisce (probabile, di solito in questo tipo di build NON è presente sftp-server) usare questo comando DAL MAC:

    ```bash
    # Dal Mac (non dalla serra!)
    ssh root@<LOCAL_IP> "cat /tmp/robocontrol.tar.gz" > ~/Desktop/robocontrol.tar.gz
    # Usare la password: <DEVICE_PASSWORD>
    ```

7. Sul mac, per estrarre:

    ```bash
    cd ~/Desktop
    tar -xzf robocontrol.tar.gz
    # Si ottiene la cartella robocontrol/
    ```


### Cosa si deduce dal dump:

ARCHITETTURA / COMPONENTI

- Ci sono 2 seriali USB principali:
    - /dev/tty-local -> symlink a /dev/ttyUSB1 (controller “Cirronembo”)
    - /dev/tty-nebbia -> symlink a /dev/ttyUSB0 (controller “Nebbia”)
    (ls: /dev/tty-local -> ttyUSB1, /dev/tty-nebbia -> ttyUSB0)
- Il demone “robocontrol / rcc” è avviato da BusyBox init:
    - /etc/inittab contiene: ::respawn:/usr/bin/start-rcc
    - ho fermato il demone (rcc.log non cresce più / file rimosso), ma i comandi diretti su tty continuano a funzionare.
- Il log rcc mostrava tentativi websocket cloud:
    - wss://channels.linfa.robonica.it:4443/ con errori 401 ecc.
    - Quindi il controllo cloud è separato dal controllo seriale locale.

FILE CHIAVE DAL DUMP (da usare per analisi)

- /usr/lib/node_modules/@robonica/robocontrol/rcc.js (minificato) + una versione pretty (rcc.pretty.js)
- properties.clj
- `stress-test.sh` (contiene comandi “di test” per hardware)
- start-rcc, rotate-rcc, vari script init.d
- File stato:
    - /opt/data/status.sp (contiene map con :earth-mag-field, :empty-vassel-field, :first-connection ecc.)
    - /opt/data/data.sp (vuoto a volte)
- File calibrazione magnetometro:
    - /var/www/mag-data -> symlink a /var/www/mag-data-2.2
    - ho anche copie mag-data-2.1 / 2.2 / 2.3 dal dump.
- In properties.clj ci sono riferimenti a:
    - :Nebbia-serial-port "/dev/tty-nebbia"
    - :Cirronembo-serial-port "/dev/tty-local"
    - :mag-file "/var/www/mag-data"
    - :mag-coefficient-2.1 [...]
    - :mag-coefficient-2.2 [...]
    - :status-file "/opt/data/status.sp"
    - :data-file "/opt/data/data.sp"
    - ecc.

COMANDI HARDWARE GIÀ CONFERMATI (FUNZIONANO VIA SERIAL DIRETTA)
Ventole (su /dev/tty-local):

- Fan 1 ON: printf 'V1ffxxx\r\n' > /dev/tty-local
- Fan 1 OFF: printf 'V100xxx\r\n' > /dev/tty-local
- Fan 2 ON: printf 'V2ffxxx\r\n' > /dev/tty-local
- Fan 2 OFF: printf 'V200xxx\r\n' > /dev/tty-local
- Fan “P” frontale ON: printf 'VPffxxx\r\n' > /dev/tty-local
- Fan “P” frontale OFF: printf 'VP00xxx\r\n' > /dev/tty-local
- Velocità fan 1 (esempio): V180xxx / V140xxx

Uscita sensori/telemetria (lettura passiva da /dev/tty-local):

- cat /dev/tty-local | hexdump -C produce ASCII con righe tipo:
"25.0,26.1,25.87,30.56,0\n..."
(probabile: temperature/umidità/qualcosa; da decodificare)

Luci / switch (da `stress-test.sh`: su /dev/tty-local) — NON ancora validato in runtime ma molto probabile:

- Lamp ON: echo 0Aff004 > /dev/tty-local
- Lamp OFF: echo 0A00001 > /dev/tty-local
(altri pattern trovati via strings: echo 0A00040, echo 0A00000 ecc.)

Nebbia / RGB (da `stress-test.sh`: su /dev/tty-nebbia) — non ancora validato:

- Rosso: echo NFF000000 > /dev/tty-nebbia
- Verde: echo N00FF0000 > /dev/tty-nebbia
- Blu: echo N0000FF00 > /dev/tty-nebbia
- Off: echo N00000000 > /dev/tty-nebbia

Pompe (da `stress-test.sh`: su /dev/tty-nebbia) — da provare:

- echo P0,200,140 > /dev/tty-nebbia
- echo P1,200,140 > /dev/tty-nebbia
- echo P2,200,140 > /dev/tty-nebbia
- echo W3 > /dev/tty-nebbia
(Obiettivo: capire quale è pompa principale e quali sono le 3 per nutrienti.)

FUNZIONI “NOMINATE” NEL CODICE (rcc.index.txt estratto da rcc.js)
DEV functions trovate:

- dev/get-fan-status
- dev/init-*
- dev/init-cmx-sp
- dev/mag-to-water
- dev/mean-mag-field
- dev/read-mag-intensity
- dev/read-water-level
- dev/set-*
- dev/set-switch
- dev/stop-*
- dev/tty
- dev/tty-nebbia

ACT functions trovate:

- act/activities-to-crontable
- act/check-fan
- act/check-temperature
- act/cool-*
- act/emptying
- act/get-activity-stopper
- act/get-new-water-level
- act/heat-chamber
- act/humidifies
- act/ilcl
- act/init-frontbutton-operate-loop
- act/irrigate-activity
- act/lcl
- act/led-switching-tasks
- act/light-control-loop
- act/mag-value-to-backend
- act/monitoring-water
- act/oneday-notify
- act/perform-lost-activities
- act/register-activity
- act/remember-activities
- act/replacement
- act/ricirculate
- act/start-activity
- act/start-activity-loop
- act/start-irrigate
- act/start-superactivity
- act/stop-all-activities
- act/stop-nebbia-activities
- act/t-p-a
- act/take-photo-activity
- act/update-neopixel
- act/wl-critic-notify

NOTE IMPORTANTI

- Non usare approcci cloud. Il demone cerca di connettersi a wss e fallisce (401) e intanto invia comandi “BFFFF...” a Nebbia (stringhe viste nel log) ma non è chiaro se siano necessari per controllo base.
- I comandi ventole funzionano anche con demone fermo.
- Il water level sembra basato su magnetometro: in status.sp ci sono :earth-mag-field e :empty-vassel-field; in properties.clj ci sono mag-file e coefficienti; c’è ipotesi galleggiante magnetico calibrato “vuoto” e “pieno 4.5L”.

---
