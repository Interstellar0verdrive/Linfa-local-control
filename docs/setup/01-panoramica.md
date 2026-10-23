# 01 · Panoramica e obiettivi

**Percorso guidato:** [Indice dei capitoli](../index.md)

## Cosa stiamo facendo e perché

Questa documentazione descrive un sistema per **controllare in locale** la serra Linfa Weezy (Robonica) **senza dipendere dal cloud**. La serra esegue i comandi, il Raspberry li invia e Home Assistant offre l'interfaccia per usarli. Il Raspberry può parlare con la serra tramite [Wi-Fi e SSH](02-wifi.md) oppure tramite [cavo USB e porta seriale UART](02-hardware.md): ciò che vedi in Home Assistant rimane uguale.

La scelta cambia soprattutto **come raggiungi la serra e come la tieni offline**. Con **Wi-Fi**, la radio rimane attiva sulla rete di casa: devi impedire alla serra di raggiungere Internet pur mantenendo la comunicazione locale. Con **USB**, il Raspberry usa un adattatore seriale a 3,3 V collegato ai pin interni; puoi disabilitare la radio della serra, ma devi aprirla e realizzare il cablaggio. Sul mio esemplare già modificato ho provato entrambe le comunicazioni. L'accesso SSH iniziale su una serra originale resta da verificare: se non funziona, puoi entrare tramite USB e poi scegliere se usarlo stabilmente o passare al Wi-Fi.

<figure class="system-diagram">
  <svg viewBox="0 0 420 515" role="img" aria-labelledby="system-diagram-title system-diagram-description" xmlns="http://www.w3.org/2000/svg">
    <title id="system-diagram-title">Schema del controllo locale della serra</title>
    <desc id="system-diagram-description">Dall'alto verso il basso: serra Linfa, Raspberry Pi, broker MQTT e Home Assistant. La serra è collegata al Raspberry Pi via USB UART a 3,3 volt oppure Wi-Fi locale tramite SSH; il Raspberry Pi e Home Assistant comunicano tramite il broker MQTT. I comandi risalgono verso la serra e gli stati scendono verso Home Assistant.</desc>

    <rect class="flow-card" x="20" y="18" width="380" height="88" rx="14" />
    <circle class="flow-number" cx="55" cy="62" r="18" />
    <text class="flow-number-text" x="55" y="66" text-anchor="middle">01</text>
    <text class="flow-title" x="87" y="58">Serra Linfa · VoCore2</text>
    <text class="flow-caption" x="87" y="82">Luci, ventole, pompe e LED</text>

    <path class="flow-link" d="M210 113v28m-5-23 5-6 5 6m-10 18 5 6 5-6" />
    <text class="flow-link-label" x="229" y="132">USB / Wi-Fi</text>

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
- Un **Raspberry Pi esterno** raggiunge la shell della serra via **USB seriale** oppure **SSH sulla Wi-Fi locale** e invia i comandi con l'utente `root`.
- Un **bridge MQTT** sul Raspberry permette a **Home Assistant** (o qualunque client MQTT) di:
    - inviare comandi alla serra pubblicando su topic MQTT
    - leggere l'ultimo stato **logico stimato** dei componenti tramite topic MQTT “retained”

Perché farlo:

- Ridurre il rischio che, in caso di dismissione server o problemi di rete, la serra diventi inutilizzabile.
- Avere un controllo totale e ispezionabile (logica in Python + systemd).
- Integrare la serra in Home Assistant (dashboard, automazioni, notifiche).

Obiettivo pratico del progetto:

- Comandi affidabili da CLI (`serra ...`) sul Raspberry
- Comandi equivalenti via MQTT (`serra/cmd`)
- Stati consistenti e leggibili via MQTT (`serra/state/...`)
- Con USB: Wi-Fi della serra spenta anche dopo il riavvio. Con Wi-Fi: LAN attiva ma nessuna rotta dalla serra verso Internet.

---

## Prima di intervenire: sicurezza elettrica e acqua

> [!CAUTION] Scollega la serra e l'adattatore seriale
> Prima di aprire la serra, cercare i pin sulla scheda, collegare o scollegare i fili, saldare o forare, **scollega la spina della serra dalla presa e l'adattatore USB → TTL dal Raspberry/computer**. Spegnere la serra senza staccare la spina non basta. Non aprire né modificare l'alimentatore o i collegamenti alla rete elettrica.

