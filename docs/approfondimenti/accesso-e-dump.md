# Accesso e dump facoltativi

Queste operazioni servono per l'esplorazione tecnica. Il percorso principale usa la [verifica UART](../setup/03-uart.md) e la [password root](../setup/04-password-root.md).

> [!CAUTION] Alimentazione durante le prove
> Collega o modifica la UART soltanto dopo aver scollegato la spina della serra e l'adattatore USB → TTL dal computer/Raspberry. Alimenta la serra per leggere la console solo quando i fili sono fissati e isolati, la scocca è richiusa e i componenti elettrici sono asciutti e lontani da acqua e pompe. Se devi intervenire di nuovo sul cablaggio, scollega prima entrambe le alimentazioni. Vedi le [precauzioni complete](../setup/00-panoramica.md#prima-di-intervenire-sicurezza-elettrica-e-acqua).

### Entrare nella serra

1. Collegarsi alla rete temporanea creata dalla serra con il Mac, via SSH:

    ```bash
    ssh root@<LOCAL_IP>
    ```

    Nella rete temporanea iniziale l'accesso potrebbe non chiedere una password.

2. Oppure dal Terminale del Mac collegarsi al Raspberry (collegato via UART) via SSH:

    Usa l'indirizzo del Raspberry, sia che sia collegato via Ethernet sia che usi Wi-Fi:

    ```bash
    ssh pi@<LOCAL_IP>
    ```

    Se il nome locale è configurato e si risolve correttamente, puoi usare `ssh pi@serra.local`. Inserisci la password del **Raspberry** quando richiesta; non è necessariamente la password root della serra.

3. Verificare che l’FT232 sia visto dal sistema:

    ```bash
    ls -l /dev/ttyUSB*
    ```

    **Risposta attesa:** almeno una porta, per esempio `/dev/ttyUSB0`.

4. Installare minicom nel Raspberry: `sudo apt install -y minicom`
5. Avviare minicom:

    ```bash
    sudo minicom -D /dev/ttyUSB0 -b 115200
    ```

    Per uscire, premi **CTRL + A**, poi **X**. Se vuoi registrare la sessione in un file, avvia invece:

    ```bash
    sudo minicom -D /dev/ttyUSB0 -b 115200 -C /home/pi/serra_uart.log
    ```

    Per leggere il log salvato:

    ```bash
    tail -n 200 /home/pi/serra_uart.log
    ```

6. Accendere la serra (oppure staccare e riattaccare l’alimentazione). Dovrebbe fare il boot e fermarsi al comando:
`Welcome to Buildroot`
7. Nel caso si voglia copiare il file log nel mac:

    ```bash
    scp pi@serra:/home/pi/serra_uart.log ~/Desktop/serra_uart.log
    ```

    Se `serra` non si risolve, usa l'indirizzo del Raspberry, indipendentemente dal collegamento Ethernet o Wi-Fi:

    ```bash
    scp pi@<LOCAL_IP>:/home/pi/serra_uart.log ~/Desktop/serra_uart.log
    ```

8. Per entrare nella serra, questi sono i parametri di accesso: user: root / password: *(vuota)* → premi solo INVIO
9. Per testare se funziona, dare come comando: `echo OK` e premere invio. Si dovrebbe ricevere indietro “OK”
10. Per vedere i processi in corso, dare questo: `ps aux`

### Fare il dump del modulo robocontrol (rcc.js, properties, ecc.)

Sulla serra (shell # via UART) dal **Mac**, devi essere collegato con: `ssh root@<LOCAL_IP>`

---

1. Lanciare questo comando:

    ```bash
    ls -la /usr/lib/node_modules/@robonica
    ```

    **Risposta attesa:** una directory chiamata `robocontrol`.

2. Entrare nella directory:

    ```bash
    cd /usr/lib/node_modules/@robonica/robocontrol || echo "CD FAILED"
    pwd
    ```

    **Risposta attesa:** `pwd` stampa `/usr/lib/node_modules/@robonica/robocontrol`. Se compare `CD FAILED`, fermati.

3. Verifichiamo che tar esista:

    ```bash
    which tar || tar --version
    ```

4. Creare il TAR e il GZIP:

    Crea l'archivio TAR:

    ```bash
    cd /usr/lib/node_modules/@robonica
    tar -cf /tmp/robocontrol.tar robocontrol
    ```

    Poi comprimilo con gzip:

    ```bash
    gzip /tmp/robocontrol.tar
    ```

    Il risultato è `/tmp/robocontrol.tar.gz`.

5. Verificare **che il file esista:**

    ```bash
    ls -lh /tmp/robocontrol.tar.gz
    ```

    **Risposta attesa:** una riga che mostra il file `/tmp/robocontrol.tar.gz`; la dimensione dipende dal contenuto.

6. Scaricare il file sul mac:

    ```bash
    scp root@<LOCAL_IP>:/tmp/robocontrol.tar.gz ~/Desktop/
    ```

    Inserisci la password root della serra quando richiesta.

    Se scp fallisce (probabile, di solito in questo tipo di build NON è presente sftp-server) usare questo comando DAL MAC:

    **Sul Mac**, non nella shell della serra:

    ```bash
    ssh root@<LOCAL_IP> "cat /tmp/robocontrol.tar.gz" > ~/Desktop/robocontrol.tar.gz
    ```

    Inserisci la password root della serra quando richiesta.

7. Sul mac, per estrarre:

    ```bash
    cd ~/Desktop
    tar -xzf robocontrol.tar.gz
    ```

    **Risposta attesa:** una cartella `robocontrol/` sulla Scrivania.


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
