"""Shared navigation and page introductions for the published guide."""

import hashlib
import html
import json
import re
from pathlib import Path
from urllib.parse import urlsplit


STEPS = [
    ("01", "Panoramica e obiettivi", "setup/01-panoramica.md", "Il progetto in breve: componenti, collegamenti possibili e limiti del controllo locale.", "ORIENTAMENTO", "Hai compreso il ruolo di serra, Raspberry, MQTT e Home Assistant e hai scelto quale collegamento provare."),
    ("02A", "Primo accesso via Wi-Fi", "setup/02-wifi.md", "Prova SSH, configura la rete locale e verifica che la serra non abbia accesso a Internet.", "RETE LOCALE", "La serra è raggiungibile via SSH sulla LAN, senza rotta verso Internet; oppure hai scelto il percorso UART."),
    ("02B", "Hardware e UART", "setup/02-hardware.md", "Prepara il collegamento seriale a 3,3 V, dall'adattatore ai pin della scheda superiore.", "COLLEGAMENTO FISICO", "Hai identificato TX, RX e GND, usi un adattatore TTL a 3,3 V e hai lasciato VCC scollegato."),
    ("03", "Preparare il Raspberry Pi", "setup/03-raspberry.md", "Prepara il sistema e i pacchetti necessari per il collegamento scelto.", "PREPARAZIONE", "Python e i pacchetti richiesti sono pronti; porta seriale e permessi servono solo se userai UART."),
    ("04", "Verificare la console UART", "setup/04-uart.md", "Se usi UART, apri la console seriale e controlla che il VoCore risponda.", "CONNESSIONE", "La console UART risponde e il login funziona; se usi solo Wi-Fi, hai saltato questo passo."),
    ("05", "Impostare la password root", "setup/05-password-root.md", "Verifica o imposta la password root tramite la shell raggiunta via UART o SSH.", "CONNESSIONE", "Conosci e hai verificato la password root della serra sul canale scelto."),
    ("06", "Installare il controller CLI", "setup/06-controller-cli.md", "Installa il controller sul Raspberry e prova i comandi via UART o SSH locale.", "CONTROLLO", "Il controller raggiunge la serra sul canale scelto e hai osservato i comandi di prova."),
    ("07", "Configurare il bridge MQTT", "setup/07-bridge-mqtt.md", "Collega il controller al broker MQTT e verifica stati e comandi end-to-end.", "INTEGRAZIONE", "Il servizio bridge è attivo e i topic di stato e comando rispondono."),
    ("08", "Attivare i servizi automatici", "setup/08-servizi-automatici.md", "Verifica la policy di rete del canale scelto e attiva la sincronizzazione periodica dello stato.", "AUTOMAZIONE", "La policy di rete scelta e i servizi periodici sono verificati."),
    ("09", "Collegare Home Assistant", "setup/09-home-assistant.md", "Completa il percorso portando stati e comandi MQTT in Home Assistant.", "COMPLETAMENTO", "Home Assistant riceve gli stati MQTT e puoi inviare un comando di prova."),
]

EXTRAS = {
    "approfondimenti/percorso-wifi-sperimentale.md": ("Prove e limiti del Wi-Fi", "Prove via rete locale, accesso iniziale non verificato e limiti osservati sul prototipo."),
    "approfondimenti/fotocamera.md": ("Foto della serra", "Scatto e trasferimento della fotografia tramite UART o SSH locale."),
    "approfondimenti/configurazione-serra.md": ("Wi-Fi, token e aggiornamenti", "Modifiche facoltative alla configurazione interna della serra usate nel prototipo."),
    "approfondimenti/rete-serra.md": ("Rete della serra durante il setup", "Indirizzi, accesso locale e policy di rete secondo il collegamento scelto."),
    "approfondimenti/traffico-cloud.md": ("Analisi del traffico cloud", "Come è stato osservato il dialogo originale tra la serra e il servizio remoto."),
    "approfondimenti/accesso-e-dump.md": ("Accesso e dump del modulo", "Appunti tecnici sull’accesso al VoCore e sulla copia del suo contenuto."),
}

REFERENCES = {
    "riferimento-comandi.md": ("Riferimento comandi", "Tutti i comandi del controller, con la sintassi CLI e il payload MQTT equivalente per Home Assistant."),
}

