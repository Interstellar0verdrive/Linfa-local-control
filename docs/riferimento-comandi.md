# Riferimento comandi

**Percorso guidato:** [Indice dei capitoli](index.md) · [Installazione controller](setup/06-controller-cli.md) · [Collegamento Home Assistant](setup/09-home-assistant.md)

Questa pagina riordina l'[help della CLI](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/serra_help.txt) e mostra, per ogni azione, il comando equivalente da inviare tramite l'integrazione **MQTT di Home Assistant**. I comandi funzionano dopo aver completato il percorso guidato. L'app completa per Home Assistant è ancora in test e non è inclusa nella repository: i payload qui sotto si inviano dalla funzione **Pubblica un pacchetto** dell'integrazione MQTT oppure da un'automazione MQTT.

## Come leggere le tabelle

Sul Raspberry esegui l'intera riga che inizia con `serra`. In Home Assistant pubblica **solo il payload**, senza il prefisso `serra`, sul topic `serra/cmd`. Se hai modificato `SERRA_MQTT_TOPIC`, sostituisci `serra` con il tuo topic base. **Retain deve essere disattivato per tutti i comandi**, così un messaggio non viene ripetuto quando il bridge si riconnette.

| Dove | Topic | Testo da inviare |
| --- | --- | --- |
| Raspberry | — | `serra lights on -i 80 -f 15` |
| Home Assistant · MQTT | `serra/cmd` | `lights on -i 80 -f 15` |

Nelle tabelle, le parti tra `<…>` sono valori da sostituire. Le opzioni tra parentesi quadre sono facoltative. Le opzioni lunghe (`--intensity`) e brevi (`-i`) sono equivalenti.

## Luci

| Azione | Raspberry | Payload Home Assistant |
| --- | --- | --- |
| Accendere tutti i LED | `serra lights on [-i 0..100] [-f secondi]` | `lights on [-i 0..100] [-f secondi]` |
| Spegnere tutti i LED | `serra lights off [-f secondi]` | `lights off [-f secondi]` |
| Impostare un canale | `serra lights set <A/G/B/R/D> [-i 0..100] [-f secondi]` | `lights set <A/G/B/R/D> [-i 0..100] [-f secondi]` |

`-i, --intensity` imposta l'intensità percentuale, da `0` a `100` (predefinito `100`). `-f, --fade` indica la durata **approssimata** della dissolvenza in secondi (predefinito `0`). `lights off` non accetta `-i`.

| Canale | LED controllati |
| --- | --- |
| `A` | Tutti, spettro completo |
| `G` | Verdi |
| `B` | Blu e bianchi |
| `R` | Prima metà dei rossi |
| `D` | Seconda metà dei rossi |

Per esempio, `lights set G -i 0` spegne solo il canale verde.

## Ventole

| Azione | Raspberry | Payload Home Assistant |
| --- | --- | --- |
| Accendere tutte | `serra fans on [-i livello]` | `fans on [-i livello]` |
| Spegnere tutte | `serra fans off` | `fans off` |
| Impostarne una o tutte | `serra fans set <1/2/F/all> [-i livello]` | `fans set <1/2/F/all> [-i livello]` |

`1` e `2` identificano le prime due ventole; `F` è quella frontale. I livelli per `-i, --intensity` sono `off` (0%), `low` (circa 50%), `medium` (circa 75%, predefinito) e `high` (100%). Quando chiedi `low` o `medium`, il controller esegue prima un breve avvio al 100%: sotto circa il 40% una ventola ferma potrebbe non partire.

## Pompe

| Azione | Raspberry | Payload Home Assistant |
| --- | --- | --- |
| Avviare la pompa principale | `serra pump main on [-s secondi]` | `pump main on [-s secondi]` |
| Fermare subito la pompa principale | `serra pump main off` | `pump main off` |
| Azionare una pompa nutrienti | `serra pump nutrient <0/1/2> [-s secondi] [-t volte] [-i pausa]` | `pump nutrient <0/1/2> [-s secondi] [-t volte] [-i pausa]` |

Per la pompa principale `-s, --seconds` vale **1 secondo** per impostazione predefinita ed è convertito a un numero intero; il limite tecnico è 300 secondi. Durate di 30 secondi o più sono già elevate: usa tempi brevi durante le prove. `pump main off` invia lo stop immediato.

Per le pompe nutrienti `-s, --seconds` è la durata di una singola erogazione (predefinito `1`), `-t, --times` il numero di ripetizioni (predefinito `1`, massimo `100`) e `-i, --interval` la pausa fra ripetizioni (predefinito `1` secondo, massimo `120`). Il limite tecnico per una singola erogazione è **300 secondi**, ma il dosaggio reale dipende dalla pompa, dal liquido e dal circuito: calibra con tempi piccoli prima di usarla sulle piante. Non esiste un'azione `pump nutrient off` nella CLI: ogni impulso viene inviato con la durata richiesta.

