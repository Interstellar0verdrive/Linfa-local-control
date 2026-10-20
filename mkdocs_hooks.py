"""Shared navigation and page introductions for the published guide."""

import hashlib
import html
import re
from pathlib import Path
from urllib.parse import urlsplit


STEPS = [
    ("00", "Panoramica e obiettivi", "setup/00-panoramica.md", "Il progetto in breve: componenti, responsabilità e limiti del controllo locale.", "ORIENTAMENTO", "Hai compreso il ruolo di serra, Raspberry, UART, MQTT e Home Assistant."),
    ("01", "Hardware e collegamenti", "setup/01-hardware.md", "La base fisica del controllo locale: serra, Raspberry Pi e collegamento seriale sicuro.", "PREPARAZIONE", "Hai identificato TX, RX e GND, usi un adattatore TTL a 3,3 V e hai lasciato VCC scollegato."),
    ("02", "Preparare il Raspberry Pi", "setup/02-raspberry.md", "Prepara il sistema, i pacchetti e i permessi necessari per parlare con la serra.", "PREPARAZIONE", "Python, picocom, i pacchetti richiesti e i permessi seriali sono pronti."),
    ("03", "Verificare la console UART", "setup/03-uart.md", "Apri la console seriale e controlla che il VoCore risponda prima di modificarne la configurazione.", "CONNESSIONE", "La console risponde, puoi effettuare il login e il comando di prova funziona."),
    ("04", "Impostare la password root", "setup/04-password-root.md", "Proteggi l’accesso alla serra e verifica la nuova password dalla console seriale.", "CONNESSIONE", "Hai impostato e verificato la password root della serra."),
    ("05", "Configurare la serra per l’uso locale", "setup/05-modifiche-serra.md", "Applica con attenzione le modifiche necessarie per usare il dispositivo sulla rete locale.", "CONFIGURAZIONE", "Hai verificato le modifiche che hai scelto di applicare alla serra."),
    ("06", "Verificare la rete", "setup/06-rete.md", "Controlla gli indirizzi e la connettività di serra e Raspberry prima di installare il software.", "CONFIGURAZIONE", "Conosci gli indirizzi della serra e del Raspberry e hai verificato il collegamento UART."),
    ("07", "Installare e provare il controller CLI", "setup/07-controller-cli.md", "Installa il controller sul Raspberry e prova i primi comandi attraverso la UART.", "CONTROLLO", "Il comando serra state sync funziona dal Raspberry tramite UART."),
    ("08", "Configurare il bridge MQTT", "setup/08-bridge-mqtt.md", "Collega il controller al broker MQTT e verifica stati e comandi end-to-end.", "INTEGRAZIONE", "Il servizio bridge è attivo e i topic di stato e comando rispondono."),
    ("09", "Attivare i servizi automatici", "setup/09-servizi-automatici.md", "Automatizza la policy di rete e la sincronizzazione periodica dello stato.", "AUTOMAZIONE", "I timer sono attivi e i relativi servizi risultano verificati."),
    ("10", "Collegare Home Assistant", "setup/10-home-assistant.md", "Completa il percorso portando stati e comandi MQTT in Home Assistant.", "COMPLETAMENTO", "Home Assistant riceve gli stati MQTT e puoi inviare un comando di prova."),
]

EXTRAS = {
    "approfondimenti/traffico-cloud.md": ("Analisi del traffico cloud", "Come è stato osservato il dialogo originale tra la serra e il servizio remoto."),
    "approfondimenti/accesso-e-dump.md": ("Accesso e dump del modulo", "Appunti tecnici sull’accesso al VoCore e sulla copia del suo contenuto."),
}

ANCHOR_RE = re.compile(r'(<a\b[^>]*>)(.*?)(</a>)', re.IGNORECASE | re.DOTALL)
HREF_RE = re.compile(r'\bhref\s*=\s*(["\'])(.*?)\1', re.IGNORECASE | re.DOTALL)
LINK_ATTR_RE = re.compile(r'\s+(?:target|rel)\s*=\s*(["\']).*?\1', re.IGNORECASE | re.DOTALL)


def on_config(config):
    """Refresh browser-cached assets whenever the shared CSS or JS changes."""
    root = Path(__file__).resolve().parent
    digest = hashlib.sha256()
    for relative_path in ("docs/stylesheets/site.css", "docs/javascripts/site.js", "docs/assets/external-link.svg"):
        digest.update((root / relative_path).read_bytes())
    config["extra"]["asset_version"] = digest.hexdigest()[:10]
    return config


def on_page_markdown(markdown, page, config, files):
    """The site template owns headings and navigation; source Markdown stays readable on GitHub."""
    if page.file.src_uri.startswith("setup/"):
        markdown = re.sub(r"\A# .+?\n(?:\n\*\*Percorso guidato:\*\*.*?\n)?", "", markdown, count=1)
        markdown = re.split(r"\n## (?:Continua il percorso|Percorso completato)\s*\n", markdown, maxsplit=1)[0]
        markdown = re.sub(r"\n---\s*\Z", "\n", markdown)
    elif page.file.src_uri in EXTRAS:
        markdown = re.sub(r"\A# .+?\n", "", markdown, count=1)
    return markdown


def on_page_content(content, page, config, files):
    """Mark links outside this documentation site after Markdown has rendered them."""
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

    return ANCHOR_RE.sub(mark_external, content)


def on_page_context(context, page, config, nav):
    uri = page.file.src_uri
    steps = [
        {"number": number, "title": title, "src": src, "url": src.removesuffix(".md") + "/", "summary": summary, "phase": phase, "check": check}
        for number, title, src, summary, phase, check in STEPS
    ]
    context["steps"] = steps
    context["extras"] = [
        {"title": title, "url": src.removesuffix(".md") + "/", "active": uri == src}
        for src, (title, _) in EXTRAS.items()
    ]
    current = next((index for index, item in enumerate(steps) if item["src"] == uri), None)
    context["step"] = steps[current] if current is not None else None
    context["step_prev"] = steps[current - 1] if current is not None and current > 0 else None
    context["step_next"] = steps[current + 1] if current is not None and current < len(steps) - 1 else None
    context["is_home"] = uri == "index.md"
    context["page_title"] = steps[current]["title"] if current is not None else EXTRAS.get(uri, ("Guida passo per passo",))[0]
    context["page_summary"] = steps[current]["summary"] if current is not None else EXTRAS.get(uri, (None, "Dalla preparazione hardware al controllo locale con Home Assistant."))[1]
    context["page_phase"] = steps[current]["phase"] if current is not None else ("INDICE" if uri == "index.md" else "APPROFONDIMENTO")
    context["toc_items"] = [item for top in page.toc for item in (top.children if top.level == 1 and top.children else [top]) if item.level <= 2]
    return context
