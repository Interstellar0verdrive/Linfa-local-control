# 10 · Collegare Home Assistant

**Percorso guidato:** [Indice dei capitoli](../index.md)

> [!NOTE]
> Home Assistant comunica con il broker MQTT, non direttamente con la serra. Il Raspberry traduce i comandi MQTT in comandi UART.

---

Il broker MQTT e le sue credenziali sono stati predisposti nel [passo 08](08-bridge-mqtt.md).

---

## Integrazione MQTT in Home Assistant

### Aggiungere l’integrazione MQTT

In Home Assistant:

1. **Settings → Devices & Services**
2. **Add Integration**
3. Cerca **MQTT**
4. Inserisci:
    - Broker
    - Porta
    - Username
    - Password

Se la connessione va a buon fine:

- l’integrazione MQTT risulta **Loaded**
- Home Assistant è pronto a leggere/pubblicare topic

---

### Topic usati dal sistema serra

**Topic base:**

```
serra/
```

### Stato (publish dal Raspberry → HA)

```
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

```
serra/cmd
serra/cmd/<id>
```

Payload tipico:

```
lights on -f 3
```

oppure con ID (per ack):

```
topic: serra/cmd/abc123
payload: lights off
```

Per fare un test procedere come segue:

1. Installare MQTT Explorer dentro Home Assistant, seguendo la guida qui:
[https://community.home-assistant.io/t/addon-mqtt-explorer-new-version/603739](https://community.home-assistant.io/t/addon-mqtt-explorer-new-version/603739)
2. Aprire MQTT Explorer con questi parametri:

    ```
    Name: <MQTT_USER>
    Validate certificate: Yes
    Encryption (tls): no
    Protocol: mqtt://
    Host: [core-mosquitto.local.hass.io](http://core-mosquitto.local.hass.io/)
    Port: 1883
    Username: <MQTT_USER>
    Password: <DEVICE_PASSWORD>
    ```

3. Sulla destra (riquadro Publish) usare come Topic `serra/cmd` e provare un comando, ad esempio `lights on`

![MQTT Explorer con i topic della serra](../assets/mqtt-explorer.png)


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

A questo punto il sistema è completo:

- ✅ Home Assistant non dipende dal cloud
- ✅ Nessun accesso diretto alla serra
- ✅ Raspberry = unico punto di controllo
- ✅ Stati consistenti e osservabili
- ✅ Comandi tracciabili via MQTT
- ✅ Setup replicabile da zero seguendo la guida

---

## Percorso completato

> [!TIP]
> **Verifica finale:** Home Assistant riceve gli stati MQTT e puoi inviare un comando di prova.

<table width="100%" class="step-nav">
  <tr>
    <td width="50%" align="left"><strong>Passo precedente</strong><br><a href="09-servizi-automatici.md">← 09 · Attivare i servizi automatici</a></td>
    <td width="50%" align="right"><strong>Passo successivo</strong><br><a href="../index.md">Indice completo →</a></td>
  </tr>
</table>
