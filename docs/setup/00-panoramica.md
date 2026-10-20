# 00 · Panoramica e obiettivi

**Percorso guidato:** [Indice dei capitoli](../index.md)

## Cosa stiamo facendo e perché

Questa documentazione descrive un setup per **controllare in locale** la serra Linfa Weezy (Robonica) **senza dipendere dal cloud**.

<figure class="system-diagram">
  <svg viewBox="0 0 420 515" role="img" aria-labelledby="system-diagram-title system-diagram-description" xmlns="http://www.w3.org/2000/svg">
    <title id="system-diagram-title">Schema del controllo locale della serra</title>
    <desc id="system-diagram-description">Dall'alto verso il basso: serra Linfa, Raspberry Pi, broker MQTT e Home Assistant. La serra è collegata al Raspberry Pi via USB UART a 3,3 volt; il Raspberry Pi e Home Assistant comunicano tramite il broker MQTT. I comandi risalgono verso la serra e gli stati scendono verso Home Assistant.</desc>

    <rect class="flow-card" x="20" y="18" width="380" height="88" rx="14" />
    <circle class="flow-number" cx="55" cy="62" r="18" />
    <text class="flow-number-text" x="55" y="66" text-anchor="middle">01</text>
    <text class="flow-title" x="87" y="58">Serra Linfa · VoCore2</text>
    <text class="flow-caption" x="87" y="82">Luci, ventole, pompe e LED</text>

    <path class="flow-link" d="M210 113v28m-5-23 5-6 5 6m-10 18 5 6 5-6" />
    <text class="flow-link-label" x="229" y="132">USB → UART · 3,3 V</text>

    <rect class="flow-card flow-card-controller" x="20" y="148" width="380" height="88" rx="14" />
    <circle class="flow-number" cx="55" cy="192" r="18" />
    <text class="flow-number-text" x="55" y="196" text-anchor="middle">02</text>
    <text class="flow-title" x="87" y="188">Raspberry Pi</text>
    <text class="flow-caption" x="87" y="212">Controller CLI e bridge MQTT</text>

    <path class="flow-link" d="M210 243v28m-5-23 5-6 5 6m-10 18 5 6 5-6" />
    <text class="flow-link-label" x="229" y="262">MQTT</text>

    <rect class="flow-card" x="20" y="278" width="380" height="88" rx="14" />
    <circle class="flow-number" cx="55" cy="322" r="18" />
    <text class="flow-number-text" x="55" y="326" text-anchor="middle">03</text>
    <text class="flow-title" x="87" y="318">Broker MQTT</text>
    <text class="flow-caption" x="87" y="342">Scambia topic di comando e stato</text>

    <path class="flow-link" d="M210 373v28m-5-23 5-6 5 6m-10 18 5 6 5-6" />
    <text class="flow-link-label" x="229" y="392">MQTT</text>

    <rect class="flow-card" x="20" y="408" width="380" height="88" rx="14" />
    <circle class="flow-number" cx="55" cy="452" r="18" />
    <text class="flow-number-text" x="55" y="456" text-anchor="middle">04</text>
    <text class="flow-title" x="87" y="448">Home Assistant</text>
    <text class="flow-caption" x="87" y="472">Dashboard e automazioni</text>
  </svg>
  <figcaption>Comandi verso la serra ↑ &nbsp;·&nbsp; Stati verso Home Assistant ↓</figcaption>
</figure>

In sintesi:

- La serra è basata su un **VoCore2 (Linux/BusyBox)** che gestisce fisicamente luci, ventole, pompe e LED ring.
- Un **Raspberry Pi esterno** si collega alla serra tramite **console UART** e invia comandi “come se fossimo da terminale” (login `root`).
- Un **bridge MQTT** sul Raspberry permette a **Home Assistant** (o qualunque client MQTT) di:
    - inviare comandi alla serra pubblicando su topic MQTT
    - leggere lo stato corrente dei componenti tramite topic MQTT “retained”

Perché farlo:

- Ridurre il rischio che, in caso di dismissione server o problemi di rete, la serra diventi inutilizzabile.
- Avere un controllo totale e ispezionabile (logica in Python + systemd).
- Integrare la serra in Home Assistant (dashboard, automazioni, notifiche).

Obiettivo pratico del progetto:

- Comandi affidabili da CLI (`serra ...`) sul Raspberry
- Comandi equivalenti via MQTT (`serra/cmd`)
- Stati consistenti e leggibili via MQTT (`serra/state/...`)
- Policy di sicurezza per disabilitare la rete Wi-Fi della serra dopo il boot

---

## Cosa serve prima di iniziare

