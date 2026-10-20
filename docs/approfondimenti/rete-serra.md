# Rete della serra durante il setup

Questa pagina conserva la configurazione di rete usata durante le prove originali. **Non devi collegare la serra alla Wi-Fi domestica** per seguire il [percorso essenziale](../index.md): è il Raspberry a comunicare in rete con MQTT e Home Assistant, mentre la serra è controllata via UART.

Questa sezione fotografa la situazione **se scegli di configurare la Wi-Fi della serra**, con il collegamento UART già verificato, ma prima di attivare il controllo automatico.

Serve come riferimento rapido per:

- capire chi è collegato a cosa
- sapere come accedere ai dispositivi
- avere chiari gli indirizzi IP coinvolti

---

## Serra – rete quando collegata alla Wi-Fi di casa

Dopo la configurazione iniziale (via API locali), la serra può collegarsi alla Wi-Fi domestica.

Caratteristiche:

- **IP della serra**: cercalo nell'elenco dei dispositivi connessi al router, se hai configurato la sua Wi-Fi
- **Utente SSH**: root
- **Password root**: `<DEVICE_PASSWORD>` *(modificata manualmente)*

Accesso SSH (quando la rete NON è ancora disabilitata):

```bash
ssh root@<SERRA_IP>
```

Sostituisci `<SERRA_IP>` con l'indirizzo trovato nel router e inserisci la password root della serra quando richiesta.

> [!WARNING] Attenzione
> L'accesso SSH alla serra via Wi-Fi serve solo per configurazione e verifica. Nel funzionamento normale il Raspberry spegne la rete della serra: prima di attivare il timer del passo 07, assicurati che la UART funzioni.

---

## Raspberry Pi – rete e accesso

Il Raspberry Pi funge da **controller esterno** della serra.

Configurazione tipica:

- **Hostname**: serra
- **Sistema operativo**: Raspberry Pi OS / Debian-based
- **Utente**: pi
- **Accesso**: SSH

Il Raspberry può collegarsi alla rete via **Ethernet** o **Wi-Fi**. Per trovare l'indirizzo dell'interfaccia in uso, esegui sul Raspberry:

```bash
ip -br -4 address show
```

Per esempio, una risposta *fittizia* potrebbe essere:

```text {.expected-output}
eth0   UP     192.168.1.42/24
wlan0  DOWN
```

Qui l'indirizzo da usare è `192.168.1.42`, senza `/24`. Sul tuo Raspberry potrebbe essere diverso; anche i nomi delle interfacce possono cambiare. Se vuoi che l'indirizzo resti costante, configura una **prenotazione DHCP** nel router per l'interfaccia che usi. Trovi il suo MAC nella pagina del dispositivo sul router oppure con `ip -br link show` sul Raspberry. Ethernet e Wi-Fi hanno indirizzi MAC distinti.

Collegati via SSH usando l'indirizzo effettivo del Raspberry:

```bash
ssh pi@<RASPBERRY_IP>
```

Sostituisci `<RASPBERRY_IP>` con l'indirizzo trovato sopra. Se il nome locale è configurato, puoi usare `ssh pi@serra.local`. Inserisci la password dell'utente del Raspberry quando richiesta.

Il Raspberry **rimane sempre connesso** alla rete di casa ed è l’unico punto di controllo permanente.

---

## Wi-Fi domestica e segreti

La serra e il Raspberry condividono la stessa rete locale **solo in fase di setup**.

Parametri (da trattare come segreti):

- **SSID Wi-Fi**: `<WIFI_SSID>`
- **Sicurezza**: WPA2-PSK
- **Password Wi-Fi**: `<WIFI_PASSWORD>`

---

## Stato di questo scenario facoltativo

A questo punto:

- ✅ Raspberry operativo e raggiungibile via SSH
- ✅ Serra configurata sulla Wi-Fi di casa
- ✅ Collegamento UART attivo
- ❌ Nessuna policy di rete applicata automaticamente
- ❌ Nessun controllo attivo da Home Assistant

---

[Torna all’indice della guida](../index.md).
