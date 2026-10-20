# 04 · Impostare la password root

**Percorso guidato:** [Indice dei capitoli](../index.md)

> [!IMPORTANT]
> Il controller richiede una password root sulla serra, da usare tramite `SERRA_ROOT_PASSWORD`. Questa è distinta dalla password del Raspberry: conservala localmente e non caricarla nella repository.

Hai già verificato l'accesso alla console nel [passo 03](03-uart.md).

## Prima di iniziare

Collegati al **Raspberry Pi** via SSH e apri la console della **serra** con `picocom`:

```bash
picocom -b 115200 /dev/ttyUSB0
```

Adatta il nome della porta se necessario. Effettua il login come `root` sulla serra. I comandi seguenti vanno digitati **nella shell della serra aperta in picocom**, non nella shell del Raspberry.

## Verifica il dispositivo e imposta la password

Controlla di essere sulla serra: l'architettura del VoCore è MIPS.

```sh
uname -m
grep '^root:' /etc/shadow || grep '^root:' /etc/passwd
```

Se l'account root non ha ancora una password, il campo della password può risultare vuoto. Imposta una nuova password:

```sh
passwd
```

Il comando chiede di inserirla due volte; mentre digiti non vedrai caratteri sullo schermo. Annota la password in un luogo sicuro. Ti servirà nel [passo 07](07-controller-cli.md) per la prova della CLI e nel [passo 08](08-bridge-mqtt.md) per `/etc/serra-mqtt.env`.

Chiudi la sessione della serra e ripeti il login dalla console UART per verificare la nuova password. Per uscire da `picocom` sul Raspberry usa `Ctrl+A`, poi `Ctrl+X`.

---

## Continua il percorso

> [!TIP]
> **Verifica prima di proseguire:** Hai impostato e verificato la password root della serra.

<table width="100%" class="step-nav">
  <tr>
    <td width="50%" align="left"><strong>Passo precedente</strong><br><a href="03-uart.md">← 03 · Verificare la console UART</a></td>
    <td width="50%" align="right"><strong>Passo successivo</strong><br><a href="05-modifiche-serra.md">05 · Configurare la serra per l&#x27;uso locale →</a></td>
  </tr>
</table>
