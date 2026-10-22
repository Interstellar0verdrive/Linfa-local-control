# Accesso e dump facoltativi

Queste operazioni servono per l'esplorazione tecnica. Il percorso principale usa la [verifica UART](../setup/04-uart.md) e la [password root](../setup/05-password-root.md).

> [!CAUTION] Alimentazione durante le prove
> Collega o modifica la UART soltanto dopo aver scollegato la spina della serra e l'adattatore USB → TTL dal computer/Raspberry. Alimenta la serra per leggere la console solo quando i fili sono fissati e isolati, la scocca è richiusa e i componenti elettrici sono asciutti e lontani da acqua e pompe. Se devi intervenire di nuovo sul cablaggio, scollega prima entrambe le alimentazioni. Vedi le [precauzioni complete](../setup/01-panoramica.md#prima-di-intervenire-sicurezza-elettrica-e-acqua).

### Entrare nella serra

1. Collegare il Mac alla rete temporanea creata dalla serra e, **se SSH è disponibile su quel firmware**, provare l'accesso alla serra:

    ```bash
    ssh root@<SERRA_AP_IP>
    ```

    Nella rete temporanea iniziale l'accesso potrebbe non chiedere una password.

2. Oppure dal Terminale del Mac collegarsi al Raspberry (collegato via UART) via SSH:

    Usa l'indirizzo del Raspberry, sia che sia collegato via Ethernet sia che usi Wi-Fi; non usare l'indirizzo della rete temporanea della serra:

    ```bash
    ssh pi@<RASPBERRY_IP>
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
    scp pi@<RASPBERRY_IP>:/home/pi/serra_uart.log ~/Desktop/serra_uart.log
    ```

    Sostituisci `<RASPBERRY_IP>` con l'indirizzo reale del Raspberry.

8. Per entrare nella serra usa `root` e la password effettiva del dispositivo: nel prototipo iniziale poteva essere vuota o `vocore`; dopo il passo 05 è quella che hai impostato tu.
9. Per testare se funziona, dare come comando: `echo OK` e premere invio. Si dovrebbe ricevere indietro “OK”
10. Per vedere i processi in corso, usa `ps` (la BusyBox del dispositivo potrebbe non accettare le opzioni `aux`).

### Fare il dump del modulo robocontrol (rcc.js, properties, ecc.)

I comandi dei primi cinque punti vanno eseguiti **nella shell della serra**, raggiunta tramite UART oppure tramite SSH se la rete della serra è attiva. Il trasferimento del file nei punti successivi richiede invece SSH alla serra: la sola UART non basta per usare `scp`. Nei comandi di trasferimento `<SERRA_IP>` indica l'indirizzo al quale il Mac raggiunge **la serra**, sulla rete temporanea o su quella domestica.

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
    scp root@<SERRA_IP>:/tmp/robocontrol.tar.gz ~/Desktop/
    ```

    Inserisci la password root della serra quando richiesta.

    Se scp fallisce (probabile, di solito in questo tipo di build NON è presente sftp-server) usare questo comando DAL MAC:

    **Sul Mac**, non nella shell della serra:

    ```bash
    ssh root@<SERRA_IP> "cat /tmp/robocontrol.tar.gz" > ~/Desktop/robocontrol.tar.gz
    ```

    Inserisci la password root della serra quando richiesta.

7. Sul mac, per estrarre:

    ```bash
    cd ~/Desktop
    tar -xzf robocontrol.tar.gz
    ```

    **Risposta attesa:** una cartella `robocontrol/` sulla Scrivania.


### Il servizio originale `rcc`

Il modulo `robocontrol` è avviato da BusyBox init tramite la voce `::respawn:/usr/bin/start-rcc` in `/etc/inittab`. Nel prototipo il processo era già fermo durante le prove dei comandi via UART.

Un log di manutenzione successivo (luglio 2026) registra questi passaggi **effettivamente osservati**: backup di `/etc/inittab`, riga `::respawn:/usr/bin/start-rcc` commentata come `#::respawn:/usr/bin/start-rcc`, ricaricamento di `init` con segnale HUP, arresto di `rcc`; i controlli a 6 e 14 secondi mostravano **zero processi Node**. Il log contiene soltanto l'output, non la trascrizione dei comandi impartiti.

