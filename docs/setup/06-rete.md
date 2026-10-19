# 06 · Verificare la rete

**Percorso guidato:** [Indice dei capitoli](../index.md)

Questa sezione fotografa la situazione **una volta completata la configurazione di rete**, con il collegamento UART già verificato, ma prima di attivare il controllo automatico.

Serve come riferimento rapido per:

- capire chi è collegato a cosa
- sapere come accedere ai dispositivi
- avere chiari gli indirizzi IP coinvolti

---

## Serra – rete quando collegata alla Wi-Fi di casa

Dopo la configurazione iniziale (via API locali), la serra può collegarsi alla Wi-Fi domestica.

Caratteristiche:

- **IP assegnato dal router** (assegnato dal router via MAC address): `<LOCAL_IP>`
- MAC address: `<DEVICE_MAC>` (wifi)
- **Utente SSH**: root
- **Password root**: `<DEVICE_PASSWORD>` *(modificata manualmente)*

Accesso SSH (quando la rete NON è ancora disabilitata):

```bash
ssh root@<LOCAL_IP>
# Password: <DEVICE_PASSWORD>
```

⚠️ **Nota importante**

Questo accesso è considerato **temporaneo e non sicuro**:

- viene usato solo per configurazione e verifica
- in esercizio normale la rete della serra viene **spenta dal Raspberry**

---

## Raspberry Pi – rete e accesso

Il Raspberry Pi funge da **controller esterno** della serra.

Configurazione tipica:

- **Hostname**: serra
- **Sistema operativo**: Raspberry Pi OS / Debian-based
- **Utente**: pi
- **Accesso**: SSH

Interfacce di rete:

- **Ethernet**
    - IP statico (assegnato dal router via MAC address): <LOCAL_IP>
    - MAC address: <DEVICE_MAC>
- **Wi-Fi**
    - IP statico (assegnato dal router via MAC address): <LOCAL_IP>
    - MAC address: <DEVICE_MAC>

Accesso SSH possibili:

```bash
ssh pi@<LOCAL_IP>    # se ethernet
ssh pi@<LOCAL_IP>    # se wifi
ssh pi@serra.local      # se via mDNS

# Password: <DEVICE_PASSWORD>
```

Il Raspberry **rimane sempre connesso** alla rete di casa ed è l’unico punto di controllo permanente.

---

## Wi-Fi domestica e segreti

La serra e il Raspberry condividono la stessa rete locale **solo in fase di setup**.

Parametri (da trattare come segreti):

- **SSID Wi-Fi**: `<WIFI_SSID>`
- **Sicurezza**: WPA2-PSK
- **Password Wi-Fi**: `<WIFI_PASSWORD>`

---

## Stato finale prima del passo successivo

A questo punto:

- ✅ Raspberry operativo e raggiungibile via SSH
- ✅ Serra configurata sulla Wi-Fi di casa
- ✅ Collegamento UART attivo
- ❌ Nessuna policy di rete applicata automaticamente
- ❌ Nessun controllo attivo da Home Assistant

---

## Continua il percorso

**Prima di proseguire:** Conosci gli indirizzi della serra e del Raspberry e hai verificato il collegamento UART. Il broker MQTT sarà predisposto nel passo 08.

[Passo 07 · Installare e provare il controller CLI →](07-controller-cli.md)

[← Passo 05 · Configurare la serra per l'uso locale](05-modifiche-serra.md) · [Indice completo](../index.md)
