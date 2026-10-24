# 02A · Primo accesso via Wi-Fi

**Percorso guidato:** [Indice dei capitoli](../index.md) · [Preferisci USB?](02-hardware.md)

Qui prepari la **rete locale della serra** e provi a entrare nella sua shell via SSH, senza aprirla. Comandi e foto passeranno poi tra Raspberry e serra sulla LAN; gli stati MQTT sono ricostruiti dal controller sul Raspberry. Home Assistant continuerà a parlare solo con il broker MQTT. Sul mio esemplare già modificato ho verificato SSH, comandi, foto e isolamento da Internet anche dopo un riavvio. **Non ho verificato le credenziali SSH di una serra originale:** se il login iniziale non riesce, [scegli il collegamento USB](02-hardware.md), anche se vorrai usare il Wi-Fi in seguito.

> [!IMPORTANT] Prima di iniziare
> Tieni pronti un computer con SSH e Python 3 e accesso al pannello del router; il Raspberry sarà preparato nel passo 03. Scarica la repository sul computer **prima** di scollegare Internet, tramite **Code → Download ZIP** nella pagina GitHub, poi estraila: ti servirà `tools/pair_linfa_wifi.py` soltanto se devi ripetere il pairing. Annota le impostazioni che cambi. Durante il primo collegamento alla rete domestica, **scollega fisicamente la WAN/Internet dal router** e lascia attive la rete locale e l'alimentazione della serra. Non fare affidamento sul solo token fittizio per bloccare Internet.

> [!WARNING] Limite di recupero
> Senza collegamento USB non è stata verificata una procedura di recupero se la serra smette di accettare SSH o non torna sulla rete dopo una modifica. Leggi ogni sezione prima di applicarla; se file o risposte sono diversi da quelli descritti, fermati e passa al [collegamento USB](02-hardware.md).

La serra e il Raspberry devono essere nella **stessa sottorete IPv4** e potersi raggiungere direttamente: la configurazione qui sotto toglie alla serra la rotta verso altre reti. Una rete ospiti che isola i dispositivi tra loro, o una VLAN diversa, non è adatta a questi comandi senza una configurazione di routing ulteriore.

## 1. Cerca la serra sulla rete domestica

Se la serra era già associata al Wi-Fi di casa, trova il suo indirizzo IP nell'elenco dispositivi o DHCP del router. Con la WAN scollegata, dal **terminale del computer** prova:

```text {.terminal-computer}
ssh root@<SERRA_IP>
```

