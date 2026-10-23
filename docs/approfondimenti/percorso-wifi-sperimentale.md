# Percorso Wi-Fi sperimentale

**Stato: trasporto Wi-Fi sperimentale, non procedura completa di installazione.** I [capitoli 01–09](../index.md#percorso-essenziale-dalla-serra-a-home-assistant) descrivono ancora il percorso USB–UART. Il controller nella repository ora offre anche `wifi` (SSH sulla LAN) e `auto` (un canale preferito e l'altro di riserva). Su una **Linfa Weezy già modificata** abbiamo provato comandi, fotografia e un percorso completo MQTT → bridge → controller → SSH → serra. L'installazione da zero via Wi-Fi e il passaggio dei servizi attuali del prototipo alla nuova modalità **non sono ancora stati verificati**.

## Cosa potrebbe cambiare per chi parte da zero

Il percorso ipotizzato è:

1. Con la connessione Internet del router scollegata, attivare la modalità di configurazione della serra e collegare un computer o il Raspberry alla sua rete temporanea `LINFA_…`.
2. Configurare SSID e password della Wi-Fi domestica tramite l'interfaccia locale della serra. **La LAN resta senza Internet** finché la serra non è stata isolata.
3. Provare l'accesso SSH. Se funziona con credenziali note, preparare una configurazione di rete locale senza uscita verso Internet. Se non funziona, serve l'accesso alla console UART per indagare e configurare il dispositivo: non abbiamo una password universale da suggerire.
4. Con la WAN ancora scollegata, verificare che la serra abbia una rotta per la LAN ma **nessuna rotta predefinita verso Internet**, anche dopo un rinnovo DHCP e un riavvio. Solo allora ricollegare Internet al router e verificare che la serra raggiunga il Raspberry ma non un indirizzo Internet.
5. Configurare sul Raspberry il controller per SSH locale dopo aver verificato le credenziali e l'isolamento della serra. La guida dettagliata per installare questa modalità, inclusi i servizi automatici, è ancora da preparare e provare da zero.

Il passaggio 3 è il tassello mancante: il nostro SSH via rete è stato provato **dopo** aver impostato la password root tramite UART. La password del firmware VoCore generico non dimostra quella del firmware Robonica. Il reset fisico del nostro dispositivo non ha modificato la password root, quindi ripeterlo sulla stessa serra non riproduce lo stato di fabbrica.

> [!CAUTION] Prima di provare il reset
> Sul nostro esemplare il pulsante **non** ha resettato soltanto la Wi-Fi: ha cancellato dati di configurazione, ripristinato file del software originale e riavviato il dispositivo. Non usarlo come primo passo di una procedura ripetibile senza conoscere lo stato della tua serra e senza un piano di recupero. Il comportamento di altri firmware non è verificato.

## Come abbiamo configurato la rete dopo il reset

Con Internet del router fisicamente scollegato, abbiamo tenuto premuto il pulsante fino al lampeggio bianco del LED ring. Dopo il riavvio è comparsa la rete temporanea `LINFA_…`. **Sul nostro esemplare la radio era stata disabilitata in precedenza:** per questa prova l'abbiamo riattivata dalla console UART; una serra originale potrebbe avviarla da sola, ma non l'abbiamo verificato.

Abbiamo collegato **il Raspberry** alla rete temporanea e inviato alla serra una richiesta HTTP locale `POST /credentials` con SSID, password della rete domestica e token. Sul nostro firmware l'access point rispondeva all'indirizzo `192.168.247.1`; non assumere che sia uguale su ogni dispositivo. La richiesta ha riavviato la radio; dopo il collegamento alla Wi-Fi di casa abbiamo individuato il nuovo IP nel router. Il dettaglio della [richiesta usata sul prototipo](configurazione-serra.md#cambiare-la-rete-su-cui-si-collega-la-serra) è documentato a parte. L'app originale mostrava una procedura guidata per connettere il telefono alla rete temporanea e inserire la rete di casa; non abbiamo verificato che oggi sia ancora utilizzabile.

**La richiesta di configurazione non imposta la password root SSH.** Sul nostro dispositivo l'accesso SSH dalla rete temporanea e poi dalla LAN è riuscito usando la password impostata in precedenza via UART. Su una serra mai modificata potrebbe essere diversa, vuota o sconosciuta: non sappiamo ancora se l'accesso SSH iniziale funzioni. In particolare, il server SSH osservato sul nostro firmware non accetta password vuote con la sua configurazione attuale, anche se la console seriale le accettasse.

## Isolamento da Internet senza una regola del router

**Sì, abbiamo verificato un metodo interno alla serra.** Sul nostro VoCore, il client DHCP originale aggiungeva la rotta predefinita comunicata dal router. Abbiamo modificato l'avvio del client DHCP perché **non installi quella rotta**; un controllo successivo la elimina se compare. La serra conserva l'IP e la comunicazione con i dispositivi della stessa sottorete, ma non ha un percorso IPv4 verso Internet. Abbiamo verificato il risultato con la WAN collegata: Raspberry raggiungibile dalla serra, indirizzo Internet non raggiungibile. Abbiamo controllato anche l'assenza di una rotta IPv6.

Questo metodo **richiede accesso amministrativo alla serra prima di applicarlo**. Perciò, se il router non consente di bloccare soltanto la serra, durante il pairing e la modifica abbiamo tenuto scollegata fisicamente la sua connessione Internet/WAN. La modifica al DHCP è stata provata sul nostro firmware e durante un rinnovo dell'indirizzo, ma non ancora come procedura completa dopo un riavvio con Wi-Fi avviata automaticamente. Non basta cambiare il token in `offline-token`: questo non impedisce la comunicazione di rete. La mancanza della rotta predefinita blocca le destinazioni esterne alla sottorete locale in questa configurazione, ma va riverificata se cambiano firmware o rete. Non impedisce da sola a un software con privilegi amministrativi di modificare di nuovo la tabella di routing, né sostituisce l'eventuale isolamento sul router.

## Cosa abbiamo già dimostrato e cosa manca

| Verifica | Esito |
| --- | --- |
| Rete temporanea dopo il reset sul nostro esemplare | Comparsa dopo aver riattivato la radio via UART |
| Pairing con SSID e password della rete domestica | Riuscito tramite richiesta locale dal Raspberry |
| SSH dalla rete temporanea e dalla LAN | Riuscito con password root **già impostata via UART** |
| Controllo luci, ventole, ring, letture e foto via Wi-Fi | Riusciti sul prototipo con una copia di prova del controller; pompe provate soltanto per pochi secondi |
| Comando MQTT verso il bridge e risposta via SSH | Riuscito con un topic di prova isolato, senza modificare il servizio in uso |
| Isolamento Internet configurato dentro la serra | Verificato sulla LAN del prototipo anche con WAN collegata e al rinnovo DHCP |
| Accesso SSH iniziale su una serra mai modificata | **Non verificato**: credenziali originali sconosciute |
| Controller Wi-Fi nel repository | **Sperimentale**: `SERRA_TRANSPORT=wifi` oppure `auto`; la configurazione del servizio in uso resta UART |

Il trasporto Wi-Fi usa `sshpass`, una credenziale root salvata sul Raspberry e la chiave host SSH della serra **verificata** in `~/.ssh/known_hosts`. In modalità `auto` il controller usa il canale secondario soltanto se il primario fallisce **prima** dell'invio del comando: se l'esito diventa incerto, non ritenta sull'altro canale. Così evita che un dosaggio o un ricircolo possa partire due volte. `serra net on/off` richiede UART, perché spegnere la rete interromperebbe lo stesso collegamento SSH; il timer `serra-netoff` va lasciato disabilitato nel percorso Wi-Fi. Il resto dell'interfaccia CLI e MQTT non cambia.

Se l'accesso SSH iniziale non funziona, il collegamento UART resta il percorso per configurare la serra. Chi preferisce usare UART anche a regime può mantenerla. Chi vuole installare il progetto seguendo una procedura già documentata da inizio a fine deve usare per ora il [percorso USB–UART](../index.md#percorso-essenziale-dalla-serra-a-home-assistant).

---

[Torna all’indice della guida](../index.md).
