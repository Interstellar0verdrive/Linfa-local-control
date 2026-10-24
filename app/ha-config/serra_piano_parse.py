#!/usr/bin/env python3
"""Parser di /config/serra_piano.yaml per sensor.serra_piano (command_line).

Legge la struttura A FASI (durate + eventi 1-based dentro la fase) ed emette
gli attributi nel formato LEGACY a giorni assoluti che sensori e dashboard
consumano (fasi/eventi/fotoperiodica), oltre ai passthrough luci/acqua/ambiente.
Così il documento è per umani, il resto del sistema non cambia.

Convenzioni: G/V/F/W/E 1-based; giorno assoluto = inizio_fase + giorno - 1.
Fotoperiodiche: durate "giorni_foto" (fallback "giorni"); eventi di
fioritura/flush/essiccazione mappati su "dopo_fioritura" 0-based dal flip;
"giorno_foto" su un evento ne cambia la posizione solo per le foto.
"""
import json
import yaml

ORDINE = ["germinazione", "vegetativa", "fioritura", "flush", "essiccazione"]

d = yaml.safe_load(open("/config/serra_piano.yaml", encoding="utf-8")) or {}
fasi_cfg = d.get("fasi", {}) or {}
eventi_cfg = d.get("eventi", {}) or {}

# --- validazione: FALLIRE RUMOROSAMENTE sui refusi ---------------------------
# Una chiave di fase sbagliata (es. "fioritur") farebbe SPARIRE eventi in
# silenzio. Meglio un errore: il sensore va unavailable e scatta la notifica
# "piano illeggibile" (fase_auto resta in pausa, nulla viene riscritto male).
sconosciute = [k for k in fasi_cfg if k not in ORDINE]
if sconosciute:
    raise ValueError("fasi sconosciute nel piano: %s" % sconosciute)
mancanti = [k for k in ORDINE if k not in fasi_cfg]
if mancanti:
    raise ValueError("fasi mancanti nel piano: %s" % mancanti)
sconosciute = [k for k in eventi_cfg if k not in ORDINE]
if sconosciute:
    raise ValueError("fasi eventi sconosciute nel piano: %s" % sconosciute)
nutrienti_cfg = d.get("nutrienti", {}) or {}
sconosciute = [k for k in nutrienti_cfg if k not in ORDINE]
if sconosciute:
    raise ValueError("fasi nutrienti sconosciute nel piano: %s" % sconosciute)
# AUDIT R1 (MC-07): anche le fasi MANCANTI sono un errore (come per luci/
# acqua/ambiente): senza, serra_dose_nutrienti va unavailable per tutta la
# fase e la card dose sparisce senza spiegazione.
mancanti = [k for k in ORDINE if k not in nutrienti_cfg]
if mancanti:
    raise ValueError("nutrienti: fasi mancanti nel piano: %s" % mancanti)
