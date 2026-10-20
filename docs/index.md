Questa guida accompagna la preparazione di una serra Robonica Linfa per il controllo locale con Raspberry Pi, UART, MQTT e Home Assistant. Segui i capitoli nell'ordine: ogni passo termina con una verifica e il collegamento al successivo.

> [!IMPORTANT] Compatibilità e responsabilità
> La procedura è stata provata su **Linfa Weezy**. La compatibilità con la Linfa standard è da verificare. Il progetto è indipendente da Robonica S.r.l.; [leggi il disclaimer completo](https://github.com/Interstellar0verdrive/Linfa-local-control#linfa-local-control) prima di aprire il dispositivo.

## Il percorso, dall'inizio alla fine

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
  Proteggi l'accesso al modulo e verifica la nuova password.
- **05** [Configurare la serra per l'uso locale](setup/05-modifiche-serra.md)
  Applica e controlla le modifiche alla configurazione della serra.
- **06** [Verificare la rete](setup/06-rete.md)
  Controlla indirizzi, connessione domestica e accesso al Raspberry.
- **07** [Installare e provare il controller CLI](setup/07-controller-cli.md)
  Installa il controller seriale e prova comandi e sincronizzazione.
- **08** [Configurare il bridge MQTT](setup/08-bridge-mqtt.md)
  Collega Raspberry e broker, poi verifica stati e comandi MQTT.
- **09** [Attivare i servizi automatici](setup/09-servizi-automatici.md)
  Attiva i timer per la policy di rete e la sincronizzazione periodica.
- **10** [Collegare Home Assistant](setup/10-home-assistant.md)
  Integra i topic MQTT e prova il flusso completo.

</div>

## Prima di copiare i comandi

I valori tra parentesi angolari, come `<LOCAL_IP>` e `<WIFI_PASSWORD>`, sono segnaposto. Sostituiscili con i valori del tuo impianto e conserva le credenziali solo sui dispositivi che le usano. Alcuni comandi modificano la configurazione della serra: leggi il capitolo per intero prima di eseguirli.

## Approfondimenti facoltativi

Questi contenuti raccontano l'indagine tecnica originale e non interrompono il percorso:

- [Analisi del traffico cloud](approfondimenti/traffico-cloud.md)
- [Accesso e dump del modulo](approfondimenti/accesso-e-dump.md)
