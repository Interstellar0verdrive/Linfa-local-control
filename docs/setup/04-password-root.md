# 04 · Impostare la password root

**Percorso guidato:** [Indice dei capitoli](../index.md)

Il controller incluso nel progetto richiede una password root sulla serra, che userà tramite la variabile `SERRA_ROOT_PASSWORD`. Hai già verificato l'accesso alla console nel [passo 03](03-uart.md). La password scelta va conservata localmente e non caricata nella repository.

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

**Prima di proseguire:** Hai impostato e verificato la password root della serra.

[Passo 05 · Configurare la serra per l'uso locale →](05-modifiche-serra.md)

[← Passo 03 · Verificare la console UART](03-uart.md) · [Indice completo](../index.md)