for nome, periodi in nutrienti_cfg.items():
    if not isinstance(periodi, list) or not periodi:
        raise ValueError("nutrienti %s: attesa lista di periodi" % nome)
    prev_fg = 0
    for i, per in enumerate(periodi):
        for campo in ("grow", "micro", "bloom"):
            if campo not in per:
                raise ValueError("nutrienti %s: periodo senza '%s': %s" % (nome, campo, per))
            v = per.get(campo)
            if not isinstance(v, (int, float)) or isinstance(v, bool):
                raise ValueError("nutrienti %s: '%s' non numerico: %r (M6: una virgola come '1,8' viene letta come STRINGA e rompe serra_dose_nutrienti a valle)" % (nome, campo, v))
            # AUDIT R2 (MC2-07): la tabella e' ATTUANTE come la dose — un
            # negativo qui finiva in grow_ml_vasca e da li' alle pompe.
            if v < 0:
                raise ValueError("nutrienti %s: '%s' negativo: %r" % (nome, campo, v))
        # AUDIT R1 (MD-07 lato parser): 'fino_giorno' crescenti e solo
        # l'ULTIMO periodo puo' ometterlo — un periodo aperto in mezzo fa
        # divergere HA e pannello sulla dose selezionata.
        fg = per.get("fino_giorno")
        if fg is None:
            if i != len(periodi) - 1:
                raise ValueError("nutrienti %s: solo l'ULTIMO periodo puo' omettere 'fino_giorno' (periodo %d senza limite)" % (nome, i + 1))
        else:
            if not isinstance(fg, int) or isinstance(fg, bool) or fg <= prev_fg:
                raise ValueError("nutrienti %s: 'fino_giorno' deve essere intero CRESCENTE (periodo %d: %r, precedente %d)" % (nome, i + 1, fg, prev_fg))
            # AUDIT R2 (MC2-07): oltre la durata della fase i periodi
            # successivi diventano irraggiungibili, in silenzio.
            # AUDIT R3 (MC3-01) + R4 (R4P-01): fasi_cfg[nome] e' un DICT — e
            # per le FOTO conta la durata MINORE tra giorni e giorni_foto
            # (flush auto 22 ma foto 14: un fino_giorno 20 uccideva i periodi
            # successivi solo in fotoperiodica, in silenzio).
            _f = fasi_cfg.get(nome) or {}
            _durs = [v for v in (_f.get("giorni"), _f.get("giorni_foto"))
                     if isinstance(v, (int, float)) and not isinstance(v, bool)]
            if _durs and fg > min(_durs):
                raise ValueError("nutrienti %s: 'fino_giorno' %d oltre la durata della fase (%s giorni, foto incluse): i periodi successivi sarebbero morti" % (nome, fg, min(_durs)))
            prev_fg = fg
