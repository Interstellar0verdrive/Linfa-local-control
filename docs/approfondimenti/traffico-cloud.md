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
    👉 mitmproxy/mitmdump continuerà a vedere tutto, perché è locale al Mac
    5. Quando finisce → chiudere il browser
4. Tornare al Terminale dove gira mitmdump e premere: CTRL + C
5. Verificare che il file esista: `ls -lh ~/Desktop/serra_ALL.mitm`
Se esiste un file > **0 byte** → PROCEDURA OK
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

1. Ora dobbiamo trasformare il file mitm in un fine HAR
Probabilmente sarà un HAR “minimal” (manca timing corretto, cookies, queryString, ecc.). Ma bene per analisi funzionale anche se non è un HAR “completo”.
    1. Crea l’addon har_dump.py

        ```bash
        nano ~/.mitmproxy/har_dump.py
        ```

        Incollare esattamente questo codice e salvare (CTRL + O → INVIO → CTRL + X):

        ```python {.source-code}
        import json
        from mitmproxy import ctx, http, options, version
        from mitmproxy.addons import core

        class Hardump:
            def __init__(self):
                self.flows = []

            def load(self, loader):
                loader.add_option(
                    name="har_dump_path",
                    typespec=str,
                    default="dump.har",
                    help="Path to the HAR file to write"
                )

            def response(self, flow: http.HTTPFlow):
                self.flows.append(flow)

            def done(self):
                har = {
                    "log": {
                        "version": "1.2",
                        "creator": {
                            "name": "mitmproxy",
                            "version": version.MITMPROXY
                        },
                        "entries": []
                    }
                }

                for f in self.flows:
                    if not f.response:
                        continue

                    entry = {
                        "startedDateTime": f.request.timestamp_start,
                        "time": 0,
                        "request": {
                            "method": f.request.method,
                            "url": f.request.pretty_url,
                            "httpVersion": "HTTP/1.1",
                            "headers": [
                                {"name": k, "value": v}
                                for k, v in f.request.headers.items(multi=True)
                            ],
                            "postData": {
                                "mimeType": f.request.headers.get("Content-Type", ""),
                                "text": f.request.text or ""
                            },
                        },
                        "response": {
                            "status": f.response.status_code,
                            "statusText": f.response.reason,
                            "httpVersion": "HTTP/1.1",
                            "headers": [
                                {"name": k, "value": v}
                                for k, v in f.response.headers.items(multi=True)
                            ],
                            "content": {
                                "mimeType": f.response.headers.get("Content-Type", ""),
                                "text": f.response.text or ""
                            },
                        },
                    }

                    har["log"]["entries"].append(entry)

                path = ctx.options.har_dump_path
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(har, f, indent=2)

        addons = [Hardump()]
        ```

    2. Dare questo comando:

        ```bash
        mitmdump -r ~/Desktop/serra_ALL.mitm \
          -s ~/.mitmproxy/har_dump.py \
          --set har_dump_path=~/Desktop/serra_ALL_OK.har
        ```

    3. Viene generato il file serra_ALL_OK.har.


### 3) Risultati

Dal file HAR si vede chiaramente che:

- la serra mantiene una **connessione persistente verso il cloud**
- usa:
    - WebSocket **oppure**
    - HTTPS long-polling
- con:
    - token statico per dispositivo
    - device_id
- Il **bottom è solo uno slave,** il **top è il cervello e comanda pompe e luci**
- il bottom **NON decide nulla,** riceve: segnali, enable/disable, PWM / on-off
- ESISTE codice locale che comanda i componenti (es. luci e pompe), NON è esposto via HTTP come API, è chiamabile internamente dal firmware