REDIRECTS = {
    "setup/05-modifiche-serra/": "approfondimenti/configurazione-serra/",
    "setup/06-rete/": "approfondimenti/rete-serra/",
    "setup/07-controller-cli/": "setup/06-controller-cli/",
    "setup/08-bridge-mqtt/": "setup/07-bridge-mqtt/",
    "setup/09-servizi-automatici/": "setup/08-servizi-automatici/",
    "setup/10-home-assistant/": "setup/09-home-assistant/",
    "setup/00-panoramica/": "setup/01-panoramica/",
    "setup/01-hardware/": "setup/02-hardware/",
    "setup/02-raspberry/": "setup/03-raspberry/",
    "setup/03-uart/": "setup/04-uart/",
    "setup/04-password-root/": "setup/05-password-root/",
    "setup/05-controller-cli/": "setup/06-controller-cli/",
    "setup/06-bridge-mqtt/": "setup/07-bridge-mqtt/",
    "setup/07-servizi-automatici/": "setup/08-servizi-automatici/",
    "setup/08-home-assistant/": "setup/09-home-assistant/",
}

ANCHOR_RE = re.compile(r'(<a\b[^>]*>)(.*?)(</a>)', re.IGNORECASE | re.DOTALL)
HREF_RE = re.compile(r'\bhref\s*=\s*(["\'])(.*?)\1', re.IGNORECASE | re.DOTALL)
LINK_ATTR_RE = re.compile(r'\s+(?:target|rel)\s*=\s*(["\']).*?\1', re.IGNORECASE | re.DOTALL)
DIAGRAM_IMAGES = {
    "diagramma-cablaggio-uart.svg",
    "diagramma-percorso-seriale.svg",
    "diagramma-flusso-mqtt.svg",
}
IMAGE_RE = re.compile(r'<img\b[^>]*>', re.IGNORECASE)
SRC_RE = re.compile(r'\bsrc="([^"]+)"', re.IGNORECASE)


def on_config(config):
    """Refresh browser-cached assets whenever the shared CSS or JS changes."""
    root = Path(__file__).resolve().parent
    digest = hashlib.sha256()
    for relative_path in ("docs/stylesheets/site.css", "docs/javascripts/site.js"):
        digest.update((root / relative_path).read_bytes())
    config["extra"]["asset_version"] = digest.hexdigest()[:10]
    return config


def on_page_markdown(markdown, page, config, files):
    """The site template owns headings and navigation; source Markdown stays readable on GitHub."""
    if page.file.src_uri.startswith("setup/"):
        markdown = re.sub(r"\A# .+?\n(?:\n\*\*Percorso guidato:\*\*.*?\n)?", "", markdown, count=1)
        markdown = re.split(r"\n## (?:Continua il percorso|Percorso completato)\s*\n", markdown, maxsplit=1)[0]
        markdown = re.sub(r"\n---\s*\Z", "\n", markdown)
    elif page.file.src_uri in REFERENCES:
        markdown = re.sub(r"\A# .+?\n(?:\n\*\*Percorso guidato:\*\*.*?\n)?", "", markdown, count=1)
    elif page.file.src_uri in EXTRAS:
        markdown = re.sub(r"\A# .+?\n", "", markdown, count=1)
        markdown = re.sub(r"\n(?:---\s*\n\s*)?\[Torna all’indice della guida\]\(\.\./index\.md\)\.\s*\Z", "\n", markdown)
        markdown = re.sub(r"\n(?:---\s*\n\s*)?<nav class=\"step-nav single\" aria-label=\"Torna alla guida\">.*?</nav>\s*\Z", "\n", markdown, flags=re.DOTALL)
    return markdown


