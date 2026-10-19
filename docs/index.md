# Linfa Local Control

Questa documentazione descrive come controllare localmente una serra Robonica Linfa con un Raspberry Pi collegato alla console UART del dispositivo. Il Raspberry esegue il controller seriale e un bridge MQTT; Home Assistant può inviare comandi e leggere gli stati pubblicati.

Il progetto è **indipendente e non ufficiale**. La procedura è stata provata su Linfa Weezy; la compatibilità con la Linfa standard è ancora da verificare. Leggi il [disclaimer nel README](https://github.com/Interstellar0verdrive/Linfa-local-control#linfa-local-control) prima di aprire o modificare il dispositivo.

## Da dove iniziare

1. Leggi la [panoramica](setup/panoramica.md) e i limiti del sistema.
2. Prepara l'[hardware](setup/hardware.md) e il [Raspberry Pi](setup/raspberry.md).
3. Verifica il [collegamento UART](setup/uart.md).
4. Segui la [preparazione della serra](setup/preparazione-serra.md) e le [modifiche di configurazione](setup/modifiche-serra.md).
5. Controlla la [rete](setup/rete.md), installa il [controller e il bridge MQTT](setup/controller-mqtt.md), poi configura [Home Assistant](setup/home-assistant.md).

## Prima di eseguire i comandi

Gli esempi derivano da una configurazione reale e sono stati ripuliti dai dati personali. I valori fra parentesi angolari, come `<LOCAL_IP>` e `<WIFI_PASSWORD>`, sono **segnaposto**: sostituiscili con i valori del tuo impianto prima di copiare il comando. Conserva le credenziali soltanto sul dispositivo che le usa, con permessi appropriati.

I capitoli mantengono anche osservazioni sperimentali e passaggi facoltativi. Non considerare confermato su tutti i modelli ciò che è segnalato come ipotesi o non verificato.
