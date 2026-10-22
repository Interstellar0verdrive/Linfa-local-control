# 06 · Installare il controller CLI

**Percorso guidato:** [Indice dei capitoli](../index.md)

In questo passo copi gli script sul Raspberry e verifichi il **controller CLI** tramite UART. Il bridge MQTT e i servizi automatici saranno configurati nei passi 07 e 08.

**Assunzioni in ingresso (stato iniziale):**

- Raspberry pronto, con UART funzionante
- Nessun file serra_*.py ancora installato
- Nessun servizio serra-* attivo
- Prima dei test sui componenti, il servizio originale `robocontrol/rcc` deve essere fermo. In questo capitolo verifichi e, se necessario, disattivi il suo avvio automatico.

Questi sono i file coinvolti nei passi 06–08:

| FILE | DESCRIZIONE | NOTE |
| --- | --- | --- |
| /home/pi/serra_help.txt | **Help CLI**: è usato dal comando `serra --help` e deve stare accanto a `serra_controller.py`. | Va copiato sul Raspberry al primo setup. |
| /home/pi/serra_controller.py | **Controller**: cuore logico del sistema (CLI, UART, stato, MQTT publish) | Va copiato sul Raspberry al primo setup. |
| /home/pi/serra_mqtt_bridge.py | **MQTT Bridge**: si occupa di fare la traduzione MQTT → CLI | Va copiato sul Raspberry al primo setup. |
| /home/pi/.serra_state.json | **Stato runtime (source of truth logica):** cache JSON con ultimo stato noto dei componenti + ultimi comandi. Viene aggiornata dalla CLI ad ogni comando e usata per pubblicare serra/state/... su MQTT (retained). | Viene creata/aggiornata automaticamente dal controller al primo comando (serra ...). Non va caricata manualmente al primo setup.  |
| /etc/serra-mqtt.env | **Configurazione MQTT**: contiene segreti + parametri runtime | Va creato “a mano” nel Raspberry al primo setup. |
| /etc/systemd/system/serra-mqtt-bridge.service | Avvia e mantiene attivo il bridge MQTT. | File pronto in `bridge/systemd/`, da installare nel passo 07. |
| /etc/systemd/system/serra-netoff.service e .timer | Inviano lo spegnimento della rete dopo il boot del Raspberry; non sostituiscono la modifica dello script di avvio del VoCore. | File pronti in `bridge/systemd/`, da installare nel passo 08. |
| /etc/systemd/system/serra-state-sync.service e .timer | Ripubblicano periodicamente lo stato logico. | File pronti in `bridge/systemd/`, da installare nel passo 08. |
| /etc/systemd/system/serra-uptime.service e .timer | Controllano i riavvii della serra. | File pronti in `bridge/systemd/`, da installare nel passo 08. |
| /etc/systemd/system/serra-water-level.service | Pubblica il livello acqua su richiesta, dopo la calibrazione. | File pronto in `bridge/systemd/`, da installare nel passo 08. |

File della repository: [controller CLI](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/serra_controller.py), [bridge MQTT](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/serra_mqtt_bridge.py) e [help CLI](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/serra_help.txt).

---

## Copia dei file Python sul Raspberry

I comandi Linux di questo capitolo vanno eseguiti **sul Raspberry**, anche se apri la sua shell da un computer Windows, macOS o Linux. Sul computer ti serve soltanto un client SSH: prova `ssh -V`. Su Windows 10/11, se manca, installa la funzionalità facoltativa [OpenSSH Client](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse). Non occorre installare un server SSH sul computer.

Dal terminale del computer (su Windows, **PowerShell**), collegati al Raspberry, sostituendo `<RASPBERRY_IP>`:

```text {.terminal-computer}
ssh pi@<RASPBERRY_IP>
```

**Da qui in poi sei nella shell del Raspberry.** Il passo 03 ha già installato Git e richiesto una connessione Internet al Raspberry: clona la repository direttamente lì e copia i file necessari nella posizione usata dai passi successivi. Lo script fotografico viene soltanto copiato; la sua installazione resta facoltativa.

```bash {.terminal-raspberry}
cd /home/pi
git clone https://github.com/Interstellar0verdrive/Linfa-local-control.git
cd Linfa-local-control
cp bridge/serra_controller.py bridge/serra_mqtt_bridge.py bridge/serra_help.txt bridge/serra-foto /home/pi/
cp bridge/systemd/serra-*.service bridge/systemd/serra-*.timer /home/pi/
```

