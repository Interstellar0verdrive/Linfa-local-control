# 09 · Collegare Home Assistant

**Percorso guidato:** [Indice dei capitoli](../index.md)

> [!NOTE] Nota
> Home Assistant comunica con il broker MQTT, non direttamente con la serra. Il Raspberry traduce i comandi MQTT in comandi UART.

---

Il broker MQTT e le sue credenziali sono stati predisposti nel [passo 07](07-bridge-mqtt.md).

Per le future automazioni delle ventole, Home Assistant deve conoscere temperatura e umidità **dentro la serra** tramite un sensore ambientale già integrato in HA. Il prototipo usa un sensore Aqara Zigbee collocato nella serra: questi valori non arrivano dal VoCore né dai topic pubblicati dal controller.

Le misure di temperatura e umidità della stanza (o le medie dei sensori di casa) permettono anche di evitare la ventilazione quando lo scambio d'aria non aiuterebbe a raffreddare o deumidificare. L'app in preparazione renderà selezionabili queste quattro entità nelle proprie Impostazioni. Per la sola prova MQTT di questo capitolo non serve aggiungere sensori.

La [fotocamera interna](../approfondimenti/fotocamera.md) è facoltativa: la pipeline sul Raspberry scatta e trasferisce il JPEG via UART, mantenendo spenta la Wi-Fi della serra. Installa e prova prima lo script fotografico se vuoi usare pulsante e automazione foto nell'app Home Assistant.

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

**Topic base:** `serra/`.

### Stato (publish dal Raspberry → HA)

I topic di stato pubblicati dal Raspberry sono:

- `serra/status/online`, `serra/status/last_seen`, `serra/status/last`
- `serra/state/lights`, `serra/state/ring`, `serra/state/net`
- `serra/state/fans/fan-1`, `serra/state/fans/fan-2`, `serra/state/fans/fan-F`
- `serra/state/pumps/main`, `serra/state/pumps/nutrient-0`, `serra/state/pumps/nutrient-1`, `serra/state/pumps/nutrient-2`

Il controller e il bridge pubblicano questi topic con il flag **retain**. I contenuti sono gli ultimi stati **logici** noti, non telemetria hardware: dopo un riavvio della sola serra potrebbero essere superati finché non invii nuovi comandi o verifichi i componenti.

---

### Comandi (publish da HA → Raspberry)

> [!TIP] Vuoi provare altri comandi?
> Nel [riferimento comandi](../riferimento-comandi.md) trovi l'elenco completo, esempi con parametri diversi e la sintassi da usare sul Raspberry o in un client MQTT. Per usare la futura app Linfa in Home Assistant non dovrai digitare questi comandi.

Pubblica su `serra/cmd` oppure su `serra/cmd/<id>` se vuoi ricevere un riscontro associato a un ID.

Per una prima prova con le ventole, usa il payload `fans on`. Per spegnerle con un ID di riscontro, pubblica `fans off` sul topic `serra/cmd/abc123`.

### Prova con MQTT Explorer

Per vedere i topic organizzati e pubblicare comandi di prova, consigliamo **MQTT Explorer**. Se usi **Home Assistant OS**, puoi installare l'[app comunitaria MQTT Explorer](https://github.com/GollumDom/addon-repository): vai in **Impostazioni → App → Installa app**, aggiungi il repository dal menu **⋮ → Repository**, poi installa e avvia MQTT Explorer. È uno strumento facoltativo, separato dall'integrazione MQTT e dall'app Linfa in preparazione.

Puoi usare anche [MQTT Explorer per Windows, macOS o Linux](https://mqtt-explorer.com/) su un computer della stessa rete: collegalo allo **stesso broker** con credenziali MQTT valide. Il computer non deve entrare in Home Assistant; deve poter raggiungere il broker. Se usi l'app Mosquitto di Home Assistant, indica l'indirizzo di rete di Home Assistant, non il nome interno `core-mosquitto.local.hass.io`.

Nella sezione **Publish** di MQTT Explorer imposta:

| Campo | Valore di prova |
| --- | --- |
| Topic | `serra/cmd` |
| Formato payload | **raw** (testo semplice) |
| Payload | `fans on` |
| Retain | **Disattivato** |

Pubblica e verifica che le ventole si avviino e che compaiano messaggi su `serra/status/last` e `serra/state/fans/*`. Poi pubblica `fans off` sullo stesso topic, sempre senza retain. La [schermata e gli esempi](../riferimento-comandi.md#dove-fare-le-prove-mqtt) mostrano dove leggere i messaggi e come evitare di inviare un comando testuale in modalità JSON.

### Alternativa: usare gli strumenti MQTT integrati

Nell'integrazione MQTT di Home Assistant, apri **Impostazioni → Dispositivi e servizi → MQTT → Configura**. Nella sezione **Ascolta un topic**, inserisci `serra/#` e avvia l'ascolto. Dovresti vedere i topic di stato pubblicati dal Raspberry; se non arrivano subito, puoi eseguire `serra state sync` sul Raspberry per pubblicarli di nuovo.

Nella sezione **Pubblica un pacchetto** inserisci:

| Campo | Valore di prova |
| --- | --- |
| Topic | `serra/cmd` |
| Payload | `fans on` |
| Retain | **Disattivato**: un comando non deve essere ripetuto dal broker a una futura riconnessione. |

Pubblica il comando e verifica che le ventole si avviino e che compaiano messaggi su `serra/status/last` e `serra/state/fans/*`. Poi invia `fans off` allo stesso topic, sempre senza retain. La procedura di ascolto e pubblicazione è descritta anche nella [guida ufficiale MQTT](https://www.home-assistant.io/integrations/mqtt/#testing-your-setup).

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
5. Home Assistant riceve lo stato logico pubblicato, se il collegamento MQTT è operativo

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
