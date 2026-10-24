Questa guida accompagna la preparazione di una serra Robonica Linfa per controllarla in locale con Raspberry Pi e Home Assistant. Segui i passi nell'ordine: al **passo 02 scegli il collegamento**, poi prosegui con i passi comuni. Ogni capitolo termina con una verifica e il link al passo successivo.

## Scegli il tuo percorso

**Wi-Fi** significa che il Raspberry comunica con la serra attraverso la rete domestica, usando SSH. **USB** significa che un adattatore USB collegato al Raspberry comunica con la porta seriale interna della serra, chiamata *UART*. Home Assistant usa la stessa interfaccia in entrambi i casi.

| | Wi-Fi · passo 02A | USB · passo 02B |
| --- | --- | --- |
| **Apertura della serra** | Puoi evitarla **se** riesci a entrare via SSH nella serra originale. | Necessaria per raggiungere i pin nella parte superiore; il montaggio documentato richiede anche fili saldati e un foro per farli uscire. |
| **Materiale specifico** | Rete domestica, router e computer con SSH. Durante la prima configurazione devi poter scollegare Internet dal router. | Adattatore USB–TTL a 3,3 V, tre collegamenti TX/RX/GND e attrezzi per il montaggio. |
| **Difficoltà principale** | Individuare la serra, accedere via SSH e isolarla da Internet mantenendo la rete locale. | Aprire la serra e realizzare collegamenti elettrici sicuri. |
| **Durante l'uso** | La radio della serra resta accesa sulla rete locale, senza accesso Internet. | La serra può mantenere la radio spenta; i comandi passano dal cavo. |