Se il Raspberry non può raggiungere GitHub, scarica la repository sul computer ed entra nella sua cartella. Puoi usare Git oppure **Code → Download ZIP** su GitHub ed estrarre l'archivio. Dal terminale del computer, nella cartella che contiene `bridge/`, usa `scp -r bridge pi@<RASPBERRY_IP>:/home/pi/` (lo stesso comando con OpenSSH su macOS, Linux e PowerShell). Poi collegati al Raspberry con `ssh pi@<RASPBERRY_IP>` ed esegui:

```bash {.terminal-raspberry}
cp /home/pi/bridge/serra_controller.py /home/pi/bridge/serra_mqtt_bridge.py /home/pi/bridge/serra_help.txt /home/pi/bridge/serra-foto /home/pi/
cp /home/pi/bridge/systemd/serra-*.service /home/pi/bridge/systemd/serra-*.timer /home/pi/
```

La copia da computer richiede il client OpenSSH anche per `scp`; il Raspberry deve essere raggiungibile sulla rete locale. Nel resto del capitolo usa sempre la shell del Raspberry.

Impostare permessi di esecuzione:

```bash {.terminal-raspberry}
chmod +x /home/pi/serra_controller.py /home/pi/serra_mqtt_bridge.py
```

Verifica:

```bash {.terminal-raspberry}
ls -la /home/pi/serra_controller.py /home/pi/serra_mqtt_bridge.py
```

**Risposta attesa:** due righe, una per file, con il permesso di esecuzione (`x`). Dimensioni e date dipendono dai file copiati.

---

## Creazione symlink CLI /usr/local/bin/serra

Il comando serra **non è una copia**, ma un symlink al file Python.

Questo consente di:

- aggiornare il controller modificando solo `serra_controller.py`
- non toccare systemd o il PATH

```bash {.terminal-raspberry}
sudo ln -sf /home/pi/serra_controller.py /usr/local/bin/serra
```

Verifica:

```bash {.terminal-raspberry}
readlink -f /usr/local/bin/serra
which serra
```

**Risposta attesa:** i due comandi stampano, nell'ordine, `/home/pi/serra_controller.py` e `/usr/local/bin/serra`.

---

## Test iniziale della CLI

Prima di introdurre il bridge MQTT, verificare che la CLI funzioni **localmente**.

### Verifica del servizio originale

Questi comandi vanno eseguiti nella **shell della serra** aperta con `picocom`, non nella shell del Raspberry. Sul prototipo esaminato, BusyBox `init` avvia `/usr/bin/start-rcc` tramite una voce `respawn` di `/etc/inittab`. Lo script lancia `/usr/bin/node rcc.js`. Il servizio era già fermo durante i primi test della CLI, quindi **la sequenza di arresto qui sotto è stata ricostruita e verificata sui file reali, ma non provata da zero su una seconda serra**. La convivenza tra `rcc` e il nostro controller non è stata verificata.

Controlla versione, configurazione e processi prima di cambiare qualcosa:

```sh {.terminal-serra}
busybox | head -1
grep -n 'start-rcc' /etc/inittab
ps -o pid,args
```

**Sul firmware esaminato** la prima riga indica BusyBox `v1.25.0`; la seconda mostra **una sola** voce `::respawn:/usr/bin/start-rcc` se l'avvio originale è ancora attivo, oppure `#::respawn:/usr/bin/start-rcc` se è già stato disattivato. Nell'elenco dei processi cerca `/usr/bin/node rcc.js` e `/usr/bin/start-rcc`. Se la versione, la voce di avvio o lo script sono diversi, fermati: la procedura seguente potrebbe non essere adatta al tuo firmware. Se la voce è già commentata e i processi sono assenti, passa alla verifica dopo il riavvio.

#### Disattivare l'avvio automatico

Esegui questa parte **solo** se hai trovato esattamente la voce attiva indicata sopra. Crea un backup dedicato senza sovrascriverne uno esistente:

```sh {.terminal-serra}
test ! -e /etc/inittab.linfa.bak && cp -p /etc/inittab /etc/inittab.linfa.bak && echo 'OK: backup creato'
ls -l /etc/inittab.linfa.bak
```