_titoli_visti = set()
for nome, lst in eventi_cfg.items():
    for e in lst or []:
        if "titolo" not in e or "giorno" not in e:
            raise ValueError("evento senza titolo/giorno in fase %s: %s" % (nome, e))
        # AUDIT R1 (NT-13): il diario e' line-based — un titolo multi-riga
        # verrebbe troncato alla prima riga e il done-state non matcherebbe MAI.
        if "\n" in str(e.get("titolo", "")):
            raise ValueError("evento in fase %s: il titolo contiene un a-capo (vietato, rompe il diario): %r" % (nome, e.get("titolo")))
        # AUDIT R2 (MC2-08): TUTTO il done-state (digest, drawer, pannello,
        # booster) e' chiavato sul TITOLO — vuoto o duplicato, un solo FATTO
        # spegnerebbe piu' eventi per sempre, in silenzio.
        _t_norm = str(e["titolo"]).replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').strip()
        if not _t_norm:
            raise ValueError("evento in fase %s: titolo vuoto (il done-state e' chiavato sul titolo)" % nome)
        if _t_norm in _titoli_visti:
            raise ValueError("titolo duplicato %r (fase %s): il done-state e' per-titolo, un FATTO li spegnerebbe entrambi" % (e["titolo"], nome))
        _titoli_visti.add(_t_norm)
        # AUDIT R2 (RT2-07): niente virgolette tipografiche nei titoli — la
        # normalizzazione runtime le copre, ma vietarle alla fonte elimina la
        # classe di bug (copia-incolla da Notion).
        # AUDIT R3 (NT3-11b): niente caratteri fuori dal BMP (emoji ecc.) —
        # la firma dello snooze conta i caratteri in modo diverso tra Jinja
        # (code-point) e JS (code-unit UTF-16) e divergerebbe in silenzio.
        if any(ord(_c) > 0xFFFF for _c in str(e["titolo"])):
            raise ValueError("evento %r (fase %s): caratteri fuori dal BMP nel titolo (emoji estese, U+10000+) non supportati" % (e["titolo"], nome))
        for _ch in ("’", "‘", "“", "”"):
            if _ch in str(e["titolo"]):
                raise ValueError("evento %r (fase %s): virgolette tipografiche nel titolo (usare ' e \") — arrivano dai copia-incolla e rompono il matching" % (e["titolo"], nome))
        if int(e["giorno"]) < 1:
            raise ValueError("giorno di fase < 1 in %s: %s" % (nome, e))
        # AUDIT R1 (MC-18): vocabolario chiuso per 'tipo' e 'ancora' — un
        # refuso ('boster', 'fiorutura') rendeva l'evento invisibile a
        # booster/latch o lo lasciava per sempre in timeline, IN SILENZIO.
        if e.get("tipo") is not None and e["tipo"] not in ("azione", "booster", "checkpoint", "raccolto"):
            raise ValueError("evento '%s' (%s): tipo sconosciuto %r (ammessi: azione, booster, checkpoint, raccolto)" % (e.get("titolo"), nome, e["tipo"]))
        if e.get("ancora") is not None and e["ancora"] not in ("vegetativa", "fioritura", "flush", "essiccazione"):
            raise ValueError("evento '%s' (%s): ancora sconosciuta %r (ammesse: vegetativa, fioritura, flush, essiccazione)" % (e.get("titolo"), nome, e["ancora"]))
        # AUDIT R1 (MC-10): 'dose' e' ATTUANTE (con dosatori_auto ON gli
        # eventi modo:"aggiunta" vengono erogati dalle pompe cosi' come
        # scritti) -> stessa validazione fail-loudly della tabella nutrienti.
        dose = e.get("dose")
        if dose is not None:
            # AUDIT R2 (MC2-07): chiavi in whitelist — un refuso ('bolm')
            # passava e le pompe erogavano 0 di quel nutriente mentre il
            # suggerimento a schermo prometteva la dose piena.
            if isinstance(dose, dict):
                _sconosciute = [k for k in dose if k not in ("modo", "grow", "micro", "bloom")]
                if _sconosciute:
                    raise ValueError("evento %r: chiavi dose sconosciute %s (ammesse: modo, grow, micro, bloom)" % (e.get("titolo"), _sconosciute))
            if not isinstance(dose, dict):
                raise ValueError("evento '%s' (%s): 'dose' non e' una mappa: %r" % (e.get("titolo"), nome, dose))
            if dose.get("modo") not in ("aggiunta", "cambio"):
                raise ValueError("evento '%s' (%s): dose.modo deve essere 'aggiunta' o 'cambio', trovato: %r" % (e.get("titolo"), nome, dose.get("modo")))
            for campo in ("grow", "micro", "bloom"):
                if campo in dose:
                    v = dose.get(campo)
                    if not isinstance(v, (int, float)) or isinstance(v, bool):
                        raise ValueError("evento '%s' (%s): dose.%s non numerico: %r (M6: '1,8' con la virgola e' una STRINGA)" % (e.get("titolo"), nome, campo, v))
                    if v < 0:
                        raise ValueError("evento '%s' (%s): dose.%s negativa: %r" % (e.get("titolo"), nome, campo, v))

# 'giorni' per fase: presente e intero positivo. Una durata 0/negativa (o un
# typo tipo "giorno: 21" singolare) sfaserebbe A CASCATA tutte le fasi successive
# (start += dur(nome)) -> sensor.serra_fase salterebbe una fase o partirebbe
# storto, applicando mix/soglie/acqua della fase sbagliata.
for nome in ORDINE:
    g = (fasi_cfg.get(nome, {}) or {}).get("giorni")
    if not isinstance(g, int) or isinstance(g, bool) or g <= 0:
        raise ValueError("fase %s: 'giorni' mancante o non intero positivo: %r" % (nome, g))
    # M6: 'giorni_foto' (opzionale, usato da dur() per le fotoperiodiche): se
    # presente dev'essere intero positivo, altrimenti la timeline foto sfasa/collassa.
    gf = (fasi_cfg.get(nome, {}) or {}).get("giorni_foto")
    if gf is not None and (not isinstance(gf, int) or isinstance(gf, bool) or gf <= 0):
        raise ValueError("fase %s: 'giorni_foto' presente ma non intero positivo: %r" % (nome, gf))

