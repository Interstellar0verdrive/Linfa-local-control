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

- **mitmproxy / mitmdump** su Mac
- Esportazione in:
    - **.mitm** = cattura raw nel formato di mitmproxy
    - **.har** = export strutturato (HTTP Archive) per analisi con browser/devtools o tool HAR

Note:

- Questo è un approccio diverso da tcpdump/wireshark:
    - qui si “intercetta” a livello applicativo tramite proxy
    - con TLS decifrato **solo** se il client accetta il certificato MITM
- Questa cattura registra il traffico generato dal Mac (browser/webapp).
Non necessariamente il traffico *diretto* della serra, se la serra *non* usa il Mac come proxy.

---

### 3) Procedura da seguire (passi)

1. Collegarsi alla rete temporanea creata dalla serra con il Mac
2. Dal Terminale del Mac:

Se non è già installato, installa mitmproxy:

```bash
brew install mitmproxy
```

Il pacchetto include `mitmproxy`, `mitmdump` e `mitmweb`. Avvia la cattura:

```bash
mitmdump -p 8080 -w ~/Desktop/serra_ALL.mitm
```

Non si apre una finestra grafica: il terminale resta occupato mentre registra. Lascialo aperto fino alla fine della prova.

1. Impostare il proxy di macOS su localhost
**Impostazioni → Rete → Wi-Fi → Dettagli → Proxy**
✅ Proxy Web (HTTP): 127.0.0.1 porta 8080
✅ Proxy Web Sicuro (HTTPS): 127.0.0.1 porta 8080
Nota: questa impostazione vale per la connessione Wi-Fi attuale.
Quando si passa alla Wi-Fi della serra, meglio ricontrollare che sia ancora attiva (di solito resta attiva, ma macOS a volte la “resetta” per reti nuove).
2. (Se serve) abilitare la lettura HTTPS:
Con proxy attivo, aprire dal browser: http://mitm.it
Scaricare il certificato **macOS**, installarlo nel Portachiavi e impostare **“Sempre attendibile”**.
3. **Ora fare la procedura della serra**
    1. aprire la webapp da browser (https://mylinfa.robonica.it/#/mylinfa)
    2. Avviare **aggiunta nuova serra**
    3. quando la serra chiede di passare alla Wi-Fi della serra → accettare e procedere
    4. Lanciare il checkup
    👉 mitmproxy/mitmdump vedrà **solo il traffico dei programmi del Mac che usano il proxy**. Non acquisisce automaticamente le connessioni avviate dalla serra.
    5. Quando finisce → chiudere il browser
4. Tornare al Terminale dove gira mitmdump e premere: CTRL + C
5. Verificare che il file esista: `ls -lh ~/Desktop/serra_ALL.mitm`
Un file non vuoto conferma che qualcosa è stato registrato, **non** che contenga tutti i flussi della serra. Aprilo e controlla quali host e richieste sono realmente presenti.
6. Per visualizzare il file si può usare il comando:

```bash
mitmproxy -r ~/Desktop/serra_ALL.mitm
```

**Dentro mitmproxy**, premi `f` e inserisci uno di questi filtri nell'interfaccia (non sono comandi della shell):

| Cosa mostrare | Filtro |
| --- | --- |
| Destinazioni locali | `~dst 192.168.` |
| Richieste POST | `~m POST` |
| POST verso destinazioni locali | `~m POST & ~dst 192.168.` |

1. Per esportare un HAR dalla cattura, usa l'opzione **integrata** di mitmproxy (disponibile dalla versione 10.1):

    ```bash
    mitmdump -n -r "$HOME/Desktop/serra_ALL.mitm" \
      --set "hardump=$HOME/Desktop/serra_ALL_OK.har"
    ```

    Controlla che il comando termini senza errori e apri il file generato per verificare che contenga le richieste cercate. L'opzione `hardump` è descritta nella [documentazione ufficiale di mitmproxy](https://docs.mitmproxy.org/stable/concepts/options/). Le note originali includevano un piccolo script artigianale per produrre un “HAR minimal”, ma mancava di campi e formati richiesti da HAR: non lo riproponiamo come esportazione affidabile.

    **Non pubblicare né condividere i file `.mitm` e `.har` senza revisarli:** possono contenere token, credenziali, cookie e altri dati privati.

### 4) Risultati e limiti

La cattura tramite proxy del Mac può mostrare gli endpoint, i token e le richieste della **webapp o del browser**, se questi transitano effettivamente nel proxy. Non basta, da sola, a dimostrare che **la serra** mantiene una connessione persistente al cloud o a stabilire se questa usi WebSocket o long-polling: per quelle conclusioni serve osservare il traffico della serra o i suoi log.

Le note del [dump del modulo](accesso-e-dump.md#cosa-si-deduce-dal-dump) riportano invece il codice locale di controllo e due seriali interne verso l'elettronica della serra. Le funzioni dei singoli componenti e il ruolo delle schede derivano da quel dump e dalle prove hardware, **non** dal solo HAR del browser. Se ripeti l'analisi, separa sempre osservazioni dirette e ipotesi.

---

[Torna all’indice della guida](../index.md).