| ID | Gocciolatore nel prototipo |
| --- | --- |
| `0` | Destra, vasetto verde |
| `1` | Centro, vasetto azzurro |
| `2` | Sinistra, vasetto rosso |

## LED ring

| Azione | Raspberry | Payload Home Assistant |
| --- | --- | --- |
| Accendere | `serra ring on [-c colore] [-f secondi]` | `ring on [-c colore] [-f secondi]` |
| Spegnere | `serra ring off [-f secondi]` | `ring off [-f secondi]` |
| Lampeggiare | `serra ring blink [-c colore] [-t volte] [-f secondi] [-d durata] [-i pausa]` | `ring blink [-c colore] [-t volte] [-f secondi] [-d durata] [-i pausa]` |

`-c, --color` accetta `white`, `red`, `green`, `yellow`, `orange`, `blue`, `purple`, `off` oppure un codice esadecimale RGB di sei cifre, per esempio `F90023`. Il predefinito è `white`. `-f, --fade` è la dissolvenza approssimata in secondi (predefinito `0`). Per `blink`, `-t, --times` indica i lampeggi (predefinito `5`, massimo `100`), `-d, --duration` la durata accesa (predefinito `1` secondo, massimo `60`) e `-i, --interval` la pausa spenta (predefinito `1` secondo, massimo `10`). La sequenza `blink` resta in esecuzione fino al termine dei cicli.

## Checkup, rete e stato

| Azione | Raspberry | Payload Home Assistant |
| --- | --- | --- |
| Testare i componenti | `serra checkup [opzioni]` | `checkup [opzioni]` |
| Disattivare la rete della **serra** | `serra net off [-n on/off]` | `net off [-n on/off]` |
| Riattivare la rete della **serra** | `serra net on [-n on/off]` | `net on [-n on/off]` |
| Ricalcolare e ripubblicare gli stati | `serra state sync` | `state sync` |

Il **checkup è intrusivo**: sovrascrive le impostazioni correnti e termina con i componenti spenti. Puoi escludere gruppi dal test con `-l, --lights`, `-f, --fans`, `-lr, --led-ring`, `-pm, --pump-main` e `-pn, --pump-nutrients`: ogni opzione accetta `on` (predefinito) o `off`. Per esempio, `checkup -pm off -pn off` non prova le pompe.

`net on/off` agisce sul **VoCore della serra**, non sulla rete del Raspberry. `-n, --ntp on/off` permette di forzare NTP; senza opzione, NTP segue l'azione di rete. `net on` non è permanente: un riavvio o la policy automatica possono disattivare di nuovo la rete.

`state sync` aggiorna i timer e ripubblica su `serra/state/*` gli **stati logici attesi**. Non interroga i sensori della serra per confermare lo stato fisico delle ventole, delle luci o delle pompe.

## Topic MQTT, esito e conferma

| Topic | Uso |
| --- | --- |
| `serra/cmd` | Invia il payload testuale della tabella, senza conferma dedicata. |
| `serra/cmd/<id>` | Invia lo stesso payload e ricevi una risposta su `serra/ack/<id>`. Scegli un ID diverso per ogni comando. |
| `serra/cmd/json` | Invia un payload JSON senza ack dedicato. |
| `serra/cmd/json/<id>` | Come sopra, ma con payload JSON: `{"cmdline":"lights on"}` oppure `{"cmd":["lights","on"]}`. |
| `serra/status/last` | Ultimo esito del bridge: `ok`, codice di uscita `rc`, comando e messaggi. |
| `serra/status/online` | Stato di connessione del bridge al broker. |
| `serra/status/last_seen` | Ultima attività nota pubblicata dal bridge o dal controller. |
| `serra/state/*` | Ultimi stati logici pubblicati dal controller, retained. |

Gli ID e gli ack sono facoltativi. Per un comando semplice in Home Assistant bastano topic `serra/cmd`, payload `lights on` e **retain disattivato**. Per vedere i risultati, usa **Ascolta un topic** su `serra/#`, come spiegato nel [capitolo 09](setup/09-home-assistant.md#prova-senza-installare-altri-strumenti).

> [!NOTE] Fonte dei comandi
> La sintassi viene dal [parser del controller](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/serra_controller.py) e dall'[help testuale](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/serra_help.txt); i formati dei topic vengono dal [bridge MQTT](https://github.com/Interstellar0verdrive/Linfa-local-control/blob/main/bridge/serra_mqtt_bridge.py). Se aggiorni gli script, verifica anche questa pagina.
