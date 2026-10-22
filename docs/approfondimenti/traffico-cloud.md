# Analisi facoltativa del traffico cloud

Questa analisi documenta come sono stati studiati i flussi originali. Non è necessaria per completare il [percorso guidato](../index.md).

## Osservazione del traffico di rete tramite man-in-the-middle proxy (.HAR / .mitm)

La procedura è stata fatta per **sniffare/registrare il traffico applicativo** tra serra/app e cloud, con l’obiettivo di capire **endpoint, token, payload e flussi** (eventualmente anche comandi), non per estrarre il filesystem della serra.

---

## Sniff traffico serra ↔ cloud (HAR + .mitm)

### 1) Intento

- **Osservare e registrare** le comunicazioni tra serra (e/o app) e backend Robonica.
- Ricavare:
    - domini e percorsi (API / websocket)
    - token/credenziali di sessione (se transitano in chiaro a livello applicativo)
    - payload e parametri (es. configurazioni, comandi, eventi)
    - sequenza dei flussi (bootstrap → autenticazione → canali websocket → invio/ricezione messaggi)

Obiettivo pratico: avere una traccia ripetibile per analizzare “come parla” la serra col cloud e quali chiamate/azioni avvengono.

---

### 2) Cosa è stato usato e con che approccio

Approccio: **Man-in-the-middle proxy** (MITM) a livello HTTP/HTTPS.

Strumenti:

- **mitmproxy / mitmdump** sul computer
- Esportazione in:
    - **.mitm** = cattura raw nel formato di mitmproxy
    - **.har** = export strutturato (HTTP Archive) per analisi con browser/devtools o tool HAR

Note:

- Questo è un approccio diverso da tcpdump/wireshark:
    - qui si “intercetta” a livello applicativo tramite proxy
    - con TLS decifrato **solo** se il client accetta il certificato MITM
- Questa cattura registra il traffico generato dal computer (browser/webapp), ma non necessariamente quello *diretto* della serra, se questa non usa il computer come proxy.

---

### 3) Procedura da seguire (passi)

1. Collega il computer alla rete temporanea creata dalla serra.

2. Installa mitmproxy seguendo la [guida ufficiale per il tuo sistema](https://docs.mitmproxy.org/stable/overview/installation/): su macOS `brew install --cask mitmproxy`; su Windows usa l'installer ufficiale; su Linux scarica i binari ufficiali o usa un pacchetto della tua distribuzione, che potrebbe essere meno aggiornato. Il pacchetto include `mitmproxy`, `mitmdump` e `mitmweb`.

3. Crea una cartella dedicata sul computer, apri lì Terminale (macOS/Linux) o PowerShell (Windows) e avvia la cattura. Il file viene salvato nella cartella corrente:

    ```text {.command-example}
    mitmdump -p 8080 -w serra_ALL.mitm
    ```

    Non si apre una finestra grafica: il terminale resta occupato mentre registra. Lascialo aperto fino alla fine della prova.

4. Imposta nel browser o nelle impostazioni di rete il proxy HTTP e HTTPS su `127.0.0.1`, porta `8080`:

    | Sistema | Dove configurarlo |
    | --- | --- |
    | macOS | [Impostazioni di Sistema → Rete → servizio Wi-Fi → Dettagli → Proxy](https://support.apple.com/en-gb/guide/mac-help/mchlp2591/mac) |
    | Windows | [Impostazioni → Rete e Internet → Proxy → Configurazione manuale](https://support.microsoft.com/en-us/windows/experience/connectivity-networking/use-a-proxy-server-in-windows) |
    | Linux | Proxy del browser o impostazioni di rete dell'ambiente desktop: il percorso cambia tra distribuzioni e desktop. |

    Ricontrolla il proxy dopo il passaggio alla rete Wi-Fi della serra: le impostazioni potrebbero essere legate alla rete usata. Per il traffico HTTPS, visita `http://mitm.it` dal browser che usa il proxy e segui le [istruzioni per installare il certificato](https://docs.mitmproxy.org/stable/concepts/certificates/) sul tuo sistema.

5. Se la webapp originale è ancora raggiungibile, aprila nel browser, avvia **aggiunta nuova serra**, passa alla rete Wi-Fi della serra quando richiesto ed esegui il checkup. Alla fine chiudi il browser. mitmproxy/mitmdump vedrà **solo il traffico dei programmi del computer che usano il proxy**; non acquisisce automaticamente le connessioni avviate dalla serra.

6. Torna al terminale dove gira mitmdump e premi **CTRL + C**.

7. Verifica che `serra_ALL.mitm` esista nella cartella scelta e non sia vuoto. Un file non vuoto conferma che qualcosa è stato registrato, **non** che contenga tutti i flussi della serra. Aprilo e controlla quali host e richieste sono realmente presenti.

8. Per visualizzare il file, dalla stessa cartella usa:

    ```text {.command-example}
    mitmproxy -r serra_ALL.mitm
    ```

    **Dentro mitmproxy**, premi `f` e inserisci uno di questi filtri nell'interfaccia (non sono comandi della shell):

    | Cosa mostrare | Filtro |
    | --- | --- |
    | Destinazioni locali | `~dst 192.168.` |
    | Richieste POST | `~m POST` |
    | POST verso destinazioni locali | `~m POST & ~dst 192.168.` |

9. Per esportare un HAR dalla cattura, usa l'opzione **integrata** di mitmproxy (disponibile dalla versione 10.1):

    ```text {.command-example}
    mitmdump -n -r serra_ALL.mitm --set hardump=serra_ALL_OK.har
    ```

    Controlla che il comando termini senza errori e apri il file generato per verificare che contenga le richieste cercate. L'opzione `hardump` è descritta nella [documentazione ufficiale di mitmproxy](https://docs.mitmproxy.org/stable/concepts/options/). Le note originali includevano un piccolo script artigianale per produrre un “HAR minimal”, ma mancava di campi e formati richiesti da HAR: non lo riproponiamo come esportazione affidabile.

    **Non pubblicare né condividere i file `.mitm` e `.har` senza revisarli:** possono contenere token, credenziali, cookie e altri dati privati. Finita la prova, disattiva il proxy e rimuovi il certificato di test se non ti serve più.

### 4) Risultati e limiti

La cattura tramite proxy del computer può mostrare gli endpoint, i token e le richieste della **webapp o del browser**, se questi transitano effettivamente nel proxy. Non basta, da sola, a dimostrare che **la serra** mantiene una connessione persistente al cloud o a stabilire se questa usi WebSocket o long-polling: per quelle conclusioni serve osservare il traffico della serra o i suoi log.

Le note del [dump del modulo](accesso-e-dump.md#cosa-si-deduce-dal-dump) riportano invece il codice locale di controllo e due seriali interne verso l'elettronica della serra. Le funzioni dei singoli componenti e il ruolo delle schede derivano da quel dump e dalle prove hardware, **non** dal solo HAR del browser. Se ripeti l'analisi, separa sempre osservazioni dirette e ipotesi.

---

[Torna all’indice della guida](../index.md).