Lavora con la parte superiore su una **superficie stabile e asciutta**. Tieni scheda, fili, saldatore, alimentatori e giunzioni lontani da acqua, serbatoi, tubi e pompe; quando la serra è smontata, evita che una perdita o uno spostamento dei tubi possa bagnare l'elettronica. Prima di riaccendere, verifica che i collegamenti siano saldi e isolati, che non ci siano fili scoperti o cortocircuiti, che tutto sia asciutto e che la scocca sia richiusa. Se trovi acqua o danni su un componente elettrico, non alimentarlo: fallo controllare da una persona qualificata.

Questa guida **presuppone esperienza di base con elettronica e saldatura**: devi saper riconoscere TX, RX e GND, verificare l'assenza di alimentazione e isolare i fili senza danneggiare la scheda. Se non sai farlo in sicurezza o hai dubbi sulla tua serra, **fermati e chiedi aiuto a una persona qualificata**. Per indicazioni generali, vedi i [consigli di sicurezza per i lavori elettrici](https://www.esfi.org/do-it-yourself-diy-electrical-safety/) della Electrical Safety Foundation International.

---

## Cosa serve prima di iniziare

### Per entrambi i percorsi

- **Serra Linfa.** Ho provato la procedura su Linfa Weezy; la compatibilità con Linfa standard è ancora da verificare.
- **Computer Windows, macOS o Linux** con browser e client SSH, collegato alla rete del Raspberry durante l'installazione. Non deve restare acceso durante l'uso normale.
- **Raspberry Pi**, microSD da almeno 16 GB, alimentatore adatto e collegamento alla rete domestica. Il mio prototipo usa un Pi 3B.
- **Raspberry Pi OS con Python 3.10 o successivo**, un broker MQTT raggiungibile dal Raspberry e da Home Assistant, e l'integrazione MQTT di Home Assistant. Controller e bridge sono già nella repository; Git viene installato nel passo 03.
- **Solo se vuoi automazioni climatiche:** un sensore di temperatura e umidità compatibile con Home Assistant, collocato **dentro la serra**. Io uso un Aqara Zigbee; il controller non pubblica ancora le misure dei sensori interni originali. Un secondo sensore nella stanza può aiutare a decidere quando ventilare.

### In più per il percorso Wi-Fi

- **Accesso al router** e possibilità di scollegare temporaneamente il suo collegamento Internet/WAN durante il primo setup. La rete locale deve rimanere attiva.
- **Computer con Python 3** per il pairing locale, se l'app originale non è disponibile. Sul Raspberry installerai `sshpass` per il collegamento SSH automatico.
- **Accesso SSH alla serra**: sulla serra originale non è ancora verificato. Se il tentativo non riesce, il percorso USB permette di entrare e impostare la password prima di tornare al Wi-Fi.

### In più per il percorso USB

