# Rete della serra durante il setup

Questa pagina conserva i riferimenti di rete usati nelle prove. Nel [percorso UART](../setup/02-hardware.md) la serra può restare senza Wi-Fi; nel [percorso Wi-Fi](../setup/02-wifi.md) resta sulla LAN domestica, isolata da Internet. In entrambi i casi il Raspberry comunica con MQTT e Home Assistant.

Gli indirizzi qui sotto sono esempi: usa sempre quelli assegnati alla tua rete.

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

Accesso SSH (quando il Wi-Fi della serra è attivo):

```bash {.terminal-computer}
ssh root@<SERRA_IP>
```

Sostituisci `<SERRA_IP>` con l'indirizzo trovato nel router e inserisci la password root della serra quando richiesta.

> [!WARNING] Attenzione
> Se scegli UART con radio spenta, prima di disabilitare il Wi-Fi e attivare il timer del passo 08 verifica che la UART funzioni. Se scegli Wi-Fi, **non attivare** quel timer: interromperebbe il controllo via SSH.

---

## Raspberry Pi – rete e accesso

Il Raspberry Pi funge da **controller esterno** della serra.

Configurazione tipica:

- **Hostname**: serra
- **Sistema operativo**: Raspberry Pi OS / Debian-based
- **Utente**: pi
- **Accesso**: SSH

Il Raspberry può collegarsi alla rete via **Ethernet** o **Wi-Fi**. Per trovare l'indirizzo dell'interfaccia in uso, esegui sul Raspberry:

```bash {.terminal-raspberry}
ip -br -4 address show
```

**Risposta attesa:** per esempio, in uno scenario *fittizio*, l'interfaccia `eth0` potrebbe risultare `UP` con indirizzo `192.168.1.42/24`, mentre `wlan0` potrebbe risultare `DOWN`.

Qui l'indirizzo da usare è `192.168.1.42`, senza `/24`. Sul tuo Raspberry potrebbe essere diverso; anche i nomi delle interfacce possono cambiare. Se vuoi che l'indirizzo resti costante, configura una **prenotazione DHCP** nel router per l'interfaccia che usi. Trovi il suo MAC nella pagina del dispositivo sul router oppure con `ip -br link show` sul Raspberry. Ethernet e Wi-Fi hanno indirizzi MAC distinti.

Collegati via SSH usando l'indirizzo effettivo del Raspberry:

```bash {.terminal-computer}
ssh pi@<RASPBERRY_IP>
```

Sostituisci `<RASPBERRY_IP>` con l'indirizzo trovato sopra. Se il nome locale è configurato, puoi usare `ssh pi@serra.local`. Inserisci la password dell'utente del Raspberry quando richiesta.

Il Raspberry deve rimanere connesso alla rete di casa durante il funzionamento; è il punto di controllo locale tramite MQTT. Sul prototipo lo script Wi-Fi del VoCore era stato rinominato `OFF_S45net` durante il funzionamento solo UART; per le prove Wi-Fi è tornato `S45net` con il gateway DHCP escluso. Il [passo 08](../setup/08-servizi-automatici.md) spiega le due policy. Il timer `serra-netoff` invia `net off` una sola volta dopo l'avvio del Raspberry e serve soltanto a chi usa UART con radio spenta.

---

## Wi-Fi domestica e segreti

La serra e il Raspberry condividono la stessa rete locale durante il setup **e durante l'uso se scegli Wi-Fi**. Nel percorso UART la radio della serra può restare spenta.

Parametri (da trattare come segreti):

- **SSID Wi-Fi**: `<WIFI_SSID>`
- **Sicurezza**: WPA2-PSK
- **Password Wi-Fi**: `<WIFI_PASSWORD>`

---

## Verifiche prima del controllo automatico

- Raspberry operativo e raggiungibile dalla rete domestica.
- Per Wi-Fi: serra raggiungibile via SSH, LAN funzionante, nessuna rotta Internet anche dopo il riavvio, timer `serra-netoff` disabilitato.
- Per UART: collegamento seriale verificato; se vuoi la radio spenta, script di avvio Wi-Fi disabilitato e stato controllato dopo il riavvio.
- In entrambi i casi: il controller e Home Assistant vanno configurati nei passi 06–09.

---

[Torna all’indice della guida](../index.md).
