# Linfa Local Control

Controllo locale sperimentale per serre **Robonica Linfa** tramite Raspberry Pi, UART, MQTT e Home Assistant, senza dipendere dal cloud per il normale funzionamento. La procedura è stata provata su **Linfa Weezy**; la compatibilità con la Linfa standard è plausibile, ma non ancora verificata.

> [!WARNING]
> **Progetto indipendente e non ufficiale.** Questo repository non è affiliato, approvato, sponsorizzato o supportato da Robonica S.r.l. I nomi Linfa e Weezy identificano soltanto i dispositivi a cui si riferisce la guida.
>
> Le procedure richiedono l'apertura del dispositivo, il collegamento a una console seriale e modifiche alla sua configurazione. Possono causare malfunzionamenti e **potrebbero far decadere la garanzia commerciale**. Verifica le condizioni applicabili prima di intervenire. I diritti previsti dalla garanzia legale sono distinti dalla garanzia commerciale.

## Stato del progetto

- **Disponibile ora:** guida di preparazione hardware, controller CLI per Raspberry Pi e bridge MQTT.
- **In programma:** applicazione e interfaccia complete per Home Assistant, nella stessa repository.
- **Dispositivi:** Linfa Weezy provata; Linfa standard non ancora verificata.
- **Stato degli stati MQTT:** rappresentano principalmente l'ultimo stato logico noto, non una telemetria hardware sempre affidabile.

## Documentazione

Segui la [guida passo per passo su GitHub Pages](https://interstellar0verdrive.github.io/Linfa-local-control/): undici capitoli numerati, dal funzionamento del sistema al collegamento con Home Assistant. Ogni capitolo indica cosa verificare e rimanda al successivo. Le analisi facoltative sono raccolte negli approfondimenti.

La documentazione segue automaticamente il tema chiaro o scuro del sistema; puoi anche scegliere manualmente dal menu in alto. I file Markdown in [`docs/`](docs/) restano le sorgenti modificabili della guida.

## Codice incluso

La cartella [`bridge/`](bridge/) contiene il controller seriale, il bridge MQTT e un [file di configurazione di esempio](bridge/serra-mqtt.env.example). Sono script sperimentali da configurare sul proprio Raspberry Pi; non includono credenziali personali. Gli esempi con `<...>` sono segnaposto da sostituire prima dell'esecuzione.

## Sicurezza

Non inserire password Wi-Fi, credenziali MQTT, token originali del dispositivo, dump di rete o file `.env` nella repository o nelle issue. La guida pubblica usa valori di esempio. Se una credenziale è già comparsa nella pagina Notion condivisa pubblicamente, cambiala: rimuoverla dalla pagina non basta a renderla nuovamente segreta.

## Licenza

La licenza del progetto è ancora da scegliere. Fino all'aggiunta di un file `LICENSE`, la presenza del codice su GitHub non concede automaticamente il diritto di riutilizzarlo o distribuirlo.