Sul **mio esemplare già modificato** ho verificato via Wi-Fi comandi, fotografia, isolamento dalla rete Internet e riavvio. **Non ho verificato l'accesso SSH iniziale su una serra mai modificata e non conosco una password universale.** Puoi provare il passo 02A senza aprire la serra. Se SSH non funziona, il collegamento USB serve per il primo accesso; dopo puoi scegliere se mantenerlo o passare al Wi-Fi. Puoi anche scegliere USB fin dall'inizio. La [lista completa dei materiali](setup/01-panoramica.md#cosa-serve-prima-di-iniziare) è nel passo 01.

> [!WARNING] Limite di verifica del percorso
> Sul mio esemplare `robocontrol/rcc` era già fermo quando ho provato il controller. La procedura per disattivarne l'avvio è stata ricostruita dai file del dispositivo, ma **non provata da zero su una seconda serra**. Prima di azionare i componenti, segui la [verifica reversibile del passo 06](setup/06-controller-cli.md#verifica-del-servizio-originale), anche dopo il riavvio.

> [!IMPORTANT] Compatibilità e responsabilità
> La procedura è stata provata su **Linfa Weezy**. La compatibilità con la Linfa standard è da verificare. Il progetto è indipendente da Robonica S.r.l. e la modifica potrebbe invalidare la garanzia; [leggi il disclaimer completo](https://github.com/Interstellar0verdrive/Linfa-local-control#linfa-local-control).

> [!CAUTION] Prima di aprire la serra
> **Stacca la spina della serra e scollega l'adattatore USB–TTL dal Raspberry/computer** prima di toccare la scheda, collegare fili, saldare o forare. Tieni l'elettronica lontana da acqua e pompe. La guida presuppone esperienza di base con collegamenti elettrici e saldature; se hai dubbi, chiedi aiuto a una persona qualificata. Le [precauzioni complete](setup/01-panoramica.md#prima-di-intervenire-sicurezza-elettrica-e-acqua) sono nel passo 01.

## I nove passi

Il controller e il bridge sono già nella repository: non devi ripetere l'indagine sul traffico cloud. **L'app completa Home Assistant è pronta e in fase di test, ma non è ancora pubblicata qui**; i passi finali spiegano l'integrazione manuale attualmente disponibile.

<div class="chapter-grid" markdown="1">

- **01** [Panoramica e obiettivi](setup/01-panoramica.md) <span class="path-tags"><span class="path-tag path-tag-wifi">Wi-Fi</span><span class="path-tag path-tag-usb">USB</span></span>
  Capisci il sistema, le conseguenze della scelta e cosa serve prima di iniziare.
- **02A** [Prova il primo accesso via SSH](setup/02-wifi.md) <span class="path-tags"><span class="path-tag path-tag-wifi">Wi-Fi</span></span>
  Cerca la serra sulla rete, prova SSH e prepara la LAN senza accesso Internet.
- **02B** [Prepara il collegamento fisico](setup/02-hardware.md) <span class="path-tags"><span class="path-tag path-tag-usb">USB</span></span>
  Apri la parte superiore e collega i tre segnali seriali tramite adattatore USB.
- **03** [Preparare il Raspberry Pi](setup/03-raspberry.md) <span class="path-tags"><span class="path-tag path-tag-wifi">Wi-Fi</span><span class="path-tag path-tag-usb">USB</span></span>
  Installa sistema e pacchetti; configura la seriale soltanto se usi USB.
- **04** [Verificare la connessione](setup/04-uart.md) <span class="path-tags"><span class="path-tag path-tag-usb">USB</span></span>
  Controlla la console tramite cavo. Se usi solo Wi-Fi, vai al passo 05.
- **05** [Impostare la password root](setup/05-password-root.md) <span class="path-tags"><span class="path-tag path-tag-wifi">Wi-Fi</span><span class="path-tag path-tag-usb">USB</span></span>
  Verifica o imposta la password nella shell della serra.
- **06** [Installare il controller CLI](setup/06-controller-cli.md) <span class="path-tags"><span class="path-tag path-tag-wifi">Wi-Fi</span><span class="path-tag path-tag-usb">USB</span></span>
  Controlla il servizio originale, installa il controller e prova i comandi.
- **07** [Configurare il bridge MQTT](setup/07-bridge-mqtt.md) <span class="path-tags"><span class="path-tag path-tag-wifi">Wi-Fi</span><span class="path-tag path-tag-usb">USB</span></span>
  Collega Raspberry e broker, poi verifica stati e comandi MQTT.
- **08** [Attivare i servizi automatici](setup/08-servizi-automatici.md) <span class="path-tags"><span class="path-tag path-tag-wifi">Wi-Fi</span><span class="path-tag path-tag-usb">USB</span></span>
  Imposta la rete in base al collegamento scelto e abilita i timer comuni.
- **09** [Collegare Home Assistant](setup/09-home-assistant.md) <span class="path-tags"><span class="path-tag path-tag-wifi">Wi-Fi</span><span class="path-tag path-tag-usb">USB</span></span>
  Integra i topic MQTT e prova il flusso completo.

</div>

## Riferimento rapido

La [tabella completa dei comandi](riferimento-comandi.md) spiega sintassi, opzioni, payload MQTT e risposte. Consultala quando inizi a provare il controller.

## Prima di copiare i comandi

Nei comandi e nei blocchi di configurazione, il giallo segnala le parti <mark class="value-to-check">da verificare o sostituire</mark>. Valori come `<LOCAL_IP>` e `<WIFI_PASSWORD>` sono segnaposto; anche `/dev/ttyUSB0` va verificato sul tuo sistema. Il pulsante **Copia** non inserisce i tuoi valori. Leggi tutto il capitolo prima di eseguire comandi che modificano la serra.

## Approfondimenti facoltativi

Documentano l'indagine tecnica e alcune funzioni opzionali. Non servono per completare i nove passi:

- [Prove e limiti del Wi-Fi](approfondimenti/percorso-wifi-sperimentale.md): cosa ho verificato sulla mia serra e cosa manca da confermare su un esemplare originale.
- [Fotocamera della serra](approfondimenti/fotocamera.md): preparazione dello scatto e trasferimento delle immagini al Raspberry.
- [Wi-Fi, token e aggiornamenti](approfondimenti/configurazione-serra.md): modifiche facoltative e appunti storici sulla configurazione del VoCore.
- [Rete della serra](approfondimenti/rete-serra.md): indirizzi, interfacce e comportamento della rete osservati durante le prove.
- [Analisi del traffico cloud](approfondimenti/traffico-cloud.md): percorso di analisi del protocollo originale; non richiesto per installare il controller.
- [Accesso e dump del modulo](approfondimenti/accesso-e-dump.md): comandi e risultati dell'esplorazione iniziale del VoCore.