Nel controllo del 21 ottobre 2026 sul prototipo, `/etc/inittab` aveva una sola voce `start-rcc` commentata e nessun altro riferimento a `rcc`; `/etc/inittab.bak` conteneva la stessa configurazione con quella voce attiva. I due file differivano soltanto per il `#`. Il processo `rcc` era assente; BusyBox riportava la versione `v1.25.0` e il sistema circa 46 giorni di uptime. Una trasformazione `sed` eseguita **senza scrivere file** ha ricreato esattamente l'`inittab` attuale dal backup, e la trasformazione inversa ha ricreato il backup. L'orologio interno della serra è risultato incoerente, quindi le date dei file non dimostrano da sole la cronologia dei riavvii. La prova di disattivazione da zero su una seconda serra rimane da fare. I passaggi operativi, con controlli e ripristino, sono nel [passo 06](../setup/06-controller-cli.md#verifica-del-servizio-originale).

Verifica sempre la situazione sulla tua serra prima di provare il controller: se il servizio originale è attivo, la convivenza con i comandi manuali non è stata testata. Il [codice sorgente di BusyBox init](https://sources.debian.org/src/busybox/1%3A1.37.0-6/init/init.c/) mostra che il segnale HUP rilegge `/etc/inittab` e che l'arresto dei processi rimossi dipende dall'opzione di compilazione `FEATURE_KILL_REMOVED`. Per questo il passo 06 richiede una verifica separata del processo e, se necessario, il suo arresto esplicito.

### Cosa si deduce dal dump:

ARCHITETTURA / COMPONENTI

- Ci sono 2 seriali USB principali:
    - /dev/tty-local -> symlink a /dev/ttyUSB1 (controller “Cirronembo”)
    - /dev/tty-nebbia -> symlink a /dev/ttyUSB0 (controller “Nebbia”)
    (ls: /dev/tty-local -> ttyUSB1, /dev/tty-nebbia -> ttyUSB0)
- Il demone `robocontrol/rcc` era stato fermato sul prototipo; i comandi diretti sulle seriali interne continuavano a funzionare. La configurazione di avvio e i limiti di verifica sono descritti [sopra](#il-servizio-originale-rcc).
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

COMANDI HARDWARE OSSERVATI O RICAVATI DAL DUMP (GRADO DI VERIFICA INDICATO PER OGNI GRUPPO)
Ventole (su /dev/tty-local):

- Fan 1 ON: printf 'V1ffxxx\r\n' > /dev/tty-local
- Fan 1 OFF: printf 'V100xxx\r\n' > /dev/tty-local
- Fan 2 ON: printf 'V2ffxxx\r\n' > /dev/tty-local
- Fan 2 OFF: printf 'V200xxx\r\n' > /dev/tty-local
- Fan “P” frontale ON: printf 'VPffxxx\r\n' > /dev/tty-local
- Fan “P” frontale OFF: printf 'VP00xxx\r\n' > /dev/tty-local
- Velocità fan 1 (esempio): V180xxx / V140xxx

Uscita sensori/telemetria (osservata su `/dev/tty-local`):

La lettura passiva documentata nel prototipo produceva righe CSV come
`25.0,26.1,25.87,30.56,0`. L'analisi statica del lettore nel software
originale `rcc.js` mostra che invia la richiesta `-------`, divide la risposta
sulle virgole e converte i campi in numeri. La funzione `read-sensor` associa
le posizioni così:

| Posizione | Nome nel firmware | Valore nell'esempio |
| --- | --- | ---: |
| 1 | `T2-sensor` | 25.0 |
| 2 | `T-LED-sensor` | 26.1 |
| 3 | `T1-sensor` | 25.87 |
| 4 | `Humidity-sensor` | 30.56 |
| 5 | `Tachimetric-sensor` | 0 |

Un'altra funzione del firmware usa `T1-sensor` come temperatura della camera
della serra. I numeri sono quindi interpretabili come temperature, umidità e
lettura tachimetrica; **unità, eventuali correzioni e precisione vanno ancora
verificate su una serra accesa**, confrontando più letture con un sensore
ambientale indipendente. Il controller di questo progetto non acquisisce né
pubblica ancora questi valori. Non inviare la richiesta manualmente mentre
il controller usa la stessa seriale: prima serve una lettura coordinata con
il suo lock UART.

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

[Torna all’indice della guida](../index.md).
