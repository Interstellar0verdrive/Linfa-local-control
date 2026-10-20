# 03 · Verificare la console UART

**Percorso guidato:** [Indice dei capitoli](../index.md)

Prima di eseguire **qualsiasi comando di controllo**, script o policy, è fondamentale verificare che il collegamento UART tra Raspberry e serra funzioni correttamente.

Questa verifica:

- non modifica nulla sulla serra
- non dipende dalla rete Wi-Fi
- è il metodo più affidabile per diagnosticare problemi futuri

---

## Apertura console UART con picocom

Dal Raspberry, collegato via SSH:

```bash
picocom -b 115200 /dev/ttyUSB0
```

Note:

- 115200 è il baudrate corretto per la console VoCore2
- il device può essere `/dev/ttyUSB0` o `/dev/ttyUSB1` a seconda dell’adattatore
- se il comando rimane “vuoto”, **accendere o riavviare la serra**

Durante il boot della serra dovresti vedere:

- log del kernel
- inizializzazione BusyBox
- messaggio finale simile a: `Welcome to Buildroot`

Se vedi il boot, la UART è **correttamente cablata e funzionante**.

---

## Login sulla serra via UART

Comportamento atteso:

- Riavviando la serra si vede il boot log
- A fine boot compare:

    `Welcome to Buildroot`

- Login:
    - user: `root`
    - password: quella di default dovrebbe essere vuota, oppure: `vocore`

⚠️ Nota: più avanti nella guida cambiamo la password della serra con una custom, nel mio caso: `<DEVICE_PASSWORD>`

Alla richiesta di login, inserire `root`

Password: Se la serra non è stata ancora modificata: lasciare vuoto (premere solo INVIO) o provare `vocore`. Se la password è già stata cambiata: `<DEVICE_PASSWORD>`

Se il login va a buon fine, ci si trova **dentro la serra**, senza passare da Wi-Fi o cloud.

> [!CAUTION]
> La console dà accesso root diretto alla serra. In questo passo usa solo i comandi di verifica e non modificare i file di sistema.

---

## Comandi minimi di verifica

Una volta loggati, eseguire solo comandi **non distruttivi**:

```bash
uname -a
# Deve restituire qualcosa tipo:
# Linux buildroot 3.18.29 #1 Thu May 16 10:06:29 UTC 2019 mips GNU/Linux
```

Verifica:

- kernel Linux (3.18.x)
- architettura MIPS (VoCore2)

```bash
uptime
# Deve restituire qualcosa tipo:
# 09:06:53 up  1:24,  0 users,  load average: 0.03, 0.02, 0.05
```

Serve per:

- confermare che la shell risponde correttamente
- verificare eventuali reboot inattesi

```bash
ls /
# Deve restituire qualcosa tipo:
# bin      etc      lib32    media    opt      root     sbin     tmp      var
# dev      lib      linuxrc  mnt      proc     run      sys      usr
```

Controllo rapido della struttura filesystem (rootfs minimale BusyBox).

⚠️ **Non modificare nulla in questa fase.**

Questa sezione serve solo a confermare che:

- UART funziona
- console è stabile
- credenziali sono corrette

---

## Uscita da picocom

Per uscire correttamente:

```
CTRL + A
CTRL + X
```

Se la console non risponde:

- verifica di non aver perso il focus
- in casi estremi, chiudi la sessione SSH

---

## Stato atteso al termine

- ✅ UART funzionante
- ✅ Accesso root verificato
- ✅ Nessuna modifica persistente sulla serra
- ✅ Pronti per il controllo esterno via Raspberry

Nel passo 04 userai ancora la console per impostare la password root della serra. Poi il controller sul Raspberry invierà i comandi via UART.

---

## Continua il percorso

> [!TIP]
> **Verifica prima di proseguire:** La console risponde, puoi effettuare il login e il comando di prova funziona.

<table width="100%" class="step-nav">
  <tr>
    <td width="50%" align="left"><strong>Passo precedente</strong><br><a href="02-raspberry.md">← 02 · Preparare il Raspberry Pi</a></td>
    <td width="50%" align="right"><strong>Passo successivo</strong><br><a href="04-password-root.md">04 · Impostare la password root →</a></td>
  </tr>
</table>
