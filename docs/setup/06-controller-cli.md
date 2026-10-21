# 06 · Installare il controller CLI

**Percorso guidato:** [Indice dei capitoli](../index.md)

In questo passo copi gli script sul Raspberry e verifichi il **controller CLI** tramite UART. Il bridge MQTT e i servizi automatici saranno configurati nei passi 07 e 08.

**Assunzioni in ingresso (stato iniziale):**

- Raspberry pronto, con UART funzionante
- Nessun file serra_*.py ancora installato
- Nessun servizio serra-* attivo
- Il servizio originale `robocontrol/rcc` non deve comandare i componenti contemporaneamente: sul prototipo era già fermo quando i comandi sono stati provati.

Questi sono i file coinvolti nei passi 06–08:

| FILE | DESCRIZIONE | NOTE |
| --- | --- | --- |
| /home/pi/serra_help.txt | **Help CLI**: è usato dal comando `serra --help` e deve stare accanto a `serra_controller.py`. | Va copiato sul Raspberry al primo setup. |
| /home/pi/serra_controller.py | **Controller**: cuore logico del sistema (CLI, UART, stato, MQTT publish) | Va copiato a mano nel Raspberry al primo setup. |
| /home/pi/serra_mqtt_bridge.py | **MQTT Bridge**: si occupa di fare la traduzione MQTT → CLI | Va copiato a mano nel Raspberry al primo setup. |
| /home/pi/.serra_state.json | **Stato runtime (source of truth logica):** cache JSON con ultimo stato noto dei componenti + ultimi comandi. Viene aggiornata dalla CLI ad ogni comando e usata per pubblicare serra/state/... su MQTT (retained). | Viene creata/aggiornata automaticamente dal controller al primo comando (serra ...). Non va caricata manualmente al primo setup.  |
| /etc/serra-mqtt.env | **Configurazione MQTT**: contiene segreti + parametri runtime | Va creato “a mano” nel Raspberry al primo setup. |
| /etc/systemd/system/serra-mqtt-bridge.service | **Service systemd del MQTT Bridge:** avvia e mantiene in esecuzione serra_mqtt_bridge.py (subscriber su serra/cmd → invoca CLI serra ... → pubblica serra/status/* + stati via controller). | Va creato “a mano” nel Raspberry al primo setup (insieme a /etc/serra-mqtt.env). Poi: daemon-reload + enable --now. È configurato con Restart=always per resilienza. |
| /etc/systemd/system/serra-netoff.service e .timer | Il service spegne la rete della serra; il timer lo richiama dopo il boot. | Vanno creati sul Raspberry. |
| /etc/systemd/system/serra-state-sync.service e .timer | Il service sincronizza lo stato; il timer lo richiama periodicamente. | Vanno creati sul Raspberry. |

File della repository: [controller CLI](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/serra_controller.py), [bridge MQTT](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/serra_mqtt_bridge.py) e [help CLI](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/serra_help.txt).

---

## Copia dei file Python sul Raspberry

Copia sul Raspberry i tre file principali. Sul computer da cui esegui la copia, clona la repository e usa i file della cartella `bridge/`:

```bash
git clone https://github.com/Interstellar0verdrive/Linfa-local-control.git
cd Linfa-local-control
scp bridge/serra_controller.py bridge/serra_mqtt_bridge.py bridge/serra_help.txt pi@<RASPBERRY_IP>:/home/pi/
```

Sostituisci `<RASPBERRY_IP>` prima di eseguire il comando. Per verificare, accedi al Raspberry:

```bash
ssh pi@<RASPBERRY_IP>
```

Impostare permessi di esecuzione:

```bash
chmod +x /home/pi/serra_controller.py /home/pi/serra_mqtt_bridge.py
```

Verifica:

```bash
ls -la /home/pi/serra_controller.py /home/pi/serra_mqtt_bridge.py
```

**Risposta attesa:** due righe, una per file, con il permesso di esecuzione (`x`). Dimensioni e date dipendono dai file copiati.

---

## Creazione symlink CLI /usr/local/bin/serra

Il comando serra **non è una copia**, ma un symlink al file Python.

Questo consente di:

- aggiornare il controller modificando solo `serra_controller.py`
- non toccare systemd o il PATH

```bash
sudo ln -sf /home/pi/serra_controller.py /usr/local/bin/serra
```

Verifica:

```bash
readlink -f /usr/local/bin/serra
which serra
```

I due comandi stampano, nell'ordine:

```text {.expected-output}
/home/pi/serra_controller.py
/usr/local/bin/serra
```

---

## Test iniziale della CLI

Prima di introdurre il bridge MQTT, verificare che la CLI funzioni **localmente**.

### Verifica del servizio originale

Nella console della **serra**, prima di avviare prove che azionano componenti, esegui `ps` e cerca un processo `rcc`, `robocontrol` o un processo Node avviato da `start-rcc`. Controlla di nuovo dopo ogni riavvio della serra. Nel prototipo questo servizio era già fermo durante le prove. Un [log successivo](../approfondimenti/accesso-e-dump.md#il-servizio-originale-rcc) registra il backup di `/etc/inittab`, la sua voce `respawn` commentata, il ricaricamento di `init` e l'arresto del processo; non conserva però i comandi esatti né conferma che l'arresto sopravviva al riavvio. Se `rcc` è in esecuzione, **non proseguire con i comandi di controllo** sulla base di questa guida: l'interazione simultanea con il controller non è stata verificata. Anche un processo assente non dimostra da solo che l'arresto sia persistente.

Questo è un limite aperto della procedura per una serra nello stato originale. Non modificare `/etc/inittab` o terminare processi seguendo comandi trovati altrove senza comprendere l'effetto sul firmware e sul suo ripristino.

Chiudi `picocom` con `Ctrl+A`, poi `Ctrl+X` prima di usare la CLI; altrimenti la porta resta occupata.

Il controller non contiene una password root predefinita. In questa sessione di terminale imposta la password della console della **tua** serra senza scriverla nella cronologia della shell:

```bash
read -rsp 'Password della console della serra: ' SERRA_ROOT_PASSWORD; echo
export SERRA_ROOT_PASSWORD
```

Se la porta individuata nel passo 03 non è `/dev/ttyUSB0`, imposta anche il percorso reale **nella stessa sessione** (esempio):

```bash
export SERRA_UART_PORT=/dev/ttyUSB1
```

Nel passo 07 riporterai l'eventuale `SERRA_UART_PORT` anche nel file usato dai servizi.

Per i servizi automatici, la stessa variabile sarà inserita nel file locale `/etc/serra-mqtt.env`, che non deve essere caricato su GitHub.

```bash
serra --help
```

**Risposta attesa:** la guida dei comandi della CLI.

Per cercare un'azione senza scorrere l'help nel terminale, consulta il [riferimento completo dei comandi](../riferimento-comandi.md): mostra anche il payload equivalente per Home Assistant.

Test di apertura della console e login via UART (non aziona i componenti):

```bash
serra state sync
```

**Risposta attesa:** `STATE SYNC OK`.

`state sync` ricalcola solo lo stato **logico** registrato: l'esito conferma l'accesso alla console, ma non misura lo stato fisico né prova ancora i comandi verso luci e ventole. In questo passo non hai configurato il broker MQTT, quindi non aspettarti nuovi topic finché non completi il passo 07.

Esegui questi comandi di prova **uno alla volta**, osservando il risultato dopo ciascuno.

Accendi le luci con una dissolvenza di 2 secondi:

```bash
serra lights on -f 2
```

Spegni le luci con una dissolvenza di 2 secondi:

```bash
serra lights off -f 2
```

Accendi le ventole:

```bash
serra fans on
```

Spegni le ventole:

```bash
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

```bash
ls -la /home/pi/.serra_state.json
cat /home/pi/.serra_state.json | jq .
```

**Risposta attesa:** il primo comando mostra il file esistente; il secondo mostra un oggetto JSON valido con sezioni come `meta`, `last_seen` e `lights`. Timestamp e stati riflettono la tua serra e cambiano a ogni esecuzione.

> [!NOTE] Nota
> Il file di stato è la fonte logica degli stati pubblicati su MQTT. Registra l'ultimo stato noto al controller; non è una misura hardware diretta.

---

## Continua il percorso

> [!TIP] Controllo
> **Verifica prima di proseguire:** Il comando `serra state sync` funziona dal Raspberry tramite UART.

<table width="100%" class="step-nav">
  <tr>
    <td width="50%" align="left"><strong>Passo precedente</strong><br><a href="05-password-root.md">← 05 · Impostare la password root</a></td>
    <td width="50%" align="right"><strong>Passo successivo</strong><br><a href="07-bridge-mqtt.md">07 · Configurare il bridge MQTT →</a></td>
  </tr>
</table>
