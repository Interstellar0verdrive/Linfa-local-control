# Guida passo per passo

Segui i capitoli nell'ordine indicato. Alla fine di ogni pagina trovi un controllo del risultato e il collegamento diretto al passo successivo. Puoi leggere gli stessi file qui su GitHub oppure nel sito di documentazione quando sarà pubblicato.

La procedura è stata provata su **Linfa Weezy**. La compatibilità con la Linfa standard resta da verificare. Il progetto è indipendente da Robonica S.r.l.; [leggi il disclaimer nel README](https://github.com/Interstellar0verdrive/Linfa-local-control#linfa-local-control) prima di aprire il dispositivo.

## Percorso completo

| Passo | Cosa fai | Quando puoi proseguire |
| :--- | :--- | :--- |
| 00 | [Panoramica e obiettivi](setup/00-panoramica.md) | Hai compreso il ruolo di serra, Raspberry, UART, MQTT e Home Assistant. |
| 01 | [Hardware e collegamenti](setup/01-hardware.md) | Hai identificato TX, RX e GND e usi un adattatore TTL a 3,3 V senza collegare VCC. |
| 02 | [Preparare il Raspberry Pi](setup/02-raspberry.md) | Python, picocom, i pacchetti richiesti e i permessi seriali sono pronti. |
| 03 | [Verificare la console UART](setup/03-uart.md) | La console risponde, puoi effettuare il login e il comando di prova funziona. |
| 04 | [Impostare la password root](setup/04-password-root.md) | Hai impostato una password root sulla serra e la conserverai per la configurazione locale. |
| 05 | [Configurare la serra per l'uso locale](setup/05-modifiche-serra.md) | Hai verificato le modifiche che hai scelto di applicare alla serra. |
| 06 | [Verificare la rete](setup/06-rete.md) | Conosci gli indirizzi della serra e del Raspberry; il broker sarà predisposto nel passo 08. |
| 07 | [Installare e provare il controller CLI](setup/07-controller-cli.md) | Il comando `serra state sync` funziona dal Raspberry tramite UART. |
| 08 | [Configurare il bridge MQTT](setup/08-bridge-mqtt.md) | Il servizio bridge è attivo e i topic di stato e comando rispondono. |
| 09 | [Attivare i servizi automatici](setup/09-servizi-automatici.md) | I timer sono attivi e i relativi servizi risultano verificati. |
| 10 | [Collegare Home Assistant](setup/10-home-assistant.md) | Home Assistant riceve gli stati MQTT e puoi inviare un comando di prova. |

[Inizia dal passo 00 · Panoramica e obiettivi →](setup/00-panoramica.md)

## Prima di copiare i comandi

I valori tra parentesi angolari, come `<LOCAL_IP>` e `<WIFI_PASSWORD>`, sono segnaposto. Sostituiscili con i valori del tuo impianto e conserva le credenziali solo sui dispositivi che le usano. Alcuni comandi modificano la configurazione della serra: leggi il capitolo per intero prima di eseguirli.

## Approfondimenti facoltativi

Questi contenuti spiegano l'indagine tecnica originale e non interrompono il percorso:

- [Analisi del traffico cloud](approfondimenti/traffico-cloud.md)
- [Accesso e dump del modulo](approfondimenti/accesso-e-dump.md)
