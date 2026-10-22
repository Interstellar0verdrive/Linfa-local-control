# Accesso e dump facoltativi

Queste operazioni servono per l'esplorazione tecnica. Il percorso principale usa la [verifica UART](../setup/04-uart.md) e la [password root](../setup/05-password-root.md).

> [!CAUTION] Alimentazione durante le prove
> Collega o modifica la UART soltanto dopo aver scollegato la spina della serra e l'adattatore USB → TTL dal computer/Raspberry. Alimenta la serra per leggere la console solo quando i fili sono fissati e isolati, la scocca è richiusa e i componenti elettrici sono asciutti e lontani da acqua e pompe. Se devi intervenire di nuovo sul cablaggio, scollega prima entrambe le alimentazioni. Vedi le [precauzioni complete](../setup/01-panoramica.md#prima-di-intervenire-sicurezza-elettrica-e-acqua).

### Entrare nella serra

1. Collegare il computer alla rete temporanea creata dalla serra e, **se SSH è disponibile su quel firmware**, provare l'accesso alla serra dal terminale (PowerShell su Windows):

    ```bash {.terminal-computer}
    ssh root@<SERRA_AP_IP>
    ```

    Nella rete temporanea iniziale l'accesso potrebbe non chiedere una password.

2. Oppure dal terminale del computer collegarsi al Raspberry (collegato via UART) tramite SSH:

    Usa l'indirizzo del Raspberry, sia che sia collegato via Ethernet sia che usi Wi-Fi; non usare l'indirizzo della rete temporanea della serra:

    ```bash {.terminal-computer}
    ssh pi@<RASPBERRY_IP>
    ```

    Se il nome locale è configurato e si risolve correttamente, puoi usare `ssh pi@serra.local`. Inserisci la password del **Raspberry** quando richiesta; non è necessariamente la password root della serra.

3. Verificare che l’FT232 sia visto dal sistema:

    ```bash {.terminal-raspberry}
    ls -l /dev/ttyUSB*
    ```

    **Risposta attesa:** almeno una porta, per esempio `/dev/ttyUSB0`.

4. Installare minicom nel Raspberry: `sudo apt install -y minicom`
5. Avviare minicom:

    ```bash {.terminal-raspberry}
    sudo minicom -D /dev/ttyUSB0 -b 115200
    ```

    Per uscire, premi **CTRL + A**, poi **X**. Se vuoi registrare la sessione in un file, avvia invece:

    ```bash {.terminal-raspberry}
    sudo minicom -D /dev/ttyUSB0 -b 115200 -C /home/pi/serra_uart.log
    ```

    Per leggere il log salvato:

    ```bash {.terminal-raspberry}
    tail -n 200 /home/pi/serra_uart.log
    ```

6. Accendere la serra (oppure staccare e riattaccare l’alimentazione). Dovrebbe fare il boot e fermarsi al comando:
`Welcome to Buildroot`
7. Per copiare il log sul computer, crea o scegli una cartella di destinazione e apri il terminale lì. Questo comando OpenSSH funziona da macOS, Linux e PowerShell e salva il file nella cartella corrente:

    ```text {.terminal-computer}
    scp pi@<RASPBERRY_IP>:/home/pi/serra_uart.log ./serra_uart.log
    ```

    Sostituisci `<RASPBERRY_IP>` con l'indirizzo reale del Raspberry.

8. Per entrare nella serra usa `root` e la password effettiva del dispositivo: nel prototipo iniziale poteva essere vuota o `vocore`; dopo il passo 05 è quella che hai impostato tu.
9. Per testare se funziona, dare come comando: `echo OK` e premere invio. Si dovrebbe ricevere indietro “OK”
10. Per vedere i processi in corso, usa `ps` (la BusyBox del dispositivo potrebbe non accettare le opzioni `aux`).

### Fare il dump del modulo robocontrol (rcc.js, properties, ecc.)

I comandi dei primi cinque punti vanno eseguiti **nella shell della serra**, raggiunta tramite UART oppure tramite SSH se la rete della serra è attiva. Il trasferimento del file nei punti successivi richiede invece SSH alla serra: la sola UART non basta per usare `scp`. Nei comandi di trasferimento `<SERRA_IP>` indica l'indirizzo al quale il computer raggiunge **la serra**, sulla rete temporanea o su quella domestica.

---

1. Lanciare questo comando:

    ```bash {.terminal-serra}
    ls -la /usr/lib/node_modules/@robonica
    ```

    **Risposta attesa:** una directory chiamata `robocontrol`.

2. Entrare nella directory:

    ```bash {.terminal-serra}
    cd /usr/lib/node_modules/@robonica/robocontrol || echo "CD FAILED"
    pwd
    ```

    **Risposta attesa:** `pwd` stampa `/usr/lib/node_modules/@robonica/robocontrol`. Se compare `CD FAILED`, fermati.

