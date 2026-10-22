# 08 · Attivare i servizi automatici

**Percorso guidato:** [Indice dei capitoli](../index.md)

Con il bridge già funzionante, verifica che la Wi-Fi della serra non venga avviata al boot e installa i servizi copiati nel passo 06. I timer inviano un comando aggiuntivo di spegnimento della rete, ripubblicano lo stato logico e controllano se la serra è stata riavviata. Un servizio separato può leggere il livello dell'acqua su richiesta.

**Se l'utente del Raspberry non è `pi`:** prima di installare i file, modifica la copia dei quattro servizi `serra-netoff`, `serra-state-sync`, `serra-uptime` e `serra-water-level` sostituendo `User=pi` con l'utente che ha eseguito `serra auth save`. Adatta anche i percorsi `/home/pi/` nei comandi di installazione qui sotto.

## Disabilitare la Wi-Fi all'avvio della serra

Sul **VoCore del prototipo** abbiamo verificato via UART che `/etc/init.d/S45net` non esiste e che è presente `/etc/init.d/OFF_S45net`. Quest'ultimo è lo script che caricherebbe `mt_wifi` e avvierebbe le interfacce Wi-Fi. Lo script di avvio `/etc/init.d/rcS` esegue soltanto i file che corrispondono a `S??*`, quindi **`OFF_S45net` non parte al boot**. Nel controllo effettuato con la serra accesa, `mt_wifi` non risultava caricato. Questo descrive il prototipo; verifica i file sulla tua versione prima di modificarli.

Esegui i prossimi comandi **nella console root della serra via UART**, non nella shell del Raspberry. Conserva il collegamento UART: dopo questa modifica la serra potrebbe non essere più raggiungibile via Wi-Fi. Controlla quali script esistono:

```sh
ls -l /etc/init.d/S45net /etc/init.d/OFF_S45net 2>&1
```

Se esiste solo `OFF_S45net`, questa modifica è già presente. Se esiste solo `S45net`, verifica prima che lo script contenga effettivamente l'avvio della radio sul tuo firmware:

```sh
grep -n -E 'mt_wifi|apcli|ra0|udhcpc|udhcpd' /etc/init.d/S45net
```

**Solo se hai confermato lo script e hai accesso UART funzionante**, rinominalo senza cancellarlo:

```sh
mv /etc/init.d/S45net /etc/init.d/OFF_S45net
sync
```

Se esistono entrambi i file, o nessuno dei due, fermati: la configurazione è diversa e non sovrascrivere nulla. Non lasciare una copia chiamata `S45net.bak` dentro `/etc/init.d`: anche quel nome corrisponde a `S??*` e verrebbe eseguito al boot.

Al successivo **riavvio controllato della serra**, rientra via UART e ricontrolla il nome dello script. Per verificare lo stato corrente, `lsmod | grep '^mt_wifi'` non dovrebbe restituire righe e `ifconfig ra0` / `ifconfig apcli0` non dovrebbero mostrare interfacce attive. Controlla anche sul router che la serra non torni collegata. Queste verifiche riguardano il boot e lo stato osservato; non dimostrano da sole l'assenza di qualunque trasmissione radio in ogni istante.

Per **ripristinare l'avvio originale** sul firmware che usa questi nomi, sempre via UART e solo se `S45net` non esiste già:

```sh
mv /etc/init.d/OFF_S45net /etc/init.d/S45net
sync
```

La rete originale tornerà ad avviarsi al successivo riavvio della serra.

Sul prototipo è presente anche il token fittizio `offline-token`, verificato nel file `/opt/data/token`. Era stato impostato per ostacolare l'associazione al cloud originale. È una misura distinta: non spegne la Wi-Fi e non garantisce da sola che il cloud non possa riconoscere la serra tramite altri identificativi. La [procedura per il token e il suo ripristino](../approfondimenti/configurazione-serra.md#cambiare-il-token-della-serra) è facoltativa per il controllo locale via UART; conserva il valore originale prima di modificarlo.

---

## Service + timer: controllo aggiuntivo della rete VoCore

Questo service invia alla serra il comando `serra net off`. Il timer lo esegue **una sola volta, circa 60 secondi dopo l'avvio del Raspberry**: è un controllo aggiuntivo, utile anche se la rete è stata riattivata durante la sessione, ma non sostituisce la modifica dello script sul VoCore. Se abiliti il timer quando il Raspberry è acceso da più di 60 secondi, systemd può eseguirlo subito.