L'indirizzo `<SERRA_IP>` è quello della **serra**, non del Raspberry. Confronta la chiave host mostrata al primo accesso con quella che hai già registrato, se disponibile; se SSH segnala che una chiave nota è cambiata, non ignorare l'avviso. Accedi come `root`: se hai già una password per la tua serra, usa quella. Su una serra originale puoi fare **un tentativo con `vocore`**, password indicata dal [produttore per il VoCore2 con firmware standard](https://vocore.io/v2.html), **non confermata per il firmware Robonica**. Puoi anche provare una volta a premere Invio senza digitare nulla, ma sul mio firmware SSH non accettava password vuote. Evita ulteriori password casuali. Se il login funziona, resta nella shell della serra e vai alla [verifica del firmware](#2-verifica-il-firmware-e-conserva-il-token). Se non funziona, passa a [02B · Collegamento USB](02-hardware.md): il reset fisico sul mio esemplare non ha cancellato la password root.

## Se la serra non è sulla rete: access point temporaneo

La procedura originale mostrava una rete `LINFA_…` per il pairing. Sul mio esemplare è comparsa dopo il reset **e dopo aver riattivato la radio tramite la console USB**, perché l'avevo disabilitata in precedenza. Una serra originale potrebbe comportarsi diversamente.

1. Con la WAN ancora scollegata, cerca sul computer o sul telefono una rete `LINFA_…`. Se compare, connettiti e annota indirizzo IP e gateway assegnati. Sul firmware provato la serra rispondeva a `192.168.247.1`, ma non assumere che valga per ogni variante.
2. Se non compare e la serra era già configurata, valuta il pulsante di reset **solo dopo aver letto questa avvertenza**: sul mio esemplare una pressione prolungata fino al lampeggio bianco ha cancellato i dati di pairing, ripristinato file del software originale e riavviato la serra. Non è un semplice «reset del Wi-Fi». Senza backup potresti perdere impostazioni che non sai ricostruire. Se accetti questo effetto, usa la procedura del [video originale](https://www.youtube.com/watch?v=fwavCyGuwOw), una sola volta, e attendi la rete `LINFA_…`; se non appare, passa al collegamento USB.
3. Collegato alla rete temporanea, prova dal **terminale del computer** `ssh root@<IP_AP_SERRA>` usando come IP il gateway osservato (nell'esemplare provato, `192.168.247.1`). Se non hai una password nota, limita i tentativi a `vocore` e alla password vuota, come [spiegato sopra](#1-cerca-la-serra-sulla-rete-domestica). Questa prova **deve riuscire prima** di trattare il Wi-Fi come percorso senza apertura. Se SSH non è disponibile o rifiuta entrambi i tentativi, passa al collegamento USB; ripetere il reset non cambierà necessariamente le credenziali.

> [!NOTE] Aiutami a verificare il primo accesso
> Se riesci a entrare **via SSH su una Linfa mai modificata**, [apri una issue su GitHub](https://github.com/Interstellar0verdrive/Linfa-local-control/issues/new) indicando modello, versione firmware (se visibile), se eri sulla rete `LINFA_…` o sulla LAN e se ha funzionato `vocore`, una password vuota o una credenziale già nota a te. **Non pubblicare password personali, token o schermate che li mostrano.** Il tuo riscontro mi permetterà di aggiornare questa guida.

## 2. Verifica il firmware e conserva il token

Ora sei nella **shell della serra**, raggiunta via SSH dalla LAN o dalla sua rete temporanea. Controlla prima di modificare:

```sh {.terminal-serra}
uname -m
ls -l /etc/init.d/S45net /usr/share/udhcpc/default.script 2>&1
grep -n 'udhcpc' /etc/init.d/S45net
grep -n 'default.script.d' /usr/share/udhcpc/default.script
ls -l /opt/data/token 2>&1
```

Sul firmware provato `uname -m` indica `mips`, `S45net` esiste e contiene **una sola** riga `udhcpc -b -p /var/run/udhcpc.pid -i apcli0` (senza `-s`); `default.script` esegue gli script in `default.script.d`. Se la struttura è diversa, **non applicare i comandi seguenti**: documenta la variante e usa il collegamento USB per indagarla. Se il token esiste, conservalo in un luogo privato prima del pairing: puoi leggerlo nella tua sessione con `cat /opt/data/token`, ma non copiarlo in issue o screenshot. **Dopo il reset il file può mancare**: sul mio esemplare `/opt/data` era vuota. Il CGI `/credentials` esaminato accetta e salva qualsiasi token non vuoto; in tal caso scegli un nuovo valore privato per la tua serra e conservalo. Non riutilizzare un token condiviso come `offline-token`.

Se devi generarne uno, dal **terminale del computer** puoi usare `python3 -c "import secrets; print(secrets.token_urlsafe(24))"` (su Windows, `py -3 -c "import secrets; print(secrets.token_urlsafe(24))"`). Salva il valore in un gestore di password, poi inseriscilo quando lo script di pairing lo chiede. **Non è la password root SSH**: cambiarlo non dà accesso alla shell.

Puoi già [impostare la tua password root nel passo 05](05-password-root.md) tramite questa shell; poi torna qui per l'isolamento e il pairing. Se hai appena provato SSH con una password già scelta da te, il passo 05 servirà a verificarla.

## 3. Prepara l'isolamento locale, con WAN scollegata

Questi comandi sono per la **shell root della serra** e sono stati verificati sulla struttura del firmware del mio esemplare. Il primo script impedisce al client DHCP di installare il gateway; il secondo elimina un eventuale gateway comparso durante `bound` o `renew`. La serra conserva così l'accesso agli indirizzi della propria sottorete. Il blocco del router, se disponibile, può aggiungere una protezione indipendente.

Verifica che la riga da cambiare sia presente **una sola volta** e crea una copia dello script iniziale, fuori da `/etc/init.d`:

```sh {.terminal-serra}
test "$(grep -Fxc '  udhcpc -b -p /var/run/udhcpc.pid -i apcli0' /etc/init.d/S45net)" -eq 1 && echo 'OK: una sola riga DHCP originale'
test ! -e /usr/share/udhcpc/linfa-udhcpc-local-only.script && test ! -e /usr/share/udhcpc/default.script.d/99-linfa-local-only && echo 'OK: nessuno script locale preesistente'
test ! -e /root/S45net.linfa.bak && cp -p /etc/init.d/S45net /root/S45net.linfa.bak && echo 'OK: backup creato'
```

**Risposta attesa:** tutti e tre i messaggi `OK`. Se ne manca uno, **fermati**: non sovrascrivere file esistenti e non adattare alla cieca uno script diverso.

```sh {.terminal-serra}
cat > /usr/share/udhcpc/linfa-udhcpc-local-only.script <<'EOF'
#!/bin/sh
router=
export router
exec /usr/share/udhcpc/default.script "$@"
EOF
chmod 755 /usr/share/udhcpc/linfa-udhcpc-local-only.script
mkdir -p /usr/share/udhcpc/default.script.d
cat > /usr/share/udhcpc/default.script.d/99-linfa-local-only <<'EOF'
#!/bin/sh
case "$1" in
    bound|renew)
        [ "$interface" = "apcli0" ] || exit 0
        while /sbin/route del default dev "$interface" 2>/dev/null; do :; done
        ;;
esac
exit 0
EOF
chmod 755 /usr/share/udhcpc/default.script.d/99-linfa-local-only
```

Prepara lo script di avvio **fuori** da `/etc/init.d` (un file chiamato `S45net.bak` lì potrebbe essere eseguito al boot). Controlla che l'unica differenza sia l'aggiunta di `-s`:

```sh {.terminal-serra}
sed 's@^  udhcpc -b -p /var/run/udhcpc.pid -i apcli0$@  udhcpc -b -p /var/run/udhcpc.pid -i apcli0 -s /usr/share/udhcpc/linfa-udhcpc-local-only.script@' /root/S45net.linfa.bak > /root/S45net.linfa.new
grep -n 'udhcpc' /root/S45net.linfa.new
sed 's@ -s /usr/share/udhcpc/linfa-udhcpc-local-only.script$@@' /root/S45net.linfa.new | cmp - /root/S45net.linfa.bak && echo 'OK: solo il client DHCP è cambiato'
```

**Risposta attesa:** la riga `udhcpc` termina con il percorso del nuovo script e compare `OK: solo il client DHCP è cambiato`. Solo in quel caso installa il file e sincronizza:

```sh {.terminal-serra}
chmod 755 /root/S45net.linfa.new
test "$(grep -Fxc '  udhcpc -b -p /var/run/udhcpc.pid -i apcli0 -s /usr/share/udhcpc/linfa-udhcpc-local-only.script' /root/S45net.linfa.new)" -eq 1 && sed 's@ -s /usr/share/udhcpc/linfa-udhcpc-local-only.script$@@' /root/S45net.linfa.new | cmp - /root/S45net.linfa.bak && mv /root/S45net.linfa.new /etc/init.d/S45net && sync && echo 'OK: avvio aggiornato'
```

**Risposta attesa:** `OK: avvio aggiornato`. Se manca, non procedere al pairing. Il file modificato sarà usato al **prossimo avvio della radio**: non considerare ancora isolata una connessione Wi-Fi già attiva.

## 4. Associa la rete domestica, se necessario

Se sei già sulla LAN domestica, **salta il pairing**: con WAN scollegata, riavvia la serra con `/sbin/reboot`, ricollegati via SSH al suo IP dopo l'avvio e passa alla verifica. Il riavvio fa usare il nuovo script DHCP. Se non torna raggiungibile, usa il collegamento USB per recuperare; non ricollegare ancora la WAN.

Se sei sulla rete temporanea `LINFA_…`, il metodo locale verificato usa `POST /credentials`. Dopo aver conservato il token originale, se presente, oppure scelto un nuovo valore privato non vuoto, esci dalla shell SSH della serra; **dal computer ancora connesso alla rete temporanea**, entra nella cartella della repository scaricata prima e avvia:

```text {.terminal-computer}
python3 tools/pair_linfa_wifi.py --host <IP_AP_SERRA>
```

Su Windows, con Python installato, usa `py -3 tools/pair_linfa_wifi.py --host <IP_AP_SERRA>`. Il programma chiede SSID, password Wi-Fi e token privato senza metterli nella riga di comando. Puoi reinserire l'originale, se lo hai salvato, oppure un valore nuovo non vuoto; il CGI osservato non verifica il token contro un server prima di salvarlo. **La scelta di un token nuovo non è stata provata su una serra originale.** La rete temporanea osservata è aperta e la richiesta locale usa HTTP: eseguila solo in un ambiente sotto il tuo controllo. Abbiamo provato l'endpoint sul firmware del prototipo; su altre versioni potrebbe differire. La richiesta può far riavviare la radio **prima di inviare la risposta HTTP**: se il programma segnala un'interruzione, cerca prima la serra nell'elenco DHCP del router e **non ripetere subito** il pairing. L'app originale offriva una procedura guidata equivalente, ma la sua disponibilità attuale non è verificata.

Ricollega il computer alla rete domestica, individua il nuovo `<SERRA_IP>` sul router e prova `ssh root@<SERRA_IP>` con la password appena verificata. Se il login non riesce, lascia la WAN scollegata e usa il collegamento USB per recuperare.

## 5. Verifica LAN sì, Internet no

Nella **shell della serra** dopo l'avvio o il pairing:

```sh {.terminal-serra}
/sbin/ifconfig apcli0
cat /proc/net/route
if [ -r /proc/net/ipv6_route ]; then awk '$1 == "00000000000000000000000000000000" && $2 == "00" {print}' /proc/net/ipv6_route; fi
```

L'interfaccia `apcli0` deve avere un IP della tua LAN. In `/proc/net/route` deve esserci la sottorete locale, **senza** una riga con `Destination` pari a `00000000`: quella sarebbe una rotta predefinita. L'ultima verifica non deve stampare rotte IPv6 predefinite. Se trovi una rotta predefinita IPv4 o IPv6, **non ricollegare la WAN**. Verifica anche che la serra raggiunga un altro dispositivo della LAN, per esempio il router:

```sh {.terminal-serra}
ping -c 1 -W 2 <ROUTER_IP>
```

Quando LAN e assenza delle rotte esterne sono confermate, ricollega la WAN. Dal computer verifica che Internet funzioni; dalla serra ripeti la lettura delle rotte e prova `ping -c 1 -W 2 1.1.1.1`: sul prototipo la risposta era `Network unreachable`. Un semplice timeout **non** equivale a isolamento verificato. Sul prototipo il Wi-Fi e l'isolamento sono rimasti attivi dopo un riavvio; un rinnovo DHCP ha causato una breve interruzione della LAN, poi recuperata.

> [!TIP] Preferisci il percorso USB?
> Anche se SSH funziona, puoi scegliere [02B · Collegamento USB](02-hardware.md) e tenere il cavo come canale permanente. Se colleghi entrambi, nel passo 07 potrai scegliere una precedenza; il controller non ripete sull'altro canale un comando dal risultato incerto.

## Continua il percorso

> [!TIP] Controllo
> **Verifica prima di proseguire:** puoi entrare via SSH come root, conosci la password, la serra raggiunge la LAN e non ha una rotta verso Internet anche dopo il riavvio. Se il primo SSH non è riuscito, continua da [02B · Collegamento USB](02-hardware.md).

<table width="100%" class="step-nav">
  <tr>
    <td width="50%" align="left"><strong>Passo precedente</strong><br><a href="01-panoramica.md">← 01 · Panoramica e obiettivi</a></td>
    <td width="50%" align="right"><strong>Passo successivo</strong><br><a href="03-raspberry.md">03 · Preparare il Raspberry Pi →</a></td>
  </tr>
</table>
