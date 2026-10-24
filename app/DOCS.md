# Installare Linfa Local Control in Home Assistant

Questa versione è **sperimentale**. È stata preparata a partire dall'app in uso e verificata staticamente; il collaudo di una nuova installazione Home Assistant è ancora in corso. Non attivare coltivazione, luci, ricircoli o dosatori prima di aver controllato i componenti e le impostazioni della tua serra.

## Prima di iniziare

- Segui la [guida di installazione](https://interstellar0verdrive.github.io/Linfa-local-control/) fino al bridge MQTT sul Raspberry. Il Raspberry deve poter comunicare con la serra via USB o Wi-Fi locale.
- Configura un broker MQTT in Home Assistant e il bridge del Raspberry perché pubblichi gli stati e riceva i comandi.
- Fai un backup di Home Assistant. Se hai già una configurazione della serra, conserva i file originali: la nuova app non deve sovrascriverli.

## I file necessari

L'app usa anche tre file nella cartella di configurazione di Home Assistant. Sono nella [cartella `ha-config`](ha-config/README.md):

| Sorgente | Destinazione in Home Assistant |
| --- | --- |
| [`serra_mqtt.yaml`](ha-config/serra_mqtt.yaml) | `/config/packages/linfa_local_control.yaml` |
| [`serra_piano_parse.py`](ha-config/serra_piano_parse.py) | `/config/serra_piano_parse.py` |
| [`serra_piano.yaml`](ha-config/serra_piano.yaml) | `/config/serra_piano.yaml` |

Il piano distribuito è quello completo del progetto, derivato da cicli svolti con la serra e adattato dall'autore. Comprende fasi, attività giornaliere, luci, ricircoli, dosi, testi e riferimenti alle guide. Non è una copia integrale di un piano pubblicato da Robonica. Un [piano inattivo](ha-config/serra_piano.example.yaml) è disponibile per una prima prova senza azioni programmate.

Home Assistant deve caricare i package. Se non è già configurato, aggiungi in `configuration.yaml`:

```yaml
homeassistant:
  packages: !include_dir_named packages
```

Se `homeassistant:` è già presente, aggiungi `packages:` al suo interno senza creare una seconda chiave. Se la tua installazione usa un'altra struttura per i package, segui quella esistente. **Non installare un secondo package serra** se ne hai già uno: conterrebbe le stesse entità e automazioni. Prima di riavviare usa la verifica della configurazione di Home Assistant.

## Aggiungere l'app

1. In Home Assistant apri **Impostazioni → App → Installa app → Repository** e aggiungi `https://github.com/Interstellar0verdrive/Linfa-local-control`.
2. Installa **Linfa Local Control**. L'avvio automatico è disattivato per questa versione sperimentale.
3. Copia o aggiorna i tre file di configurazione solo dopo aver verificato che le destinazioni non contengano già dati da conservare. Controlla la configurazione e riavvia Home Assistant.
4. Avvia l'app. In **Impostazioni → Coltivazione** scegli autofiorente o fotoperiodica e verifica le ore di luce. Scegli i sensori di temperatura e umidità della serra; quelli della stanza sono facoltativi. Controlla orari, capacità della vasca, calibrazioni e piano prima di abilitare gli automatismi.

Il piano completo **può comandare luci, pompa e dosatori** quando le relative funzioni vengono attivate. Le dosi dei nutrienti non sono universali: verifica i prodotti e le quantità per il tuo impianto. L'interruttore Wi-Fi nell'app non va spento se è l'unico collegamento disponibile verso la serra.

## Se usi già l'app locale

La vecchia installazione locale e quella proveniente da GitHub hanno identificativi diversi e possono essere presenti insieme. **Non usare entrambe per impartire comandi nello stesso momento.** Conserva il package e il piano attuali; non copiarne una seconda versione sopra gli stessi nomi. Installa la nuova app, controlla che legga gli stati e prova un comando reversibile alla volta. Solo dopo il confronto disattiva l'app locale. I file in `/config` restano separati dagli aggiornamenti dell'app e non vengono sovrascritti automaticamente.

## Aggiornamenti

Home Assistant legge le nuove versioni dell'app dalla repository GitHub. Un aggiornamento dell'app **non aggiorna automaticamente** il piano, il parser e il package che hai copiato in `/config`: confronta le modifiche e mantieni le tue personalizzazioni prima di sostituire quei file. Questa separazione evita di perdere piano e impostazioni dell'utente.