- **Adattatore USB–TTL con segnali TX e RX a 3,3 V** e GND, da collegare al Raspberry. **Non collegare VCC.** Vedi [criteri ed esempi nel passo 02B](02-hardware.md#ladattatore-usb-ttl).
- **Tre cavetti jumper Dupont maschio–maschio** per il montaggio mostrato: i fili in uscita dalla serra e quelli del cavo DTech terminano entrambi con connettori femmina. Servono solo TX, RX e GND; un adattatore diverso può richiedere cavetti diversi.
- **Cavo USB**, se non è integrato nell'adattatore, e attrezzi per aprire la serra, fissare e isolare i fili. Nel montaggio documentato i fili sono stati saldati e fatti uscire da un foro nella scocca. Un Pi Zero 2 W richiede anche un adattatore USB OTG.

La scheda è nella **parte superiore della serra, dove si trovano le luci**. Il [passo 02B](02-hardware.md#cablaggio-uart) mostra i collegamenti e il foro; non è disponibile una foto ravvicinata delle saldature.

> [!WARNING] Servizio originale da verificare
> Nel prototipo, `robocontrol/rcc` era già fermo durante i test dei comandi. I file attuali confermano che il suo avvio automatico è disattivato. **Non è verificato** che il controller e il servizio originale possano comandare contemporaneamente gli stessi componenti. Il [passo 06](06-controller-cli.md#verifica-del-servizio-originale) spiega come controllare, disattivare e ripristinare il servizio prima di azionare luci, ventole o pompe. La sequenza è stata ricostruita sul prototipo, ma non ancora provata da zero su una seconda serra.

---

## Vincoli di sicurezza e modifiche alla serra

Il percorso essenziale **non sostituisce il firmware** né richiede il dump del filesystem. Il percorso USB apre e modifica fisicamente la serra; il percorso Wi-Fi modifica la sua configurazione di rete. Entrambi richiedono di gestire la password root: valuta prima i rischi e conserva le informazioni necessarie per un eventuale ripristino.

Vincoli/assunzioni:

- La password root viene verificata o impostata nel passo 05 perché il controller la richiede su entrambi i canali.
- Con USB, il [passo 08](08-servizi-automatici.md#disabilitare-la-wi-fi-allavvio-della-serra) spiega come impedire l'avvio della radio. Con Wi-Fi, lo script di rete deve invece avviarsi e l'isolamento senza gateway va verificato dopo il boot; il timer `serra-netoff` deve restare disabilitato.
- Il blocco degli aggiornamenti è una [modifica facoltativa documentata a parte](../approfondimenti/configurazione-serra.md#bloccare-gli-aggiornamenti-automatici), non un prerequisito dei passi 06–09. La gestione del servizio originale `rcc` richiede invece il controllo e, se attivo, la disattivazione descritta nel passo 06.
- Conserva un modo sicuro per ripristinare le modifiche che scegli di applicare. Il collegamento saldato e il foro nella scocca richiedono anche un intervento fisico per tornare alla configurazione originale.

Implicazioni:

- Gli “stati” pubblicati su MQTT sono **stati logici** (derivati dai comandi inviati e da timer), non telemetrie hardware affidabili al 100%.
- Per mantenere coerenza degli stati temporizzati (pompe/ring), è previsto un **state sync periodico** (`serra state sync` via systemd timer).

---

## Architettura (VoCore2 + Raspberry + MQTT + HA)

Componenti e responsabilità:

**1) Serra (VoCore2)**

- Esegue fisicamente le azioni (luci, ventole, pompe nutrienti, pompa principale, LED ring).
- Espone una console root via **UART seriale** (tipicamente 115200 baud) e, sul firmware provato, anche una shell **SSH** quando la rete è attiva.
- Con UART la radio può restare spenta; con Wi-Fi rimane sulla LAN senza rotta verso Internet.

**2) Raspberry Pi (controller)**

- Collegamento scelto: USB → TTL 3,3 V → UART, oppure Wi-Fi domestica → SSH locale.
- Esegue lo script/CLI serra (Python) che:
    - apre la console seriale o una sessione SSH
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

    `serra lights on` → VoCore via UART o SSH → update state.json → publish MQTT state/status

- **Comando da Home Assistant (MQTT):**

    HA → `serra/cmd` pubblico `lights on` → bridge → `serra lights on` → VoCore via UART o SSH → update state.json → publish MQTT state/status


Punti chiave:

- Il Raspberry è il punto di controllo e conserva l'ultimo stato logico pubblicato su MQTT.
- I topic di **stato e stato del bridge** sono pubblicati come “retained”; i topic di **comando e conferma** non lo sono. Gli stati restano stime logiche e possono essere superati dopo un riavvio o un comando non osservato.

---

## Continua il percorso

> [!TIP] Controllo
> **Verifica prima di proseguire:** Hai scelto Wi-Fi o USB e compreso il ruolo di serra, Raspberry, MQTT e Home Assistant.

<table width="100%" class="step-nav">
  <tr>
    <td width="50%" align="left"><strong>Passo precedente</strong><br><a href="../index.md">← Indice completo</a></td>
    <td width="50%" align="right"><strong>Scegli il passo 02</strong><br><a href="02-wifi.md">02A · Wi-Fi →</a><br><a href="02-hardware.md">02B · USB →</a></td>
  </tr>
</table>