| Componente | Cosa verificare |
| --- | --- |
| **Serra Linfa** | La procedura è stata provata su Linfa Weezy; la Linfa standard non è ancora verificata. |
| **Raspberry Pi** | Il prototipo usa un Pi 3B. Servono microSD da almeno 16 GB, alimentatore adatto al modello e connessione alla rete domestica. Un Pi Zero 2 W richiede anche un adattatore USB OTG per collegare la seriale. |
| **Adattatore USB → UART/TTL** | I segnali TX e RX devono essere a **3,3 V**; servono anche GND e una connessione USB al Raspberry. Il pin di alimentazione VCC non si collega alla serra. Vedi [i criteri e gli esempi nel passo 01](01-hardware.md#ladattatore-usb-ttl). |
| **Tre collegamenti isolati** | TX, RX e GND: cavetti Dupont per una prova su pin accessibili, oppure fili da fissare in modo stabile per l'installazione definitiva. |
| **Cavo USB** | Serve se l'adattatore ha una presa USB; non serve un secondo cavo se l'adattatore è già un cavo USB → UART integrato. Scegli la lunghezza in base alla posizione del Raspberry. |
| **Per il montaggio definitivo** | Attrezzi per aprire la serra, saldatore e materiale isolante se saldi i fili; protezione del bordo e fermacavo se fai passare i fili da un foro nella scocca. |
| **Software e rete** | Raspberry Pi OS, un broker MQTT raggiungibile da Raspberry e Home Assistant, e l'integrazione MQTT di Home Assistant. Il controller e il bridge sono già nella repository. |

La modifica fisica illustrata in questa guida è stata realizzata nella **parte superiore della serra, dove si trovano le luci e il VoCore**, con **fili saldati** e un **foro nella scocca per il passaggio dei fili del cavo seriale**. Il [passo 01](01-hardware.md#cablaggio-uart) descrive i collegamenti e mostra il foro. Non è disponibile una foto ravvicinata delle saldature: prima di richiudere verifica che i collegamenti siano saldi e isolati.

Per ottenere lo stesso controllo locale **non devi ripetere l'analisi MITM, il dump del modulo o le prove delle API originali**: sono documentati negli approfondimenti. Anche la [modifica del token, della Wi-Fi e dei permessi degli aggiornamenti](../approfondimenti/configurazione-serra.md) è separata dal percorso essenziale, perché il controller comunica con la serra via UART.

---

## Vincoli di sicurezza e modifiche alla serra

Il percorso essenziale **non sostituisce il firmware** né richiede il dump del filesystem. L'apertura della serra, il collegamento seriale e l'impostazione della password root sono comunque interventi reali sul dispositivo: valuta prima il rischio e conserva le informazioni necessarie per un eventuale ripristino.

Vincoli/assunzioni:

- La password root della console viene impostata nel passo 04 perché il controller attuale la richiede.
- La disattivazione di Wi-Fi/NTP viene comandata **dall'esterno**, tramite UART e un timer sul Raspberry; non serve riconfigurare la rete della serra per usare il bridge MQTT.
- La sostituzione del token e il blocco degli aggiornamenti sono [modifiche facoltative documentate a parte](../approfondimenti/configurazione-serra.md), non prerequisiti dei passi 05–08.
- Conserva un modo sicuro per ripristinare le modifiche che scegli di applicare. Il collegamento saldato e il foro nella scocca richiedono anche un intervento fisico per tornare alla configurazione originale.

Implicazioni:

- Gli “stati” pubblicati su MQTT sono **stati logici** (derivati dai comandi inviati e da timer), non telemetrie hardware affidabili al 100%.
- Per mantenere coerenza degli stati temporizzati (pompe/ring), è previsto un **state sync periodico** (`serra state sync` via systemd timer).

---

## Architettura (VoCore2 + Raspberry + UART + MQTT + HA)

Componenti e responsabilità:

**1) Serra (VoCore2)**

- Esegue fisicamente le azioni (luci, ventole, pompe nutrienti, pompa principale, LED ring).
- Espone una console root accessibile via **UART seriale** (tipicamente 115200 baud).
- La rete Wi-Fi della serra può essere attivata/disattivata, ma in questo progetto viene gestita dall’esterno (Raspberry).

**2) Raspberry Pi (controller)**

- Connessione fisica: USB → TTL 3.3V → UART console del VoCore (tramite cavo seriale FTDI USB a TTL con 3 vie di uscita flying leads Tx, Rx e GND, con chip FT232)
- Esegue lo script/CLI serra (Python) che:
    - apre la console seriale
    - invia comandi
    - aggiorna uno stato locale (JSON)
    - pubblica stati e status su MQTT

**3) MQTT Bridge (sul Raspberry)**

- Si sottoscrive a `serra/cmd` (e varianti con id/json).
- Traduce i messaggi MQTT in invocazioni della CLI `serra ...`.
- Pubblica:
    - `serra/status/online` (LWT/online-offline)
    - `serra/status/last_seen` (heartbeat/segno di vita)
    - `serra/status/last` e/o `serra/ack/<id>` per esiti comando

**4) Home Assistant**

- È un “client” MQTT:
    - invia comandi pubblicando su `serra/cmd`
    - legge gli stati da `serra/state/...` (retained)
- Può costruire dashboard e automazioni senza parlare direttamente con la serra.

Esempio di flusso dei comandi (due sorgenti possibili):

- **Comando locale (SSH sul Raspberry):**

    `serra lights on` → VoCore via UART → update state.json → publish MQTT state/status

- **Comando da Home Assistant (MQTT):**

    HA → `serra/cmd` pubblico `lights on` → bridge → `serra lights on` → VoCore via UART → update state.json → publish MQTT state/status


Punti chiave:

- Il Raspberry è il “punto di controllo” e “source of truth” per lo stato pubblicato su MQTT.
- I topic MQTT sono “retained” per consentire ad HA di vedere subito l’ultimo stato anche dopo riavvii o riconnessioni.

---

## Continua il percorso

> [!TIP] Controllo
> **Verifica prima di proseguire:** Hai compreso il ruolo di serra, Raspberry, UART, MQTT e Home Assistant.

<table width="100%" class="step-nav">
  <tr>
    <td width="50%" align="left"><strong>Passo precedente</strong><br><a href="../index.md">← Indice completo</a></td>
    <td width="50%" align="right"><strong>Passo successivo</strong><br><a href="01-hardware.md">01 · Hardware e collegamenti →</a></td>
  </tr>
</table>
