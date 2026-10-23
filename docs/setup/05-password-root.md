# 05 · Impostare la password root

**Percorso guidato:** [Indice dei capitoli](../index.md)

> [!IMPORTANT] Da sapere prima di iniziare
> Il controller richiede una password root sulla serra, distinta dalla password del Raspberry, sia con UART sia con Wi-Fi. La salverai una sola volta nel file privato dell'utente `pi` con `serra auth save`; non caricarla nella repository.

Hai già verificato l'accesso alla shell della serra via [UART nel passo 04](04-uart.md) oppure via [SSH nel passo 02A](02-wifi.md). Se eri sulla rete temporanea `LINFA_…` e sei arrivato qui **prima del pairing**, torna al passo 02A dopo aver verificato la nuova password.

## Prima di iniziare

**Se usi UART**, collegati al Raspberry via SSH e apri la console della serra con `picocom`:

```bash {.terminal-raspberry}
picocom -b 115200 /dev/ttyUSB0
```

Adatta il nome della porta se necessario ed effettua il login come `root`. **Se usi Wi-Fi**, dal computer o dal Raspberry entra invece con `ssh root@<SERRA_IP>`; usa l'IP attuale della serra sulla rete temporanea o domestica. I comandi seguenti vanno digitati **nella shell della serra**, non in quella del Raspberry o del computer.

## Verifica il dispositivo e imposta la password

Controlla di essere sulla serra: l'architettura del VoCore è MIPS.

```sh {.terminal-serra}
uname -m
```

Se stai ancora usando una password iniziale, debole o riutilizzata, impostane una nuova senza stampare il contenuto di `/etc/shadow`. Se l'avevi già scelta e verificata, non occorre cambiarla di nuovo:

```sh {.terminal-serra}
passwd
```

Il comando chiede di inserirla due volte; mentre digiti non vedrai caratteri sullo schermo. Annota la password in un luogo sicuro. Nel [passo 06](06-controller-cli.md) la salverai sul Raspberry una sola volta per la CLI e i servizi automatici.

Esci dalla shell della serra con `exit`, poi ripeti il login **sullo stesso canale** per verificare la password. Se usi UART, riavvia la serra e verifica che il login funzioni ancora; per uscire da `picocom` premi `Ctrl+A`, poi `Ctrl+X`, lasciando libera la porta per il controller. Se usi Wi-Fi **già isolato**, riavvia con `/sbin/reboot`, attendi che la serra torni sulla LAN, verifica di nuovo SSH e l'assenza della rotta Internet come nel passo 02A. Se sei ancora sulla rete temporanea durante il primo pairing, **non riavviare ancora**: torna al [passo 02A](02-wifi.md#3-prepara-lisolamento-locale-con-wan-scollegata), completa rete e isolamento, poi verifica la persistenza della password dopo quel riavvio.

Se hai usato UART **solo per ottenere l'accesso iniziale** e vuoi poi comandare via Wi-Fi, tieni UART disponibile come recupero e torna al [passo 02A](02-wifi.md) per pairing e isolamento, con la WAN scollegata. Prosegui al passo 06 soltanto dopo aver verificato SSH sulla LAN e assenza della rotta Internet.

---

## Continua il percorso

> [!TIP] Controllo
> **Verifica prima di proseguire:** Conosci e hai verificato la password root della serra sul canale scelto. Se stavi preparando la rete temporanea, torna al passo 02A prima di procedere al 06.

<table width="100%" class="step-nav">
  <tr>
    <td width="50%" align="left"><strong>Passo precedente</strong><br><a href="04-uart.md">← 04 · UART</a><br><a href="02-wifi.md">← 02A · Wi-Fi</a></td>
    <td width="50%" align="right"><strong>Passo successivo</strong><br><a href="06-controller-cli.md">06 · Installare il controller CLI →</a></td>
  </tr>
</table>