def on_page_content(content, page, config, files):
    """Mark external links and inline diagrams so site themes can color them."""
    site = urlsplit(config["site_url"])

    def mark_external(match):
        opening, label, closing = match.groups()
        href = HREF_RE.search(opening)
        if not href:
            return match.group(0)
        destination = urlsplit(html.unescape(href.group(2)))
        if destination.scheme not in {"http", "https"}:
            return match.group(0)
        if destination.netloc == site.netloc and destination.path.startswith(site.path):
            return match.group(0)

        opening = LINK_ATTR_RE.sub("", opening)
        opening = opening[:-1] + ' target="_blank" rel="noopener noreferrer">'
        return opening + label + '<span class="visually-hidden"> (si apre in una nuova scheda)</span>' + closing

    content = ANCHOR_RE.sub(mark_external, content)

    def inline_diagram(match):
        image = match.group(0)
        source = SRC_RE.search(image)
        if not source:
            return image
        path = urlsplit(html.unescape(source.group(1))).path
        name = Path(path).name
        if name not in DIAGRAM_IMAGES or "/assets/" not in path:
            return image
        svg = (Path(__file__).resolve().parent / "docs" / "assets" / name).read_text(encoding="utf-8")
        return svg

    return IMAGE_RE.sub(inline_diagram, content)


def on_page_context(context, page, config, nav):
    uri = page.file.src_uri
    steps = [
        {"number": number, "progress": int(number[:2]) / 9 * 100, "title": title, "src": src, "url": src.removesuffix(".md") + "/", "summary": summary, "phase": phase, "check": check}
        for number, title, src, summary, phase, check in STEPS
    ]
    by_number = {item["number"]: item for item in steps}
    transitions = {
        "01": ([], ["02A", "02B"]),
        "02A": (["01"], ["03", "02B"]),
        "02B": (["01"], ["03"]),
        "03": (["02A", "02B"], ["04", "05"]),
        "04": (["03"], ["05"]),
        "05": (["04", "03"], ["06"]),
        "06": (["05"], ["07"]),
        "07": (["06"], ["08"]),
        "08": (["07"], ["09"]),
        "09": (["08"], []),
    }
    context["steps"] = steps
    context["extras"] = [
        {"title": title, "url": src.removesuffix(".md") + "/", "active": uri == src}
        for src, (title, _) in EXTRAS.items()
    ]
    context["references"] = [
        {"title": title, "url": src.removesuffix(".md") + "/", "active": uri == src}
        for src, (title, _) in REFERENCES.items()
    ]
    current = next((index for index, item in enumerate(steps) if item["src"] == uri), None)
    context["step"] = steps[current] if current is not None else None
    previous, following = transitions[steps[current]["number"]] if current is not None else ([], [])
    context["step_prev"] = by_number[previous[0]] if previous else None
    context["step_prev_alt"] = [by_number[number] for number in previous[1:]]
    context["step_next"] = by_number[following[0]] if following else None
    context["step_next_alt"] = [by_number[number] for number in following[1:]]
    context["is_home"] = uri == "index.md"
    context["page_title"] = steps[current]["title"] if current is not None else REFERENCES.get(uri, EXTRAS.get(uri, ("Guida passo per passo",)))[0]
    context["page_summary"] = steps[current]["summary"] if current is not None else REFERENCES.get(uri, EXTRAS.get(uri, (None, "Dalla preparazione hardware al controllo locale con Home Assistant.")))[1]
    context["page_phase"] = steps[current]["phase"] if current is not None else ("INDICE" if uri == "index.md" else "RIFERIMENTO" if uri in REFERENCES else "APPROFONDIMENTO")
    context["toc_items"] = [item for top in page.toc for item in (top.children if top.level == 1 and top.children else [top]) if item.level <= 2]
    return context


def on_post_build(config):
    """Keep existing Pages bookmarks usable after renumbering the guide."""
    for old_path, new_path in REDIRECTS.items():
        target = "../../" + new_path
        destination = Path(config["site_dir"]) / old_path / "index.html"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(
            '<!doctype html><html lang="it"><head><meta charset="utf-8">'
            '<meta name="robots" content="noindex">'
            f'<meta http-equiv="refresh" content="0; url={html.escape(target, quote=True)}">'
            f'<link rel="canonical" href="{html.escape(config["site_url"] + new_path, quote=True)}">'
            f'<script>location.replace({json.dumps(target)} + location.hash);</script>'
            f'</head><body><p>La pagina è stata spostata: <a href="{html.escape(target, quote=True)}">'
            'apri la nuova pagina</a>.</p></body></html>',
            encoding="utf-8",
        )