La serra deve essere già accesa e raggiungibile via UART quando il timer scatta. Se si accende più tardi, controlla il log con `journalctl -u serra-netoff.service -n 30 --no-pager` ed esegui `sudo systemctl start serra-netoff.service` dopo averla accesa. **Se riavvii soltanto la serra, il timer non scatta di nuovo:** la Wi-Fi rimane disabilitata al boot soltanto se hai verificato o effettuato la modifica dello script qui sopra. Altrimenti ripeti `serra net off` manualmente. Il log conferma l'invio del comando, non è una misura indipendente della radio Wi-Fi.

### Service one-shot

Installa il [file del servizio](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/systemd/serra-netoff.service) già copiato sul Raspberry:

```bash
sudo install -m 644 /home/pi/serra-netoff.service /etc/systemd/system/
```

Contenuto del file:

```ini {.file-content}
[Unit]
Description=Serra: disable VoCore network (net off)
After=network.target

[Service]
Type=oneshot
User=pi
EnvironmentFile=/etc/serra-mqtt.env
ExecStart=/usr/local/bin/serra net off
```

### Timer

Installa il [file del timer](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/systemd/serra-netoff.timer):

```bash
sudo install -m 644 /home/pi/serra-netoff.timer /etc/systemd/system/
```

Contenuto del file:

```ini {.file-content}
[Unit]
Description=Serra: run net off once after boot (60s)

[Timer]
OnBootSec=60
AccuracySec=1s
Persistent=false

[Install]
WantedBy=timers.target
```

### Enable

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now serra-netoff.timer
```

Verifica:

```bash
systemctl list-timers --all | grep serra
systemctl status serra-netoff.service --no-pager
journalctl -u serra-netoff.service -n 30 --no-pager
```

**Risposta attesa:** una riga con `serra-netoff.timer` e `serra-netoff.service`. Essendo un timer che scatta una sola volta dopo il boot, la prossima esecuzione può apparire come `-` dopo che è già partito. Per il servizio one-shot, `inactive (dead)` dopo un'**esecuzione riuscita** è normale; controlla che compaia `status=0/SUCCESS` o `Finished` nel log. Un timer elencato non prova da solo che il comando sia riuscito. Date, orari e spaziatura dipendono dal sistema.

---

## Service + timer: state sync periodico

Questo servizio esegue `serra state sync` senza aprire la UART. Ricalcola gli stati logici e li pubblica sul broker configurato in `/etc/serra-mqtt.env`; il timer lo ripete ogni 30 minuti.

### Service

Installa il [file del servizio](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/systemd/serra-state-sync.service):

```bash
sudo install -m 644 /home/pi/serra-state-sync.service /etc/systemd/system/
```

Contenuto del file:

```ini {.file-content}
[Unit]
Description=Serra: MQTT state sync

[Service]
Type=oneshot
User=pi
EnvironmentFile=/etc/serra-mqtt.env
ExecStart=/usr/local/bin/serra state sync
```

### Timer

> [!NOTE] Nota
> Il timer usa `OnBootSec` e `OnUnitActiveSec`: la sincronizzazione parte circa 2 minuti dopo il boot e si ripete ogni 30 minuti.

Installa il [file del timer](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/systemd/serra-state-sync.timer):

```bash
sudo install -m 644 /home/pi/serra-state-sync.timer /etc/systemd/system/
```

Contenuto del file:

```ini {.file-content}
[Unit]
Description=Serra: run state sync every 30 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=30min
AccuracySec=10s
Persistent=true

[Install]
WantedBy=timers.target
```

### Enable

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now serra-state-sync.timer
```

Verifica:

```bash
systemctl list-timers --all | grep serra
journalctl -u serra-state-sync.service -n 50 --no-pager
```

**Risposta attesa:** nell'elenco compaiono `serra-state-sync.timer` associato a `serra-state-sync.service` e `serra-netoff.timer` associato a `serra-netoff.service`. Il log del servizio di sincronizzazione deve contenere `STATE SYNC OK` e una conclusione senza errori. Date e intervalli sono variabili. Questo sync ricalcola gli stati registrati, **non legge lo stato fisico** della serra.

---

## Service + timer: rilevare i riavvii della serra

`serra uptime` legge via UART il tempo trascorso dall'avvio della serra e pubblica `serra/state/boot` e `serra/state/pi_boot`. Il timer presente sul Raspberry di riferimento lo esegue ai minuti **:10 e :40 di ogni ora**. È una lettura: non riavvia la serra e non modifica luci, ventole o pompe. Richiede che la serra sia accesa quando parte; se la lettura fallisce, consulta il log e riprova dopo aver verificato il collegamento.

Installa i file pronti [service](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/systemd/serra-uptime.service) e [timer](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/systemd/serra-uptime.timer):

```bash
sudo install -m 644 /home/pi/serra-uptime.service /home/pi/serra-uptime.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now serra-uptime.timer
```

Verifica senza attendere il prossimo intervallo:

```bash
sudo systemctl start serra-uptime.service
systemctl show serra-uptime.service -p Result -p ExecMainStatus
journalctl -u serra-uptime.service -n 20 --no-pager
```

**Risposta attesa:** `Result=success`, `ExecMainStatus=0` e una riga `UPTIME: ...` nel log. Controlla anche i topic MQTT se vuoi verificare la pubblicazione: l'esito del servizio da solo non dimostra che Home Assistant abbia ricevuto i messaggi.

---

## Service su richiesta: livello dell'acqua

Il [servizio del livello acqua](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/systemd/serra-water-level.service) esegue `serra water level` e pubblica `serra/state/water`. È installato **senza timer**: avvialo quando serve, con la pompa ferma e l'acqua a riposo. Prima occorrono i due riferimenti `serra water calibrate empty` e `serra water calibrate full`; la [sintassi completa](../riferimento-comandi.md#livello-dellacqua) è nella pagina dei comandi.

```bash
sudo install -m 644 /home/pi/serra-water-level.service /etc/systemd/system/
sudo systemctl daemon-reload
```

Se hai già calibrato il sensore e la pompa è ferma:

```bash
sudo systemctl start serra-water-level.service
systemctl show serra-water-level.service -p Result -p ExecMainStatus
```

**Risposta attesa:** `Result=success` e `ExecMainStatus=0`. Se non hai ancora calibrato, lascia il servizio installato e prova la lettura solo dopo la calibrazione. Il suo stato `inactive (dead)` a fine esecuzione è normale per un servizio `oneshot`.

### Comandi utili per verificare i timer e services

Per verificare il timer che invia `net off` dopo il boot del Raspberry:

```bash
systemctl status serra-netoff.timer --no-pager
systemctl list-timers --all | grep -i serra
```

Per verificare il timer di sincronizzazione e gli ultimi log:

```bash
systemctl status serra-state-sync.timer --no-pager
systemctl list-timers --all | grep -i serra
sudo journalctl -u serra-state-sync.service -n 50 --no-pager
```

Per elencare tutti i timer della serra:

```bash
systemctl list-timers --all | grep -i serra
```

Se serve eseguire manualmente i servizi **dopo aver acceso la serra**, avviali uno alla volta:

```bash
sudo systemctl start serra-netoff.service
```

```bash
sudo systemctl start serra-state-sync.service
```

---

## Stato atteso a fine capitolo

A questo punto questo dovrebbe essere lo stato attuale:

- ✅ comando serra funzionante
- ✅ controllo serra via UART
- ✅ bridge MQTT attivo e resiliente
- ✅ topic di stato MQTT pubblicati; coerenza logica da verificare dopo riavvii o comandi non osservati
- ✅ script di avvio Wi-Fi del VoCore disabilitato e verificato sulla tua serra; comando aggiuntivo dal Raspberry con esito da verificare
- ✅ state sync periodico attivo
- ✅ timer di controllo dei riavvii attivo
- ✅ servizio livello acqua disponibile su richiesta (dopo la calibrazione)

Da qui in poi:

- Home Assistant può essere configurato
- il Raspberry è l’unico punto di controllo e osservabilità

---

## Backup facoltativo dei file sul Raspberry

I file Python originali sono già nella repository. Se li hai modificati sul Raspberry, crea sul computer una cartella dedicata al backup e apri lì Terminale (macOS/Linux) o PowerShell (Windows). Con il client OpenSSH, gli stessi comandi funzionano sui tre sistemi e salvano i file nella **cartella corrente**:

```text {.command-example}
scp pi@<RASPBERRY_IP>:/home/pi/serra_controller.py ./serra_controller_backup.py
scp pi@<RASPBERRY_IP>:/home/pi/serra_mqtt_bridge.py ./serra_mqtt_bridge_backup.py
```

Sostituisci `<RASPBERRY_IP>` prima di eseguirli; controlla che i due file compaiano nella cartella scelta. Se ripeti la copia nella stessa cartella, i file con suffisso `_backup` vengono sovrascritti. Il file `/etc/serra-mqtt.env` contiene segreti: se vuoi conservarne un backup, trattalo separatamente come materiale riservato e non caricarlo su GitHub.

---

## Continua il percorso

> [!TIP] Controllo
> **Verifica prima di proseguire:** I timer necessari sono attivi; il servizio del livello acqua è installato, ma non va eseguito prima della calibrazione.

<table width="100%" class="step-nav">
  <tr>
    <td width="50%" align="left"><strong>Passo precedente</strong><br><a href="07-bridge-mqtt.md">← 07 · Configurare il bridge MQTT</a></td>
    <td width="50%" align="right"><strong>Passo successivo</strong><br><a href="09-home-assistant.md">09 · Collegare Home Assistant →</a></td>
  </tr>
</table>
