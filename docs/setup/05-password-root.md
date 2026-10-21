# 05 · Impostare la password root

**Percorso guidato:** [Indice dei capitoli](../index.md)

> [!IMPORTANT] Da sapere prima di iniziare
> Il controller richiede una password root sulla serra, da usare tramite `SERRA_ROOT_PASSWORD`. Questa è distinta dalla password del Raspberry: conservala localmente e non caricarla nella repository.

Hai già verificato l'accesso alla console nel [passo 04](04-uart.md).

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
```

Imposta una nuova password senza stampare in terminale il contenuto di `/etc/shadow`:

```sh
passwd
```

Il comando chiede di inserirla due volte; mentre digiti non vedrai caratteri sullo schermo. Annota la password in un luogo sicuro. Ti servirà nel [passo 06](06-controller-cli.md) per la prova della CLI e nel [passo 07](07-bridge-mqtt.md) per `/etc/serra-mqtt.env`.

Esci dalla shell della serra con `exit`, poi ripeti il login dalla console UART per verificare la nuova password. Riavvia la serra e verifica che il login funzioni ancora: la password deve essere persistente prima di configurare i servizi automatici. Per uscire da `picocom` sul Raspberry usa `Ctrl+A`, poi `Ctrl+X`; lascia la porta libera per il controller.

---

## Continua il percorso

> [!TIP] Controllo
> **Verifica prima di proseguire:** Hai impostato e verificato la password root della serra.

<table width="100%" class="step-nav">
  <tr>
    <td width="50%" align="left"><strong>Passo precedente</strong><br><a href="04-uart.md">← 04 · Verificare la console UART</a></td>
    <td width="50%" align="right"><strong>Passo successivo</strong><br><a href="06-controller-cli.md">06 · Installare il controller CLI →</a></td>
  </tr>
</table>
