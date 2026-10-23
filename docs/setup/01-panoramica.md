# 01 · Panoramica e obiettivi

**Percorso guidato:** [Indice dei capitoli](../index.md)

## Cosa stiamo facendo e perché

Questa documentazione descrive un setup per **controllare in locale** la serra Linfa Weezy (Robonica) **senza dipendere dal cloud**.

Tra serra e Raspberry puoi usare [Wi-Fi locale/SSH](02-wifi.md) oppure [USB–UART](02-hardware.md). Il controller pubblicato offre entrambi; Home Assistant vede gli stessi topic MQTT in ogni caso. Sul nostro esemplare già modificato abbiamo provato il trasporto Wi-Fi, ma **non conosciamo l'accesso SSH iniziale di una serra originale**. Puoi tentarlo senza aprirla; se fallisce, usa UART per il primo accesso. Puoi anche scegliere UART dall'inizio e mantenerla come collegamento permanente.

| Scelta iniziale | Cosa comporta |
| --- | --- |
| **02A · Wi-Fi** | Provi SSH senza aprire la serra. Se entri, prepari il collegamento LAN e verifichi l'isolamento da Internet. Il login iniziale su un esemplare originale resta da confermare. |
| **02B · UART** | Apri la parte superiore e colleghi TX, RX e GND. Puoi usare UART sempre, oppure usarla per impostare la password root e poi passare a Wi-Fi. |

Dal passo 03 le istruzioni tornano comuni, con i soli comandi che dipendono dal collegamento segnalati nel punto in cui servono.

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
    <text class="flow-link-label" x="229" y="132">UART / Wi-Fi</text>

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
- Un **Raspberry Pi esterno** raggiunge la shell della serra via **UART** oppure **SSH sulla Wi-Fi locale** e invia i comandi con l'utente `root`.
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
- Con UART: Wi-Fi della serra spenta anche dopo il riavvio. Con Wi-Fi: LAN attiva ma nessuna rotta dalla serra verso Internet.

---

## Prima di intervenire: sicurezza elettrica e acqua

> [!CAUTION] Scollega la serra e l'adattatore seriale
> Prima di aprire la serra, cercare i pin sulla scheda, collegare o scollegare i fili, saldare o forare, **scollega la spina della serra dalla presa e l'adattatore USB → TTL dal Raspberry/computer**. Spegnere la serra senza staccare la spina non basta. Non aprire né modificare l'alimentatore o i collegamenti alla rete elettrica.

Lavora con la parte superiore su una **superficie stabile e asciutta**. Tieni scheda, fili, saldatore, alimentatori e giunzioni lontani da acqua, serbatoi, tubi e pompe; quando la serra è smontata, evita che una perdita o uno spostamento dei tubi possa bagnare l'elettronica. Prima di riaccendere, verifica che i collegamenti siano saldi e isolati, che non ci siano fili scoperti o cortocircuiti, che tutto sia asciutto e che la scocca sia richiusa. Se trovi acqua o danni su un componente elettrico, non alimentarlo: fallo controllare da una persona qualificata.

Questa guida **presuppone esperienza di base con elettronica e saldatura**: devi saper riconoscere TX, RX e GND, verificare l'assenza di alimentazione e isolare i fili senza danneggiare la scheda. Se non sai farlo in sicurezza o hai dubbi sulla tua serra, **fermati e chiedi aiuto a una persona qualificata**. Per indicazioni generali, vedi i [consigli di sicurezza per i lavori elettrici](https://www.esfi.org/do-it-yourself-diy-electrical-safety/) della Electrical Safety Foundation International.

---

## Cosa serve prima di iniziare

