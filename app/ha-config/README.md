# Configurazione Home Assistant

Questi file sono stati preparati per una **nuova installazione** di Linfa Local Control. Non sono ancora stati provati su un Home Assistant pulito. Se usi già la serra in Home Assistant, salva i file esistenti e confrontali prima di sostituirli.

| File | Destinazione prevista | Funzione |
| --- | --- | --- |
| `serra_mqtt.yaml` | `/config/packages/linfa_local_control.yaml` | Entità MQTT, impostazioni, script e automazioni |
| `serra_piano_parse.py` | `/config/serra_piano_parse.py` | Legge e valida il piano |
| `serra_piano.yaml` | `/config/serra_piano.yaml` | Piano completo attualmente usato dall'autore, con fasi, luci, ricircoli, eventi e nutrienti |
| `serra_piano.example.yaml` | Alternativa facoltativa al piano completo | Esempio inerte per prove iniziali |

Il piano completo è quello attualmente usato nell'installazione dell'autore. È stato derivato dai cicli documentati con la serra e adattato: **non è una copia integrale di un piano pubblicato da Robonica**. Un solo file contiene entrambe le varianti, autofiorente e fotoperiodica; nell'app si sceglie la varietà in **Impostazioni → Coltivazione**, dove si regolano anche le ore di luce disponibili per la variante autofiorente. Le durate e gli eventi specifici della fotoperiodica sono indicati nel file con `giorni_foto` e `giorno_foto`.

L'add-on usa inoltre il bridge MQTT sul Raspberry e un broker MQTT già collegato a Home Assistant. Il package da solo non installa questi componenti.

## Regole per l'installazione

1. Verificare che `configuration.yaml` carichi i package dalla cartella scelta. Per la destinazione qui indicata serve `homeassistant: packages: !include_dir_named packages`; se la propria configurazione usa già i package, seguire la struttura esistente senza aggiungere una seconda chiave `homeassistant`.
2. Copiare package, parser e piano completo solo se le destinazioni non esistono. **Non sovrascrivere** un piano o un package già presenti: possono contenere dati e modifiche dell'utente. Gli aggiornamenti dell'add-on non aggiornano automaticamente questi file. Per una prova senza azioni programmate, si può usare una copia di `serra_piano.example.yaml` al posto del piano completo.
3. Controllare la configurazione YAML con la funzione di verifica di Home Assistant prima di riavviare. Dopo il riavvio, verificare che sensori e helper `serra_*` siano stati creati prima di attivare la coltivazione.
4. Nell'app, scegliere i sensori di temperatura e umidità interni. Quelli della stanza sono facoltativi. Senza un sensore interno valido, il controllo automatico del clima non può basarsi su una misura affidabile.
5. Impostare esplicitamente le due tarature climatiche a `0` prima di abilitarle. Il toggle `Serra Taratura Clima Attiva` parte spento su una nuova installazione: attivarlo solo dopo aver confrontato i propri sensori. I valori impostati vengono poi ripristinati ai riavvii.
6. Impostare orari e soglie iniziali secondo il proprio impianto. **Il piano completo programma luci e ricircoli e contiene dosi di nutrienti**: leggerlo e verificare vasca, pompe, sensori, fertilizzanti e coltura prima di attivare gli automatismi. Il piano di esempio non programma luci, ricircoli o dosi e serve solo come alternativa prudente per le prime prove.

L'interruttore `Serra Wi-Fi` è un comando, non un sensore della radio. **Non spegnerlo se il Wi-Fi è l'unico canale disponibile verso la serra.** Sul percorso USB può essere usato per accendere temporaneamente la radio. La sua posizione viene ripristinata al riavvio di Home Assistant e può divergere dallo stato reale dopo il riavvio della sola serra.

## Notifiche

Le notifiche persistenti di Home Assistant funzionano senza un telefono configurato. Per ricevere anche le notifiche mobili, inserire nell'helper `Serra Notifica Servizio Mobile` il nome dell'azione della propria app Companion, per esempio `notify.mobile_app_mio_telefono`, poi attivare `Serra Notifiche push`. Il package non contiene un destinatario personale. L'URL aperto toccando una notifica è facoltativo e si imposta nell'helper `Serra Notifica URL`.

## Verifica locale dei file

Con Python e PyYAML disponibili, eseguire `python validate_release.py` da questa cartella. Il controllo verifica la struttura YAML, alcune invarianti di sicurezza e che il parser accetti entrambi i piani. **Non sostituisce** la verifica della configurazione in Home Assistant né una prova con la serra.

## Stato del candidato

- Manca una prova su Home Assistant pulito, inclusi script, automazioni, UI e flusso di aggiornamento.
- La migrazione da un'app locale precedente alla nuova `linfa_local_control` richiede un collaudo separato. Due app non devono comandare contemporaneamente la stessa serra.
