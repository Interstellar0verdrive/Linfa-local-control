# Wi-Fi, token e aggiornamenti della serra

Questa pagina conserva le modifiche di configurazione esplorate durante lo sviluppo sulla **Linfa Weezy del prototipo**. Il token fittizio `offline-token` è **ancora presente** sul prototipo: lo abbiamo verificato nel file `/opt/data/token` senza pubblicare il token originale. Era stato impostato per ostacolare l'associazione al cloud originale. Cambiare token, credenziali Wi-Fi o permessi degli aggiornamenti **non è necessario** per usare il [controller locale via UART](../index.md). Gli endpoint e i file possono differire su altri firmware; non trattare questi esempi come passaggi di installazione universali.

Un token fittizio **non spegne la radio né impedisce alla serra di tentare una connessione** se la rete viene riattivata; il cloud potrebbe usare altri identificativi. Sul prototipo la Wi-Fi è disabilitata all'avvio tramite `OFF_S45net`, come spiegato nel [passo 08](../setup/08-servizi-automatici.md#disabilitare-la-wi-fi-allavvio-della-serra). Il token è una misura aggiuntiva, non una prova di isolamento dalla rete.

> [!CAUTION] Modifiche facoltative e persistenti
> Cambiare token, credenziali Wi-Fi o permessi di `/var/update` modifica il comportamento originale della serra. Conserva i valori e i permessi iniziali prima di intervenire; non eseguire questi comandi come parte automatica dell'installazione del controller. **Non esiste qui una procedura di ripristino completo verificata** per tutte le varianti della serra.

In origine la serra ha uno **user-token** (`<ORIGINAL_DEVICE_TOKEN>`) e un **UUID** (`<DEVICE_UUID>`). Sono segnaposto, non i valori della tua serra.

## Cambiare la rete su cui si collega la serra

Dopo aver collegato il computer alla rete temporanea creata dalla serra, il prototipo ha usato dal **terminale del computer** la richiesta seguente. Sostituisci i segnaposto nel comando prima di eseguirlo. L'endpoint `/credentials` e i nomi delle chiavi sono stati osservati su quel firmware; verifica che siano validi sulla tua versione prima di modificare la configurazione. Il comando originale usa la sintassi del terminale di **macOS/Linux**:

```bash {.terminal-computer}
curl -i -X POST "http://<LOCAL_IP>/credentials" \
-H "Content-Type: application/json" \
-d '{"usr-token":"offline-token","SSID":"<WIFI_SSID>","security":"wpa2psk","password":"<WIFI_PASSWORD>","encryption":"AES"}'
```

In **Windows PowerShell**, usa invece questa richiesta equivalente:

```powershell {.terminal-computer}
Invoke-RestMethod -Method Post -Uri 'http://<LOCAL_IP>/credentials' -ContentType 'application/json' -Body (@{ 'usr-token' = 'offline-token'; SSID = '<WIFI_SSID>'; security = 'wpa2psk'; password = '<WIFI_PASSWORD>'; encryption = 'AES' } | ConvertTo-Json -Compress)
```

Su Windows l'output non mostra intestazioni e codice HTTP come `curl -i`: un errore della richiesta viene segnalato da PowerShell. Entrambi gli esempi inviano gli stessi campi; `LOCAL_IP` è l'indirizzo locale della serra, non quello del Raspberry.

Nelle note originali erano presenti anche varianti di chiamata a `/wifi`, **non usate né verificate**. Non le riportiamo come istruzioni eseguibili perché potrebbero avere effetti diversi da quelli attesi.

Se la richiesta va a buon fine, cerca nel router l'indirizzo assegnato alla serra: non è fisso né uguale all'indirizzo della rete temporanea.

Esempio di dati da verificare nel router:

| Dispositivo | Indirizzo MAC | Indirizzo IP |
| :--- | :--- | :--- |
| Linfa Weezy | `<DEVICE_MAC>` | `<SERRA_IP>` |

Ci si può connettere alla serra così:

```bash {.terminal-computer}
ssh root@<SERRA_IP>
```

Inserisci la password root della serra quando richiesta.

> [!WARNING] Attenzione
> La richiesta **può cambiare anche il token** della serra, sostituendolo con `offline-token`. Prima di inviarla, conserva in modo sicuro il token e le impostazioni Wi-Fi originali. Le note originali ipotizzavano di cancellare `/opt/data/token`, `/opt/data/SSID` e `/opt/data/pwd` per tornare alla modalità iniziale: **questo non ripristina i valori precedenti ed è un'ipotesi non verificata come rollback**. Non cancellare quei file basandoti su questa guida.

## Cambiare il token della serra

Con questo comando si deve vedere il token in uso.
Se hai eseguito la richiesta `/credentials` qui sopra, il token potrebbe già essere `offline-token`; altrimenti leggi il valore effettivo prima di decidere se modificarlo.

```bash {.terminal-serra}
hexdump -C /opt/data/token
```

**Risposta attesa:** nella colonna testuale dell'output compare il valore **attualmente salvato**, che non è necessariamente `offline-token`. Offset e spaziatura del dump dipendono dal comando. Il token è un segreto: non pubblicare l'output.

Per ripristinare in seguito **il solo token**, conserva prima il suo valore originale (`<ORIGINAL_DEVICE_TOKEN>`). Il segnaposto non va scritto nel dispositivo.

Solo se hai conservato il token originale e hai deciso di modificarlo, imposta prima il valore fittizio:

```bash {.terminal-serra}
TOKEN="offline-token"
```

Scrivilo nel file e verifica il contenuto:

```bash {.terminal-serra}
printf "%s" "$TOKEN" > /opt/data/token
chmod 600 /opt/data/token
sync
hexdump -C /opt/data/token
```

**Risposta attesa:** `hexdump` mostra `offline-token` nella colonna testuale.

**Nota sui nomi:** `user-token` nella URL e `usr-token` nei CGI sono parametri diversi. Per `/opt/data/token` conta il valore del token, non il nome del parametro.

Per ripristinare **il solo token** originale che hai conservato (non la configurazione Wi-Fi o la password root):

```bash {.terminal-serra}
printf '%s' '<ORIGINAL_DEVICE_TOKEN>' > /opt/data/token
chmod 600 /opt/data/token
sync
```

## Bloccare gli aggiornamenti automatici

Nel prototipo era stato eseguito `chmod 555 /var/update`, insieme a file “sentinella” con permessi `444`, con l'intento di impedire gli aggiornamenti. **Non considerare questa una protezione verificata:** un processo con privilegi root può superare i normali controlli dei permessi Unix; la semplice presenza dei file sentinella non prova che l'aggiornamento fallirà. Creare o alterare quei file potrebbe interferire con la procedura di aggiornamento originale.

Per questo la guida **non propone comandi da eseguire** per bloccare gli aggiornamenti. Se hai già cambiato i permessi, controlla la situazione con `ls -ld /var/update` e confrontala con i permessi originali che avevi annotato. Non presumere che il valore iniziale fosse `755` su ogni firmware. L'eventuale disattivazione degli aggiornamenti richiede un'analisi specifica del processo di update e una prova di ripristino.

---

[Torna all’indice della guida](../index.md).
