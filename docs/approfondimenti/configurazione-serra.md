# Wi-Fi, token e aggiornamenti della serra

Questa pagina conserva le modifiche di configurazione provate durante lo sviluppo. **Non sono richieste** per seguire il [percorso essenziale](../index.md): il controller usa la console UART e il Raspberry comunica con Home Assistant tramite MQTT. Valutale solo se vuoi modificare anche il comportamento di rete e aggiornamento originale della serra.

> [!CAUTION] Modifiche facoltative e persistenti
> Cambiare token, credenziali Wi-Fi o permessi di `/var/update` modifica il comportamento originale della serra. Conserva i valori e i permessi iniziali prima di intervenire; non eseguire questi comandi come parte automatica dell'installazione del controller.

In origine la serra ha uno **user-token** e un **UUID** come questi:

```text {.reference-example}
user-token: <ORIGINAL_DEVICE_TOKEN>
UUID della serra: <DEVICE_UUID>
```

## Cambiare la rete su cui si collega la serra

Dopo connessione del computer ALLA RETE TEMPORANEA creata dalla Serra e collegamento via Terminale alla serra via SSH:

```bash
curl -i -X POST "http://<LOCAL_IP>/credentials" \
-H "Content-Type: application/json" \
-d '{"usr-token":"offline-token","SSID":"<WIFI_SSID>","security":"wpa2psk","password":"<WIFI_PASSWORD>","encryption":"AES"}'
```

- Altre varianti (non usate) di questo codice

    ```bash
    curl -i -X POST "http://<LOCAL_IP>/wifi" \
    -H "Content-Type: application/json" \
    -d '{"SSID":"<WIFI_SSID>","password":"<WIFI_PASSWORD>"}'

    curl -v -X POST http://<LOCAL_IP>/wifi \
    -H "Content-Type: application/json" \
    -d '{
    "ssid": "<WIFI_SSID>",
    "password": "<WIFI_PASSWORD>",
    "security": "wpa2psk",
    "encryption": "AES"
    }'

    curl -v -X POST http://<LOCAL_IP>/wifi \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data "ssid=<WIFI_SSID>&password=<WIFI_PASSWORD>&security=wpa2psk"

    curl -v -X POST http://<LOCAL_IP>/wifi \
    -H "Content-Type: application/json" \
    -d '{
    "ssid": "<WIFI_SSID>",
    "bssid": "<DEVICE_MAC>",
    "password": "<WIFI_PASSWORD>",
    "security": "wpa2psk"
    }'
    ```


Da questo momento in poi, la serra si connetterà alla rete di casa e verrà mappata a questo ip:

Esempio di dati da verificare nel router:

| Dispositivo | Indirizzo MAC | Indirizzo IP |
| :--- | :--- | :--- |
| Linfa Weezy | `<DEVICE_MAC>` | `<LOCAL_IP>` |

Ci si può connettere alla serra così:

```bash
ssh root@<LOCAL_IP>
```

Inserisci la password root della serra quando richiesta.

> [!WARNING] Attenzione
> La procedura cambia anche lo `user-token` della serra, sostituendolo con `offline-token`. Conserva il token originale in modo sicuro se vuoi poter ripristinare la configurazione precedente.

Per ripristinare allo stato precedente, dovrebbe bastare rimuovere: `/opt/data/token` `/opt/data/SSID` `/opt/data/pwd`
Questo dovrebbe funzionare:

```bash
rm -f /opt/data/token /opt/data/SSID /opt/data/pwd
sync
reboot
```

Questo di solito forza di nuovo la modalità “setup” (AP).

## Cambiare il token della serra

Con questo comando si deve vedere il token in uso.
Ricorda: Al punto precedente abbiamo già cambiato il token, impostandolo su `offline-token`.

```bash
hexdump -C /opt/data/token
```

**Risposta attesa:** nella colonna testuale dell'output compare `offline-token` se è questo il valore salvato. Offset e spaziatura del dump dipendono dal comando.

Il token originale della serra era:

```text {.reference-example}
user-token: <ORIGINAL_DEVICE_TOKEN>
UUID della serra: <DEVICE_UUID>
```

Per sovrascrivere il token con quello finto, imposta prima il valore da usare:

```bash
TOKEN="offline-token"
```

Scrivilo nel file e verifica il contenuto:

```bash
printf "%s" "$TOKEN" > /opt/data/token
chmod 600 /opt/data/token
sync
hexdump -C /opt/data/token
```

**Risposta attesa:** `hexdump` mostra `offline-token` nella colonna testuale.

**Nota sui nomi:** `user-token` nella URL e `usr-token` nei CGI sono parametri diversi. Per `/opt/data/token` conta il valore del token, non il nome del parametro.

Per ripristinare il token originale:

```bash
printf '%s' '<ORIGINAL_DEVICE_TOKEN>' > /opt/data/token
chmod 600 /opt/data/token
sync
```

## Bloccare gli aggiornamenti automatici

Rendere /var/update non scrivibile (così anche se la serra se provasse a scaricare qualcosa, fallisce).

Da SSH, crea la directory se manca:

```bash
mkdir -p /var/update
```

Rimuovi i permessi di scrittura:

```bash
chmod 555 /var/update
```

Facoltativamente crea i file “sentinella” e rendili non scrivibili:

```bash
touch /var/update/rccupdate.tar.gz /var/update/rccupdate.tar.gz.md5 2>/dev/null
chmod 444 /var/update/rccupdate.tar.gz /var/update/rccupdate.tar.gz.md5 2>/dev/null
```

Controlla i permessi:

```bash
ls -la /var/update
```

**Risposta attesa:** la riga della directory `.` inizia con `dr-xr-xr-x`: `d` indica una directory e i tre gruppi `r-x` corrispondono ai permessi `555` (proprietario, gruppo e altri). Date e dimensioni variano.

Per ripristinare allo stato originale: `chmod 755 /var/update`

---

[Torna all’indice della guida](../index.md).