3. Verifichiamo che tar esista:

    ```bash {.terminal-serra}
    which tar || tar --version
    ```

4. Creare il TAR e il GZIP:

    Crea l'archivio TAR:

    ```bash {.terminal-serra}
    cd /usr/lib/node_modules/@robonica
    tar -cf /tmp/robocontrol.tar robocontrol
    ```

    Poi comprimilo con gzip:

    ```bash {.terminal-serra}
    gzip /tmp/robocontrol.tar
    ```

    Il risultato è `/tmp/robocontrol.tar.gz`.

5. Verificare **che il file esista:**

    ```bash {.terminal-serra}
    ls -lh /tmp/robocontrol.tar.gz
    ```

    **Risposta attesa:** una riga che mostra il file `/tmp/robocontrol.tar.gz`; la dimensione dipende dal contenuto.

6. Sul computer, apri Terminale (macOS/Linux) o PowerShell (Windows) nella cartella in cui vuoi salvare l'archivio e prova:

    ```text {.terminal-computer}
    scp root@<SERRA_IP>:/tmp/robocontrol.tar.gz ./robocontrol.tar.gz
    ```

    Inserisci la password root della serra quando richiesta. Da [OpenSSH 9](https://www.openssh.org/releasenotes.html), `scp` usa SFTP per impostazione predefinita; il firmware della serra potrebbe non avere un server SFTP. Se l'errore riguarda il sottosistema SFTP, riprova forzando il protocollo SCP precedente:

    ```text {.terminal-computer}
    scp -O root@<SERRA_IP>:/tmp/robocontrol.tar.gz ./robocontrol.tar.gz
    ```

    L'opzione `-O` è disponibile nei client OpenSSH recenti; se il client non la riconosce, usa il primo comando e controlla l'errore effettivo. Se anche il protocollo SCP precedente non è disponibile ma SSH permette di eseguire `cat`, puoi trasferire il file come flusso binario. **Esegui questo comando sul computer, non nella shell della serra:**

    **Terminale macOS/Linux o PowerShell 7.4 e successivi:**

    ```bash {.terminal-computer}
    ssh root@<SERRA_IP> "cat /tmp/robocontrol.tar.gz" > ./robocontrol.tar.gz
    ```

    **Windows PowerShell 5.1:** apri invece il *Prompt dei comandi* (`cmd.exe`) nella cartella di destinazione ed esegui lo stesso comando. La [redirezione `>` di PowerShell](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_redirection?view=powershell-7) precedenti alla versione 7.4 può alterare i byte di un archivio. Non eseguire il fallback binario da quelle versioni di PowerShell. Dopo il trasferimento, verifica che `tar` riesca a leggere l'archivio prima di eliminarlo dalla serra.

7. Sul computer, nella stessa cartella dell'archivio, estrai con `tar` (oppure usa lo strumento di estrazione del sistema):

    ```text {.terminal-computer}
    tar -xzf robocontrol.tar.gz
    ```

    **Risposta attesa:** una cartella `robocontrol/` nella cartella scelta.


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
della serra. `T2-sensor` è un secondo canale di temperatura, ma dal codice non
si ricava dove sia collocato fisicamente. Il canale `T-LED-sensor` è usato
dalla routine originale di raffreddamento dei LED. **Unità, eventuali
correzioni, precisione e comportamento sulla serra reale vanno ancora
verificati**, confrontando più letture con un sensore ambientale indipendente.

Il quinto campo **non è una velocità in giri/minuto**. La funzione originale
che controlla il tachimetro lo interpreta come codice diagnostico delle
ventole:

| Codice | Interpretazione nel software originale |
| ---: | --- |
| `0` | Nessun guasto tachimetrico segnalato |
| `1` | Anomalia ventola 1 |
| `2` | Anomalia ventola 2 |
| `3` | Anomalia di tutte le ventole |
| `4` | Anomalia ventola `P` (frontale/LED) |

Il valore `0` da solo non dimostra che tutte le ventole stiano girando: va
interpretato insieme ai comandi impartiti e a una verifica fisica. Il
controller di questo progetto non acquisisce né pubblica ancora questi
valori, né esegue la routine originale `cool-LED` che comandava la ventola
dedicata. Prima di usare la temperatura LED per allarmi o regolazione
automatica della luce bisogna validare le letture e stabilire soglie adatte
all'hardware. Non inviare la richiesta manualmente mentre il controller usa
la stessa seriale: prima serve una lettura coordinata con il suo lock UART.

Il lettore originale cita anche `pH-sensor`, `Ec-sensor`, `env-light-sensor` e
`T-water-sensor`, ma per questi quattro nomi restituisce rispettivamente
valori fissi (`7`, `1200`, `50`, `24`): **non sono misure reali** da esporre
come sensori. Il livello dell'acqua ha invece un percorso di lettura reale,
già utilizzato dal controller di questo progetto.

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
