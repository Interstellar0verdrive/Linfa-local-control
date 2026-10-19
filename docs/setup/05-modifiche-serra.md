# 05 · Configurare la serra per l'uso locale

**Percorso guidato:** [Indice dei capitoli](../index.md)

In origine la serra ha uno **user-token** e un **UUID** come questi:

```bash
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
# Usare la password: <DEVICE_PASSWORD>
```

> [!WARNING]
> La procedura cambia anche lo `user-token` della serra, sostituendolo con `offline-token`. Conserva il token originale in modo sicuro se vuoi poter ripristinare la configurazione precedente.

Per ripristinare allo stato precedente, dovrebbe bastare rimuovere: `/opt/data/token` `/opt/data/SSID` `/opt/data/pwd`
Questo dovrebbe funzionare:

```bash
rm -f /opt/data/token /opt/data/SSID /opt/data/pwd
sync
reboot
```

Questo di solito forza di nuovo la modalità “setup” (AP).

## cambiare il token della serra

Con questo comando si deve vedere il token in uso.
Ricorda: Al punto precedente abbiamo già cambiato il token, impostandolo su `offline-token`.

```bash
hexdump -C /opt/data/token

# Deve restituire qualcosa tipo:
# 6f 66 66 6c 69 6e 65 2d  74 6f 6b 65 6e           |offline-token|
# 0000000d
```

Il token originale della serra era:

```bash
user-token: <ORIGINAL_DEVICE_TOKEN>
UUID della serra: <DEVICE_UUID>
```

Per sovrascrivere il token con quello finto, si può usare questo codice:

```bash
# Sostituisci con il token finto:
TOKEN="offline-token"

# scrivi il token:
printf "%s" "$TOKEN" > /opt/data/token
chmod 600 /opt/data/token
sync

# verifica hexdump:
hexdump -C /opt/data/token

# Deve restituire qualcosa tipo:
# 6f 66 66 6c 69 6e 65 2d  74 6f 6b 65 6e           |offline-token|
# 0000000d
```

**Nota sui nomi:** `user-token` nella URL e `usr-token` nei CGI sono parametri diversi. Per `/opt/data/token` conta il valore del token, non il nome del parametro.

Per ripristinare il token originale:

```bash
printf '%s' '<ORIGINAL_DEVICE_TOKEN>' > /opt/data/token
chmod 600 /opt/data/token
sync
```

## Bloccare gli aggiornamenti automatici

Rendere /var/update non scrivibile (così anche se la serra se provasse a scaricare qualcosa, fallisce).

Da SSH:

```bash
# crea se manca:
mkdir -p /var/update

# togli permessi di scrittura:
chmod 555 /var/update

# opzionale: crea file “sentinella” non scrivibile
# (se qualche processo prova a sovrascrivere, fallisce)
touch /var/update/rccupdate.tar.gz /var/update/rccupdate.tar.gz.md5 2>/dev/null
chmod 444 /var/update/rccupdate.tar.gz /var/update/rccupdate.tar.gz.md5 2>/dev/null

# Controlla che abbia funzionato:
ls -la /var/update

# Deve restituire qualcosa tipo:
# total 0
# dr-xr-xr-x    2 root     root           160 May 17  2023 .
# drwxr-xr-x    7 root     root           864 May 17  2023 ..

# Questo indica che /var/update ha permessi effettivi 555 (r-xr-xr-x)
# dr-xr-xr-x = directory (d) con:
	  #	owner: r-x (5)
	  #	group: r-x (5)
	  #	others: r-x (5)
```

Per ripristinare allo stato originale: `chmod 755 /var/update`

---

## Continua il percorso

> [!TIP]
> **Verifica prima di proseguire:** Hai verificato le modifiche che hai scelto di applicare alla serra.

| Passo precedente | Passo successivo |
| :--- | ---: |
| [← 04 · Impostare la password root](04-password-root.md) | [06 · Verificare la rete →](06-rete.md) |
