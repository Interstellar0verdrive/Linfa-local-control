Questa guida accompagna la preparazione di una serra Robonica Linfa per il controllo locale con Raspberry Pi, UART, MQTT e Home Assistant. **Per replicare il sistema, segui i capitoli 00–08 nell'ordine:** ogni passo termina con una verifica e il collegamento al successivo.

> [!IMPORTANT] Compatibilità e responsabilità
> La procedura è stata provata su **Linfa Weezy**. La compatibilità con la Linfa standard è da verificare. Il progetto è indipendente da Robonica S.r.l.; [leggi il disclaimer completo](https://github.com/Interstellar0verdrive/Linfa-local-control#linfa-local-control) prima di aprire il dispositivo.

> [!CAUTION] Prima di aprire la serra
> **Stacca la spina della serra e scollega l'adattatore USB → TTL dal Raspberry/computer** prima di toccare la scheda, collegare o scollegare fili, saldare o forare. Tieni i componenti elettrici lontani da acqua, serbatoi, tubi e pompe. La guida presuppone esperienza di base con collegamenti elettrici e saldature; se non sai verificare che l'intervento sia sicuro, fermati e chiedi aiuto a una persona qualificata. Leggi le [precauzioni complete nel passo 00](setup/00-panoramica.md#prima-di-intervenire-sicurezza-elettrica-e-acqua).

## Percorso essenziale: dalla serra a Home Assistant

Il software del controller e del bridge è già nella repository: non devi ripetere l'indagine sul traffico cloud né estrarre il contenuto del VoCore. Devi invece preparare il collegamento fisico, il Raspberry, l'accesso seriale, MQTT e Home Assistant. La [lista dei materiali](setup/00-panoramica.md#cosa-serve-prima-di-iniziare) è nel passo 00.

> [!NOTE] Stato attuale del pacchetto
> Gli script sono disponibili. L'app completa per Home Assistant è pronta e in fase di test, ma **non è ancora pubblicata in questa repository**; manca anche un installer automatico. I passi 05–08 spiegano come configurare manualmente il controller e il bridge sul Raspberry e provarli da Home Assistant.

<div class="chapter-grid" markdown="1">

- **00** [Panoramica e obiettivi](setup/00-panoramica.md)
  Scopri i componenti, il loro ruolo e i limiti del sistema.
- **01** [Hardware e collegamenti](setup/01-hardware.md)
  Identifica il VoCore, prepara Raspberry e adattatore seriale, collega TX/RX/GND.
- **02** [Preparare il Raspberry Pi](setup/02-raspberry.md)
  Installa il sistema, i pacchetti necessari e configura i permessi seriali.
- **03** [Verificare la console UART](setup/03-uart.md)
  Apri la console della serra ed esegui i primi comandi di controllo.
- **04** [Impostare la password root](setup/04-password-root.md)
  Proteggi l'accesso seriale e verifica la password richiesta dal controller.
- **05** [Installare il controller CLI](setup/05-controller-cli.md)
  Installa il controller seriale e prova comandi e sincronizzazione.
- **06** [Configurare il bridge MQTT](setup/06-bridge-mqtt.md)
  Collega Raspberry e broker, poi verifica stati e comandi MQTT.
- **07** [Attivare i servizi automatici](setup/07-servizi-automatici.md)
  Attiva i timer per la policy di rete e la sincronizzazione periodica.
- **08** [Collegare Home Assistant](setup/08-home-assistant.md)
  Integra i topic MQTT e prova il flusso completo.

</div>

## Prima di copiare i comandi

I valori tra parentesi angolari, come `<LOCAL_IP>` e `<WIFI_PASSWORD>`, sono segnaposto. Sostituiscili con i valori del tuo impianto e conserva le credenziali solo sui dispositivi che le usano. Alcuni comandi modificano la configurazione della serra: leggi il capitolo per intero prima di eseguirli.

## Approfondimenti facoltativi

Questi contenuti documentano scelte facoltative e l'indagine tecnica originale. Non servono per completare il percorso essenziale:

- [Wi-Fi, token e aggiornamenti della serra](approfondimenti/configurazione-serra.md)
- [Rete della serra durante il setup](approfondimenti/rete-serra.md)
- [Analisi del traffico cloud](approfondimenti/traffico-cloud.md)
- [Accesso e dump del modulo](approfondimenti/accesso-e-dump.md)
