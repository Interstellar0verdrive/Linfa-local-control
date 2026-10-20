# 09 · Collegare Home Assistant

**Percorso guidato:** [Indice dei capitoli](../index.md)

> [!NOTE] Nota
> Home Assistant comunica con il broker MQTT, non direttamente con la serra. Il Raspberry traduce i comandi MQTT in comandi UART.

---

Il broker MQTT e le sue credenziali sono stati predisposti nel [passo 07](07-bridge-mqtt.md).

---

## Anteprima dell'app in test

Questa è la vista **Coltivazione** dell'app completa per Home Assistant. L'app è pronta e in fase di test, ma non è ancora pubblicata nella repository; i passi di questo capitolo servono per verificare il collegamento MQTT prima del rilascio.

<figure class="ha-preview">
  <a href="../../assets/home-assistant-coltivazione-preview.webp"><img src="../../assets/home-assistant-coltivazione-preview.webp" alt="Anteprima della vista Coltivazione: fasi di crescita, timeline e attività del giorno"></a>
  <figcaption>Schermata della versione in test. Apri l'immagine per vederla a piena risoluzione; l'interfaccia potrà cambiare prima del rilascio.</figcaption>
</figure>

---

## Integrazione MQTT in Home Assistant

### Aggiungere l’integrazione MQTT

In Home Assistant:

1. **Settings → Devices & Services**
2. **Add Integration**
3. Cerca **MQTT**
4. Se la configurazione non è automatica, inserisci:
    - Broker
    - Porta
    - Username
    - Password

Se la connessione va a buon fine:

- l’integrazione MQTT risulta connessa al broker
- Home Assistant è pronto a leggere/pubblicare topic

Per i nomi aggiornati dei menu e la configurazione del broker, consulta la [documentazione ufficiale MQTT di Home Assistant](https://www.home-assistant.io/integrations/mqtt/).

---

### Topic usati dal sistema serra

**Topic base:**

```text {.reference-example}
serra/
```

### Stato (publish dal Raspberry → HA)

```text {.reference-example}
serra/status/online
serra/status/last_seen
serra/status/last

serra/state/lights
serra/state/fans/fan-1
serra/state/fans/fan-2
serra/state/fans/fan-F
serra/state/ring
serra/state/pumps/main
serra/state/pumps/nutrient-0
serra/state/pumps/nutrient-1
serra/state/pumps/nutrient-2
serra/state/net
```

Tutti questi topic sono **retained**.

---

### Comandi (publish da HA → Raspberry)

```text {.reference-example}
serra/cmd
serra/cmd/<id>
```

Payload tipico:

```text {.reference-example}
lights on -f 3
```

oppure con ID (per ack):

```text {.reference-example}
topic: serra/cmd/abc123
payload: lights off
```

### Prova senza installare altri strumenti

Nell'integrazione MQTT di Home Assistant, apri **Impostazioni → Dispositivi e servizi → MQTT → Configura**. Nella sezione **Ascolta un topic**, inserisci `serra/#` e avvia l'ascolto. Dovresti vedere i topic di stato pubblicati dal Raspberry; se non arrivano subito, puoi eseguire `serra state sync` sul Raspberry per pubblicarli di nuovo.

Nella sezione **Pubblica un pacchetto** inserisci:

| Campo | Valore di prova |
| --- | --- |
| Topic | `serra/cmd` |
| Payload | `lights on` |
| Retain | **Disattivato**: un comando non deve essere ripetuto dal broker a una futura riconnessione. |

Pubblica il comando e verifica che la luce si accenda e che compaiano messaggi su `serra/status/last` e `serra/state/lights`. Poi invia `lights off` allo stesso topic, sempre senza retain. La procedura di ascolto e pubblicazione è descritta anche nella [guida ufficiale MQTT](https://www.home-assistant.io/integrations/mqtt/#testing-your-setup).

> [!NOTE] Stato dell'integrazione
> Questa prova conferma che Home Assistant può leggere i topic e inviare comandi attraverso MQTT. **Non crea ancora entità, pulsanti o una dashboard dedicata.** L'app completa per Home Assistant è pronta e in fase di test, ma non è ancora stata pubblicata qui.


---

## Flusso end-to-end (riepilogo)

1. Home Assistant pubblica: `serra/cmd`
2. MQTT Bridge sul Raspberry riceve il messaggio
3. Il bridge invoca: `serra ...`
4. Il controller:
    - esegue il comando via UART
    - aggiorna `.serra_state.json`
    - pubblica nuovi stati su MQTT
5. Home Assistant riceve immediatamente lo stato aggiornato

---

## Stato finale del sistema

A questo punto il percorso di base è completo:

- ✅ Home Assistant può ascoltare gli stati e pubblicare comandi MQTT senza passare dal cloud Robonica
- ✅ Il Raspberry traduce i comandi MQTT in istruzioni UART per la serra
- ✅ Gli ultimi stati **logici** noti e gli esiti dei comandi sono osservabili nei topic MQTT
- ℹ️ L'app completa con controlli e dashboard è pronta e in fase di test, ma non è ancora disponibile nella repository

---

## Percorso completato

> [!TIP] Controllo
> **Verifica finale:** Home Assistant riceve gli stati MQTT e puoi inviare un comando di prova.

<table width="100%" class="step-nav">
  <tr>
    <td width="50%" align="left"><strong>Passo precedente</strong><br><a href="08-servizi-automatici.md">← 08 · Attivare i servizi automatici</a></td>
    <td width="50%" align="right"><strong>Passo successivo</strong><br><a href="../index.md">Indice completo →</a></td>
  </tr>
</table>