Deve comparire `OK: backup creato`. Se manca, **fermati**: conserva il backup già presente o chiarisci perché la copia è fallita. Prepara un nuovo file e controlla che l'unica modifica sia il `#` davanti a `start-rcc`:

```sh {.terminal-serra}
sed 's@^::respawn:/usr/bin/start-rcc$@#::respawn:/usr/bin/start-rcc@' /etc/inittab.linfa.bak > /etc/inittab.linfa.new
grep -n 'start-rcc' /etc/inittab.linfa.new
sed 's@^#::respawn:/usr/bin/start-rcc$@::respawn:/usr/bin/start-rcc@' /etc/inittab.linfa.new | cmp - /etc/inittab.linfa.bak && echo 'OK: solo start-rcc è cambiato'
```

**Risposta attesa:** una sola riga commentata da `grep`, poi `OK: solo start-rcc è cambiato`. Se il messaggio `OK` non compare, **non installare il nuovo file**. Quando i controlli sono riusciti, sostituisci `inittab` e chiedi a BusyBox `init` di rileggerlo:

```sh {.terminal-serra}
chmod 644 /etc/inittab.linfa.new
mv /etc/inittab.linfa.new /etc/inittab
sync
kill -HUP 1
grep -n 'start-rcc' /etc/inittab
```

La voce deve risultare commentata. Il segnale HUP **non garantisce da solo** che il processo già in esecuzione sia stato terminato: dipende da come BusyBox è stato compilato. Controlla di nuovo i processi:

```sh {.terminal-serra}
ps -o pid,args
```

Se vedi ancora `/usr/bin/node rcc.js`, prendi **solo il PID di quella riga** e termina quel processo con `kill -TERM <PID_RCC>` (sostituisci `<PID_RCC>` con il numero letto, senza digitare le parentesi angolari). Non usare `killall node`: potrebbe fermare altri programmi. Lo script `start-rcc` attende la fine di Node e dovrebbe poi uscire. Se è in corso un aggiornamento tramite `start-rcc`, oppure non riesci a identificare con certezza il processo, fermati senza inviare comandi alla serra.

Attendi almeno 15 secondi e ripeti `ps -o pid,args`: **non devono comparire né `rcc.js` né `start-rcc`**. Se ricompaiono, non eseguire i test di luci, ventole o pompe; verifica il file e il comportamento del tuo firmware.

#### Verificare dopo il riavvio e ripristinare se serve

Riavvia la serra, riapri la console e ripeti `grep -n 'start-rcc' /etc/inittab` e `ps -o pid,args`. La voce deve essere ancora commentata e i due processi assenti. Questa prova è necessaria prima di considerare conclusa la disattivazione. Sul prototipo attuale la voce è commentata e `rcc` assente, ma il registro originale non conserva un test completo eseguito subito dopo la modifica.

Per tornare alla configurazione originale, **prima ferma il bridge e i timer della serra sul Raspberry**; evita che i due sistemi comandino i componenti insieme. Poi, nella shell della serra, controlla che `/etc/inittab.linfa.bak` sia il backup creato sopra e ripristinalo:

```sh {.terminal-serra}
cp -p /etc/inittab.linfa.bak /etc/inittab.linfa.restore
mv /etc/inittab.linfa.restore /etc/inittab
sync
kill -HUP 1
grep -n 'start-rcc' /etc/inittab
```

La voce torna `::respawn:/usr/bin/start-rcc`. Dopo il riavvio, verifica con `ps -o pid,args` che il servizio originale parta. Non usare questo ripristino sul prototipo esaminato se hai soltanto `/etc/inittab.bak`: quel file è un backup precedente, non il backup dedicato creato dalla procedura qui sopra.

Chiudi `picocom` con `Ctrl+A`, poi `Ctrl+X` prima di usare la CLI; altrimenti la porta resta occupata.

Il controller non contiene una password root predefinita. Salva **una volta sola** la password della console della tua serra in un file privato sul Raspberry, senza scriverla nella cronologia della shell:

```bash {.terminal-raspberry}
serra auth save
```

