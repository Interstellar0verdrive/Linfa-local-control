Questa guida accompagna la preparazione di una serra Robonica Linfa per il controllo locale con Raspberry Pi, MQTT e Home Assistant. Tra serra e Raspberry puoi scegliere **USB–UART** oppure **Wi-Fi locale tramite SSH**. I nove passi sono comuni, con una scelta al passo 02; chi usa soltanto Wi-Fi salta la verifica UART del passo 04. Ogni passo termina con una verifica e il collegamento al successivo.

Il [percorso Wi-Fi](setup/02-wifi.md) ha istruzioni operative ed è stato provato sul nostro esemplare **già modificato**: comandi, fotografia, LAN senza accesso Internet e riavvio. **L'accesso SSH iniziale su una serra mai modificata non è stato verificato** e non conosciamo una password universale. Se quel tentativo non riesce, o se preferisci UART anche a regime, segui [02B · Hardware e UART](setup/02-hardware.md). Il controller pubblicato supporta entrambi i trasporti; il nostro servizio Home Assistant attuale usa ancora UART.

> [!WARNING] Limite di verifica del percorso
> Sul prototipo, `robocontrol/rcc` era già fermo quando sono stati provati i comandi del controller. Abbiamo ricostruito dai file reali come disattivarne l'avvio automatico, ma **la sequenza non è stata provata da zero su una seconda serra**. L'uso contemporaneo dei due sistemi non è verificato: prima di azionare i componenti, segui il [controllo e la procedura reversibile del passo 06](setup/06-controller-cli.md#verifica-del-servizio-originale), inclusa la verifica dopo il riavvio.

> [!IMPORTANT] Compatibilità e responsabilità
> La procedura è stata provata su **Linfa Weezy**. La compatibilità con la Linfa standard è da verificare. Il progetto è indipendente da Robonica S.r.l.; [leggi il disclaimer completo](https://github.com/Interstellar0verdrive/Linfa-local-control#linfa-local-control) prima di aprire il dispositivo.

> [!CAUTION] Prima di aprire la serra
> **Stacca la spina della serra e scollega l'adattatore USB → TTL dal Raspberry/computer** prima di toccare la scheda, collegare o scollegare fili, saldare o forare. Tieni i componenti elettrici lontani da acqua, serbatoi, tubi e pompe. La guida presuppone esperienza di base con collegamenti elettrici e saldature; se non sai verificare che l'intervento sia sicuro, fermati e chiedi aiuto a una persona qualificata. Leggi le [precauzioni complete nel passo 01](setup/01-panoramica.md#prima-di-intervenire-sicurezza-elettrica-e-acqua).

## Percorso essenziale: dalla serra a Home Assistant

Il software del controller e del bridge è già nella repository: non devi ripetere l'indagine sul traffico cloud né estrarre il contenuto del VoCore. Prepara prima **uno** dei due accessi alla shell della serra, poi Raspberry, MQTT e Home Assistant. La [lista dei materiali per ciascuna scelta](setup/01-panoramica.md#cosa-serve-prima-di-iniziare) è nel passo 01.

> [!NOTE] Stato attuale del pacchetto
> Gli script sono disponibili. L'app completa per Home Assistant è pronta e in fase di test, ma **non è ancora pubblicata in questa repository**; manca anche un installer automatico. I passi 06–09 spiegano come configurare manualmente il controller e il bridge sul Raspberry e provarli da Home Assistant.

<div class="chapter-grid" markdown="1">

- **01** [Panoramica e obiettivi](setup/01-panoramica.md)
  Scopri i componenti, il loro ruolo e i limiti del sistema.
- **02A · Wi-Fi** [Prova il primo accesso via SSH](setup/02-wifi.md)
  Tenta la via senza apertura; configura pairing e isolamento locale. L'SSH iniziale su una serra originale resta da confermare.
- **02B · UART** [Prepara hardware e collegamenti](setup/02-hardware.md)
  Sceglila direttamente o dopo un tentativo SSH non riuscito; collega TX/RX/GND.
- **03** [Preparare il Raspberry Pi](setup/03-raspberry.md)
  Installa il sistema e i pacchetti; configura la seriale soltanto se la userai.
- **04 · Solo UART** [Verificare la console seriale](setup/04-uart.md)
  Verifica il login via cavo. Se usi solo Wi-Fi, vai direttamente al passo 05.
- **05** [Impostare la password root](setup/05-password-root.md)
  Verifica o imposta la password nella shell della serra raggiunta via SSH o UART.
- **06** [Installare il controller CLI](setup/06-controller-cli.md)
  Installa il controller e prova i comandi sul canale scelto.
- **07** [Configurare il bridge MQTT](setup/07-bridge-mqtt.md)
  Collega Raspberry e broker, poi verifica stati e comandi MQTT.
- **08** [Attivare i servizi automatici](setup/08-servizi-automatici.md)
  Configura la policy di rete corretta per il canale scelto e i timer comuni.
- **09** [Collegare Home Assistant](setup/09-home-assistant.md)
  Integra i topic MQTT e prova il flusso completo.

</div>

## Riferimento rapido

La [tabella completa dei comandi](riferimento-comandi.md) affianca ogni comando da eseguire sul Raspberry al payload MQTT equivalente da inviare da Home Assistant. Include opzioni, limiti e topic di risposta; puoi consultarla dopo il primo avvio del controller.

## Prima di copiare i comandi

Nei comandi e nei blocchi di configurazione, il giallo segnala le parti <mark class="value-to-check">da verificare o sostituire</mark> prima di usarli. I valori tra parentesi angolari, come `<LOCAL_IP>` e `<WIFI_PASSWORD>`, sono segnaposto; anche un percorso di esempio come `/dev/ttyUSB0` va verificato sul proprio sistema. Il pulsante **Copia** conserva il testo originale: non inserisce automaticamente i tuoi valori. Conserva le credenziali solo sui dispositivi che le usano. Alcuni comandi modificano la configurazione della serra: leggi il capitolo per intero prima di eseguirli.

## Approfondimenti facoltativi

Questi contenuti documentano scelte facoltative e l'indagine tecnica originale. Non servono per completare il percorso essenziale:

- [Wi-Fi, token e aggiornamenti della serra](approfondimenti/configurazione-serra.md)
- [Prove e limiti del percorso Wi-Fi](approfondimenti/percorso-wifi-sperimentale.md)
- [Rete della serra durante il setup](approfondimenti/rete-serra.md)
- [Analisi del traffico cloud](approfondimenti/traffico-cloud.md)
- [Accesso e dump del modulo](approfondimenti/accesso-e-dump.md)