# luci / acqua / ambiente: PRIMA erano passthrough NON validati -> un typo di
# nome-fase passava in silenzio e i consumatori cadevano sui default hard-coded
# divergenti (per 'luci' il mix diventa [0,0,0,0,0] = PANNELLO SPENTO per tutta
# la fase). Validare come le altre sezioni: niente fasi sconosciute, tutte
# presenti, tipi corretti. Filosofia del parser: fallire rumorosamente sui refusi.
def _valida_fasi_sezione(sez, cfg):
    if not isinstance(cfg, dict):
        raise ValueError("sezione '%s': attesa mappa fase->config, trovato %s" % (sez, type(cfg).__name__))
    extra = [k for k in cfg if k not in ORDINE]
    if extra:
        raise ValueError("%s: fasi sconosciute nel piano: %s" % (sez, extra))
    manc = [k for k in ORDINE if k not in cfg]
    if manc:
        raise ValueError("%s: fasi mancanti nel piano: %s" % (sez, manc))

def _num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)

luci_cfg = d.get("luci", {}) or {}
_valida_fasi_sezione("luci", luci_cfg)
for nome, mix in luci_cfg.items():
    if not isinstance(mix, list) or len(mix) != 5 or not all(_num(x) for x in mix):
        raise ValueError("luci %s: attesa lista di 5 numeri (canali D,R,B,G,A), trovato %r" % (nome, mix))
    # AUDIT R2 (MC2-07): range 0-100 (un 700 o un -70 passavano e finivano
    # dritti nel comando lights set)
    if any((not isinstance(x, bool)) and isinstance(x, (int, float)) and (x < 0 or x > 100) for x in mix):
        raise ValueError("luci %s: canali fuori range 0-100: %r" % (nome, mix))

acqua_cfg = d.get("acqua", {}) or {}
_valida_fasi_sezione("acqua", acqua_cfg)
for nome, a in acqua_cfg.items():
    if not isinstance(a, dict):
        raise ValueError("acqua %s: attesa mappa {ore, durata}, trovato %r" % (nome, a))
    ore = a.get("ore", [])
    if not isinstance(ore, list) or len(ore) > 3 or not all(_num(x) and x >= 0 for x in ore):
        raise ValueError("acqua %s: 'ore' deve essere lista (max 3) di numeri >=0, trovato %r" % (nome, ore))
    # AUDIT R2 (MC2-07): le ore sono OFFSET DALL'ALBA in ore — oltre 23 il
    # wrap % 86400 produce un orario a caso.
    if any(x > 23 for x in ore):
        raise ValueError("acqua %s: 'ore' oltre 23 (sono offset dall'alba): %r" % (nome, ore))
    if not _num(a.get("durata")) or a.get("durata") <= 0:
        raise ValueError("acqua %s: 'durata' deve essere un numero > 0, trovato %r" % (nome, a.get("durata")))

amb_cfg = d.get("ambiente", {}) or {}
_valida_fasi_sezione("ambiente", amb_cfg)
for nome, am in amb_cfg.items():
    if not isinstance(am, dict):
        raise ValueError("ambiente %s: attesa mappa soglie, trovato %r" % (nome, am))
    for campo in ("soglia_umidita", "soglia_temp", "umid_min", "temp_min"):
        if not _num(am.get(campo)):
            raise ValueError("ambiente %s: '%s' mancante o non numerico: %r" % (nome, campo, am.get(campo)))
    # il minimo del range ideale NON puo' superare il tetto (soglia), altrimenti
    # l'indicatore dashboard "sei nel range?" sarebbe sempre rosso.
    if am["umid_min"] > am["soglia_umidita"]:
        raise ValueError("ambiente %s: umid_min (%r) > soglia_umidita (%r)" % (nome, am["umid_min"], am["soglia_umidita"]))
    if am["temp_min"] > am["soglia_temp"]:
        raise ValueError("ambiente %s: temp_min (%r) > soglia_temp (%r)" % (nome, am["temp_min"], am["soglia_temp"]))

