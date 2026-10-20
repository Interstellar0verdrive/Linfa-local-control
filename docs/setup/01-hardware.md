# 01 · Hardware e collegamenti

## La serra Linfa Weezy

La serra è basata su un **VoCore2**, un piccolo modulo con CPU MIPS e Linux personalizzato (kernel 3.18 e BusyBox). Gestisce direttamente il pannello LED, le ventole, la pompa principale, le tre pompe dei nutrienti, l’anello LED RGB e la rete Wi-Fi integrata.

<div class="info-grid" markdown="1">
<div class="info-card" markdown="1">
<span class="card-icon" aria-hidden="true">⌘</span>
**Console seriale**

Il modulo espone una console root via UART, usata per comunicare con il Raspberry.
</div>
<div class="info-card" markdown="1">
<span class="card-icon" aria-hidden="true">◇</span>
**Firmware invariato**

Il progetto non modifica il firmware: i comandi sono eseguiti durante il funzionamento.
</div>
</div>

> [!NOTE] Comportamento originale
> Il funzionamento originale, cloud incluso, può essere ripristinato **ripristinando il token e i permessi di `/var/update`**. Quando il controllo locale è in uso, il Raspberry disabilita attivamente la Wi-Fi della serra: è una policy esterna, non una modifica permanente alla configurazione stock del VoCore.

Per i dettagli sul modulo: [specifiche VoCore2](https://vocore.io/v2.html).

## Il Raspberry Pi

Il Raspberry Pi è il **controller esterno** e il punto di integrazione con MQTT e Home Assistant. Può collegarsi alla rete domestica tramite Ethernet o Wi-Fi.

<div class="spec-card" markdown="1">
<div markdown="1"><span>MODELLO USATO</span>**Raspberry Pi 3B**<small>Altri modelli con USB standard, come 3B+, 4 o Zero 2 W, sono utilizzabili.</small></div>
<div markdown="1"><span>MEMORIA</span>**microSD ≥ 16 GB**<small>Capacità consigliata per il sistema operativo.</small></div>
<div markdown="1"><span>SISTEMA</span>**Raspberry Pi OS**<small>Versione Lite consigliata.</small></div>
</div>

### Il suo ruolo nel sistema

- Comunica con la serra via USB → UART.
- Esegue la CLI `serra` e il bridge MQTT.
- Applica le policy, come la disabilitazione della Wi-Fi della serra all’avvio.
- Pubblica stati e comandi su MQTT.

## L’adattatore USB → TTL

Per accedere alla console UART del VoCore serve un adattatore seriale **a livelli logici di 3,3 V**. Sono comunemente usati FTDI FT232RL / FT232-AZ, Silicon Labs CP2102 / CP2104 e CH340 / CH341.

<div class="requirement-strip"><span class="requirement-label">REQUISITI ESSENZIALI</span><span>3,3 V TTL</span><span>TX</span><span>RX</span><span>GND</span><span class="struck">VCC non collegato</span></div>

> [!CAUTION] Non alimentare il VoCore dall’adattatore
> L’adattatore serve soltanto per la comunicazione seriale. **Non collegare VCC** e non usare livelli logici a 5 V: il VoCore non li tollera.

## Cablaggio UART

Collega la massa in comune e **incrocia TX con RX**. Verifica sempre i pin sulla tua scheda prima di collegare l’adattatore.

<div class="wiring-card" aria-label="Collegamenti tra adattatore USB TTL e serra">
  <div class="wiring-head"><span>ADATTATORE USB → TTL</span><span>SERRA · VOCORE2</span></div>
  <div class="wiring-row"><span><b>TX</b></span><span class="wire-line" aria-hidden="true">↗</span><span><b>RX</b></span></div>
  <div class="wiring-row"><span><b>RX</b></span><span class="wire-line" aria-hidden="true">↘</span><span><b>TX</b></span></div>
  <div class="wiring-row"><span><b>GND</b></span><span class="wire-line" aria-hidden="true">⟶</span><span><b>GND</b></span></div>
  <div class="wiring-row is-disconnected"><span><b>VCC</b></span><span class="wire-line" aria-hidden="true">×</span><span><b>NON COLLEGARE</b></span></div>
</div>

<div class="serial-settings"><span><small>VELOCITÀ</small><strong>115200 baud</strong></span><span><small>FORMATO</small><strong>8N1</strong></span><span><small>LIVELLI LOGICI</small><strong>3,3 V TTL</strong></span></div>

<div class="photo-grid" markdown="1">
<figure markdown="1">

![Modulo VoCore montato sulla scheda della serra, con i tre fili della connessione seriale](../assets/vocore-wiring.jpg)

<figcaption><span>01</span><strong>Pin seriali sulla serra</strong><small>Con il VoCore a destra, i pin da destra a sinistra sono GND, RX e TX. Verificali sulla tua scheda.</small></figcaption>
</figure>
<figure markdown="1">

![Adattatore USB TTL con i fili collegati ai pin seriali](../assets/uart-adapter.jpg)

<figcaption><span>02</span><strong>Adattatore USB → TTL</strong><small>GND va a GND; TX e RX vanno incrociati rispetto al VoCore.</small></figcaption>
</figure>
</div>

## Verifica la porta seriale

Una volta collegato l’adattatore al Raspberry, il dispositivo compare di solito come `/dev/ttyUSB0`, `/dev/ttyUSB1` o, con alcuni adattatori, `/dev/ttyACM0`.

Verifica dal Raspberry:

```bash
ls -l /dev/ttyUSB* /dev/ttyACM*
```

È normale che uno dei due pattern non trovi alcun dispositivo: l’altro deve mostrare una porta seriale, ad esempio `/dev/ttyUSB0`. Il nome può cambiare tra riavvii; lo script `serra` usa un percorso configurabile.

> [!TIP] Note di compatibilità
> FTDI e CP210x sono generalmente più stabili su Linux. CH340 funziona correttamente, ma può richiedere driver sui sistemi non Linux.

## Continua il percorso

> [!TIP] Controllo
> **Verifica prima di proseguire:** Hai identificato TX, RX e GND e usi un adattatore TTL a 3,3 V senza collegare VCC.

<table width="100%" class="step-nav">
  <tr>
    <td width="50%" align="left"><strong>Passo precedente</strong><br><a href="00-panoramica.md">← 00 · Panoramica e obiettivi</a></td>
    <td width="50%" align="right"><strong>Passo successivo</strong><br><a href="02-raspberry.md">02 · Preparare il Raspberry Pi →</a></td>
  </tr>
</table>
