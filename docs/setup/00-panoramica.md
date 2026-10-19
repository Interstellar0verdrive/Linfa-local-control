# 00 · Panoramica e obiettivi

**Percorso guidato:** [Indice dei capitoli](../index.md)

## Cosa stiamo facendo e perché

Questa documentazione descrive un setup per **controllare in locale** la serra Linfa Weezy (Robonica) **senza dipendere dal cloud**.

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

## Vincoli di sicurezza (non modificare firmware/FS VoCore)

Questo setup è progettato con un principio preciso: **non modificare in modo permanente la serra**.

Vincoli/assunzioni:

- Quasi nessun file di sistema del VoCore viene modificato “a mano” come pratica normale (niente patch persistenti, niente sostituzioni in overlay).
Le uniche due modifiche persistenti alla serra sono:
    - Cambio del token (con uno fittizio)
    - Cambio dei permessi sulla cartella “update” per inibire updates che potrebbero rompere questo hack.
- La serra deve poter tornare allo stato originale modificando i pochi files toccati, dopo un reboot senza il Raspberry collegato.
- Le policy come disattivazione Wi-Fi/NTP della serra vengono applicate **dall’esterno**, tramite comandi console e automazioni sul Raspberry.

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

> [!TIP]
> **Verifica prima di proseguire:** Hai compreso il ruolo di serra, Raspberry, UART, MQTT e Home Assistant.

| Passo precedente | Passo successivo |
| :--- | ---: |
| [← Indice completo](../index.md) | [01 · Hardware e collegamenti →](01-hardware.md) |