# --- durate ---
def dur(nome, foto=False):
    cfg = fasi_cfg.get(nome, {}) or {}
    if foto:
        return int(cfg.get("giorni_foto", cfg.get("giorni", 0)))
    return int(cfg.get("giorni", 0))

# AUDIT R1 (MC-08/MC-09): bounds degli eventi contro le DURATE (qui, dopo la
# validazione di 'giorni': dur() e' affidabile). Un giorno oltre la durata
# della fase verrebbe riancorato ALLA FASE SUCCESSIVA in silenzio da
# serra_eventi_effettivi (e si muoverebbe con le milestone sbagliate); per le
# foto, un giorno oltre la durata foto sconfina nella fase successiva del
# mapping dopo_fioritura.
for nome, lst in eventi_cfg.items():
    for e in lst or []:
        g = int(e["giorno"])
        if g > dur(nome):
            raise ValueError("evento '%s' (%s): giorno %d oltre la durata della fase (%d giorni)" % (e.get("titolo"), nome, g, dur(nome)))
        gf = e.get("giorno_foto")
        if gf is not None and (not isinstance(gf, int) or isinstance(gf, bool) or gf < 1):
            raise ValueError("evento '%s' (%s): 'giorno_foto' non intero >= 1: %r" % (e.get("titolo"), nome, gf))
        if nome in ("fioritura", "flush", "essiccazione"):
            gfase = int(gf if gf is not None else g)
            if gfase > dur(nome, foto=True):
                raise ValueError("evento '%s' (%s): giorno %d oltre la durata FOTO della fase (%d giorni) — aggiungere 'giorno_foto' entro il limite" % (e.get("titolo"), nome, gfase, dur(nome, foto=True)))

# --- fasi legacy (giorni assoluti, durate AUTO) ---
fasi_legacy = []
start = 1
starts = {}
for nome in ORDINE:
    starts[nome] = start
    fasi_legacy.append({"giorno": start, "nome": nome})
    start += dur(nome)
fasi_legacy.append({"giorno": start, "nome": "conclusa"})

# --- eventi legacy (giorni assoluti, AUTO) ---
eventi_legacy = []
for nome in ORDINE:
    for e in eventi_cfg.get(nome, []) or []:
        out = {k: v for k, v in e.items() if k not in ("giorno", "giorno_foto")}
        out["giorno"] = starts[nome] + int(e.get("giorno", 1)) - 1
        eventi_legacy.append(out)
eventi_legacy.sort(key=lambda x: x["giorno"])

# --- variante fotoperiodica legacy (offset 0-based dal flip) ---
f_fior = dur("fioritura", foto=True)
f_flush = dur("flush", foto=True)
f_ess = dur("essiccazione", foto=True)
foto_fasi = [
    {"dopo_fioritura": 0, "nome": "fioritura"},
    {"dopo_fioritura": f_fior, "nome": "flush"},
    {"dopo_fioritura": f_fior + f_flush, "nome": "essiccazione"},
    {"dopo_fioritura": f_fior + f_flush + f_ess, "nome": "conclusa"},
]
foto_base = {"fioritura": 0, "flush": f_fior, "essiccazione": f_fior + f_flush}
foto_eventi = []
for nome in ("fioritura", "flush", "essiccazione"):
    for e in eventi_cfg.get(nome, []) or []:
        out = {k: v for k, v in e.items() if k not in ("giorno", "giorno_foto")}
        giorno_fase = int(e.get("giorno_foto", e.get("giorno", 1)))
        out["dopo_fioritura"] = foto_base[nome] + giorno_fase - 1
        foto_eventi.append(out)
foto_eventi.sort(key=lambda x: x["dopo_fioritura"])

print(json.dumps({
    "fasi": fasi_legacy,
    "eventi": eventi_legacy,
    "fotoperiodica": {"fasi": foto_fasi, "eventi": foto_eventi},
    "luci": d.get("luci", {}),
    "nutrienti": nutrienti_cfg,
    "acqua": d.get("acqua", {}),
    "ambiente": d.get("ambiente", {}),
    "count": len(eventi_legacy),
}))