| Componente | Cosa verificare |
| --- | --- |
| **Serra Linfa** | La procedura è stata provata su Linfa Weezy; la Linfa standard non è ancora verificata. |
| **Computer** | Windows, macOS o Linux, con browser e client SSH, per seguire la guida e collegarti al Raspberry durante l'installazione. Deve poter raggiungere il Raspberry sulla rete locale; non serve tenerlo acceso quando il sistema è operativo. |
| **Raspberry Pi** | Il prototipo usa un Pi 3B. Servono microSD da almeno 16 GB, alimentatore adatto al modello e connessione alla rete domestica. Un Pi Zero 2 W richiede anche un adattatore USB OTG per collegare la seriale. |
| **Solo percorso UART: adattatore USB → UART/TTL** | I segnali TX e RX devono essere a **3,3 V**; servono anche GND e una connessione USB al Raspberry. VCC non si collega alla serra. Vedi [criteri ed esempi nel passo 02B](02-hardware.md#ladattatore-usb-ttl). |
| **Solo percorso UART: tre cavetti jumper Dupont maschio–maschio** | Nel montaggio mostrato sia i fili che escono dalla serra sia i terminali del cavo DTech sono femmina: servono tre jumper, uno per TX, uno per RX e uno per GND. **Non serve un quarto cavetto per VCC.** |
| **Solo percorso UART: cavo USB e attrezzi** | Un cavo USB se l'adattatore non è già integrato; attrezzi per aprire la serra, materiale per fissare e isolare i fili e, se necessario, saldatore e protezione del foro. |
| **Solo percorso Wi-Fi: accesso alla rete** | Router configurabile, computer con client SSH e Python 3 per il pairing locale se l'app originale non è disponibile. Sul Raspberry servirà `sshpass`. Prepara un modo per scollegare temporaneamente la WAN durante il primo setup. |
| **Software e rete** | Raspberry Pi OS con Python 3.10 o successivo, un broker MQTT raggiungibile da Raspberry e Home Assistant, e l'integrazione MQTT di Home Assistant. Git si installa sul Raspberry nel passo 03. Il controller e il bridge sono già nella repository. |
| **Per le automazioni climatiche di Home Assistant** | Un sensore di temperatura e umidità compatibile con Home Assistant, collocato **dentro la serra**. Il prototipo usa un Aqara Zigbee: il controller sul Raspberry non pubblica ancora le misure dei sensori interni originali della serra. Sensori di temperatura e umidità della stanza sono utili per decidere se ventilare può raffreddare o deumidificare, ma non sono necessari per i comandi di base. |

Nel percorso UART, la modifica fisica illustrata è stata realizzata nella **parte superiore della serra, dove si trovano le luci e il VoCore**, con fili saldati e un foro nella scocca. Il [passo 02B](02-hardware.md#cablaggio-uart) descrive i collegamenti e mostra il foro. Non è disponibile una foto ravvicinata delle saldature.

Per ottenere il controllo locale **non devi ripetere l'analisi MITM, il dump del modulo o le prove delle API originali**: sono documentati negli approfondimenti. Se scegli Wi-Fi, il [passo 02A](02-wifi.md) include pairing e isolamento; se scegli UART, il [passo 08](08-servizi-automatici.md#disabilitare-la-wi-fi-allavvio-della-serra) spiega come tenere spenta la radio. Le altre modifiche storiche di token e aggiornamenti restano [approfondimenti facoltativi](../approfondimenti/configurazione-serra.md).

> [!WARNING] Servizio originale da verificare
> Nel prototipo, `robocontrol/rcc` era già fermo durante i test dei comandi. I file attuali confermano che il suo avvio automatico è disattivato. **Non è verificato** che il controller e il servizio originale possano comandare contemporaneamente gli stessi componenti. Il [passo 06](06-controller-cli.md#verifica-del-servizio-originale) spiega come controllare, disattivare e ripristinare il servizio prima di azionare luci, ventole o pompe. La sequenza è stata ricostruita sul prototipo, ma non ancora provata da zero su una seconda serra.

---

## Vincoli di sicurezza e modifiche alla serra

Il percorso essenziale **non sostituisce il firmware** né richiede il dump del filesystem. Il percorso UART apre e modifica fisicamente la serra; il percorso Wi-Fi modifica la sua configurazione di rete. Entrambi richiedono di gestire la password root: valuta prima i rischi e conserva le informazioni necessarie per un eventuale ripristino.

Vincoli/assunzioni:

- La password root viene verificata o impostata nel passo 05 perché il controller la richiede su entrambi i canali.
- Con UART, il [passo 08](08-servizi-automatici.md#disabilitare-la-wi-fi-allavvio-della-serra) spiega come impedire l'avvio della radio. Con Wi-Fi, lo script di rete deve invece avviarsi e l'isolamento senza gateway va verificato dopo il boot; il timer `serra-netoff` deve restare disabilitato.
- Sul prototipo è ancora impostato il token fittizio `offline-token`, ma non è una protezione di rete: non sostituisce lo spegnimento radio nel percorso UART né l'isolamento nel percorso Wi-Fi.
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
> **Verifica prima di proseguire:** Hai scelto Wi-Fi o UART e compreso il ruolo di serra, Raspberry, MQTT e Home Assistant.

<table width="100%" class="step-nav">
  <tr>
    <td width="50%" align="left"><strong>Passo precedente</strong><br><a href="../index.md">← Indice completo</a></td>
    <td width="50%" align="right"><strong>Scegli il passo 02</strong><br><a href="02-wifi.md">02A · Wi-Fi →</a><br><a href="02-hardware.md">02B · UART →</a></td>
  </tr>
</table>