Il comando la chiede due volte senza mostrarla e crea `~/.config/serra/root-password` con accesso limitato al tuo utente (`600`; cartella `700`). Da quel momento puoi lanciare `serra uptime` e gli altri comandi manuali da nuove sessioni SSH senza reinserirla. Se cambi la password sulla serra, esegui di nuovo `serra auth save`. Non mettere questo file nella repository e non eseguire il comando con `sudo`, altrimenti la credenziale viene salvata per l'utente root del Raspberry.

Se la porta individuata nel passo 03 non è `/dev/ttyUSB0`, imposta anche il percorso reale **nella stessa sessione** (esempio):

```bash {.terminal-raspberry}
export SERRA_UART_PORT=/dev/ttyUSB1
```

Nel passo 07 riporterai l'eventuale `SERRA_UART_PORT` anche nel file usato dai servizi.

I servizi automatici eseguiti come utente `pi` leggeranno la stessa password da questo file privato. Nel passo 07 `/etc/serra-mqtt.env` conterrà le credenziali del broker MQTT e gli altri parametri, senza duplicare la password della serra. Nessuno dei due file va caricato su GitHub.

```bash {.terminal-raspberry}
serra --help
```

**Risposta attesa:** la guida dei comandi della CLI.

Per cercare un'azione senza scorrere l'help nel terminale, consulta il [riferimento completo dei comandi](../riferimento-comandi.md): mostra anche il payload equivalente per Home Assistant.

Test di apertura della console e login via UART, senza azionare i componenti:

```bash {.terminal-raspberry}
serra uptime
```

**Risposta attesa:** una riga `UPTIME: ...` con i secondi trascorsi dall'avvio della serra. Se fallisce, verifica porta, permessi e password prima di inviare comandi ai componenti.

Per verificare separatamente il file di stato locale:

```bash {.terminal-raspberry}
serra state sync
```

**Risposta attesa:** `STATE SYNC OK`. Questo comando **non apre la UART**: ricalcola solo lo stato logico registrato, perciò non verifica il login alla serra. In questo passo non hai configurato il broker MQTT, quindi non aspettarti nuovi topic finché non completi il passo 07.

Esegui questi comandi di prova **uno alla volta**, osservando il risultato dopo ciascuno.

Accendi le luci con una dissolvenza di 2 secondi:

```bash {.terminal-raspberry}
serra lights on -f 2
```

Spegni le luci con una dissolvenza di 2 secondi:

```bash {.terminal-raspberry}
serra lights off -f 2
```

Accendi le ventole:

```bash {.terminal-raspberry}
serra fans on
```

Spegni le ventole:

```bash {.terminal-raspberry}
serra fans off
```

Osserva **fisicamente** che luci e ventole rispondano e si spengano. I messaggi della CLI confermano che la shell della serra ha accettato i comandi; da soli non provano che i componenti abbiano eseguito l'azione. Se un comando mostra un errore, fermati e controlla cablaggio e console prima di proseguire.

---

## File di stato locale

Il controller usa un file JSON per mantenere lo stato logico: `/home/pi/.serra_state.json`

Il file viene **creato automaticamente** al primo comando serra.

Non serve quindi caricarlo a mano ora.
Nel passaggio precedente abbiamo già dato alcuni comandi di test, quindi dovrebbe già esistere.

Verifica:

```bash {.terminal-raspberry}
ls -la /home/pi/.serra_state.json
cat /home/pi/.serra_state.json | jq .
```

**Risposta attesa:** il primo comando mostra il file esistente; il secondo mostra un oggetto JSON valido con sezioni come `meta`, `last_seen` e `lights`. Timestamp e stati riflettono la tua serra e cambiano a ogni esecuzione.

> [!NOTE] Nota
> Il file di stato è la fonte logica degli stati pubblicati su MQTT. Registra l'ultimo stato noto al controller; non è una misura hardware diretta.

---

## Continua il percorso

> [!TIP] Controllo
> **Verifica prima di proseguire:** `serra uptime` riesce a leggere la console via UART e `serra state sync` aggiorna lo stato locale.

<table width="100%" class="step-nav">
  <tr>
    <td width="50%" align="left"><strong>Passo precedente</strong><br><a href="05-password-root.md">← 05 · Impostare la password root</a></td>
    <td width="50%" align="right"><strong>Passo successivo</strong><br><a href="07-bridge-mqtt.md">07 · Configurare il bridge MQTT →</a></td>
  </tr>
</table>
