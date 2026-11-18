#!/usr/bin/env python3
"""
Baut Sandras Wirkungscheck: aus vorlage.html und danke-vorlage.html plus
fragen.json entstehen index.html und danke.html.

Aufruf im Projektordner:   python3 bauen.py

Angelegt 25.10.2026 fuer den Neubau aus der Check-Vorlage. Die Vorlage misst
mit acht Fragen und Punkten; Sandras Check zeigt fuenf Muster mit Ja oder
Eher nicht und ein Ergebnis aus den angekreuzten Mustern. Darum ist dieser
Bau eigener Art, die Grundsaetze sind dieselben:

- Geaendert wird fragen.json, nie index.html oder danke.html.
- {{bereich.schluessel}} in den Vorlagen wird durch den Text aus fragen.json
  ersetzt, HTML-sicher. Ein Platzhalter ohne Text bricht den Bau ab.
- Muster, Stufen und die Texte, die das Skript braucht, kommen als
  JavaScript-Konstanten an die Stelle zwischen

    /* ---- HIER SETZT bauen.py DIE DATEN EIN ---- */
    /* ---- ENDE DATEN-EINSATZ ---- */

- Ein Gedankenstrich (—) in den neuen Texten bricht den Bau ab.
- Steht die Adresse des Checks fest (einstellungen.seiten_adresse), schreibt
  der Bau robots.txt und sitemap.xml und setzt die kanonische Adresse.
"""

import datetime
import html
import json
import os
import re
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
FRAGEN = os.path.join(HIER, "fragen.json")
SEITEN = [("vorlage.html", "index.html"), ("danke-vorlage.html", "danke.html")]

START = "/* ---- HIER SETZT bauen.py DIE DATEN EIN ---- */"
ENDE = "/* ---- ENDE DATEN-EINSATZ ---- */"
ADRESS_PLATZHALTER = "HIER-DIE-ADRESSE-DES-CHECKS"

MUSTER_FELDER = ["nummer", "titel", "szene", "zitat", "ergebnis_kurz", "ergebnis_satz", "vertiefung"]
SKRIPT_TEXTE = ["fortschritt", "fehler_vorname", "fehler_email", "fehler_abo", "fehler_senden"]


def lade():
    if not os.path.exists(FRAGEN):
        sys.exit("Fehlt: fragen.json")
    try:
        with open(FRAGEN, encoding="utf-8") as f:
            daten = json.load(f)
    except json.JSONDecodeError as e:
        sys.exit("fragen.json ist nicht lesbar: Zeile %d, %s" % (e.lineno, e.msg))

    for teil in ["einstellungen", "kopf", "muster", "ergebnis", "video", "neue_texte"]:
        if teil not in daten:
            sys.exit("Bau abgebrochen. In fragen.json fehlt der Teil '%s'." % teil)
    if len(daten["muster"]) != 5:
        sys.exit("Bau abgebrochen. Es muessen genau fuenf Muster sein, gefunden: %d." % len(daten["muster"]))
    for i, m in enumerate(daten["muster"], 1):
        fehlt = [f for f in MUSTER_FELDER if not m.get(f)]
        if fehlt:
            sys.exit("Bau abgebrochen. Muster %d fehlt: %s" % (i, ", ".join(fehlt)))
    stufen = daten["ergebnis"].get("stufen") or []
    if len(stufen) != 5 or not all(s.get("titel") and s.get("text") for s in stufen):
        sys.exit("Bau abgebrochen. ergebnis.stufen braucht fuenf Eintraege mit titel und text "
                 "(fuer 1 bis 5 angekreuzte Muster).")
    for k in SKRIPT_TEXTE:
        if not daten["neue_texte"].get(k):
            sys.exit("Bau abgebrochen. neue_texte.%s fehlt." % k)
    if not daten["ergebnis"].get("mehr_lesen"):
        sys.exit("Bau abgebrochen. ergebnis.mehr_lesen fehlt.")

    striche = [k for k, v in daten["neue_texte"].items() if isinstance(v, str) and "—" in v]
    if striche:
        sys.exit("Bau abgebrochen. Gedankenstrich in neue_texte: %s" % ", ".join(striche))
    return daten


def hole(daten, pfad):
    wert = daten
    for teil in pfad.split("."):
        if not isinstance(wert, dict) or teil not in wert:
            return None
        wert = wert[teil]
    return wert if isinstance(wert, str) else None


def setze_platzhalter(seite, daten, name):
    offen = []

    def tausche(t):
        wert = hole(daten, t.group(1))
        if wert is None:
            offen.append(t.group(1))
            return t.group(0)
        return html.escape(wert, quote=True)

    seite = re.sub(r"\{\{([a-z_]+\.[a-z_]+)\}\}", tausche, seite)
    if offen:
        sys.exit("Bau abgebrochen. In %s stehen Platzhalter ohne Text: %s" % (name, ", ".join(sorted(set(offen)))))
    return seite


def js(wert):
    # </script> im Text darf das Skript nicht beenden
    return json.dumps(wert, ensure_ascii=False, indent=2).replace("</", "<\\/")


def daten_block(daten):
    texte = {k: daten["neue_texte"][k] for k in SKRIPT_TEXTE}
    texte["mehr_lesen"] = daten["ergebnis"]["mehr_lesen"]
    zeilen = [
        START,
        "// Erzeugt von bauen.py aus fragen.json am %s. Nicht hier aendern." % datetime.date.today().isoformat(),
        "var MUSTER = %s;" % js(daten["muster"]),
        "// STUFEN[0] gilt fuer 1 angekreuztes Muster, STUFEN[4] fuer 5.",
        "var STUFEN = %s;" % js(daten["ergebnis"]["stufen"]),
        "var TEXTE = %s;" % js(texte),
        ENDE,
    ]
    return "\n".join(zeilen)


def schneide(seite, name):
    """Entfernt <!-- NAME START ... --> bis <!-- NAME ENDE --> samt Markern."""
    muster = r"[ \t]*<!-- %s START.*?<!-- %s ENDE -->\n" % (name, name)
    neu, anzahl = re.subn(muster, "", seite, flags=re.S)
    if anzahl != 1:
        sys.exit("Bau abgebrochen. %s-Marker fehlt in vorlage.html." % name)
    return neu


def entmarke(seite, name):
    """Laesst den Inhalt stehen, nimmt nur die beiden Marker-Zeilen heraus."""
    neu, anzahl = re.subn(r"[ \t]*<!-- %s (START|ENDE).*?-->\n" % name, "", seite)
    if anzahl != 2:
        sys.exit("Bau abgebrochen. %s-Marker fehlt in vorlage.html." % name)
    return neu


def anmeldung_waehlen(seite, daten):
    """einstellungen.anmeldung: "formular" (Video gegen Adresse im Check, ueber
    eintragen.js an Wix) oder "wix-seite" (Weg B: Knopf auf Sandras Wix-Seite)."""
    art = daten["einstellungen"].get("anmeldung", "formular")
    if art == "formular":
        seite = schneide(seite, "WEG-B")
        seite = entmarke(seite, "FORMULAR")
        return seite.replace("{{BILD_ZIEL}}", "#anmeldung")
    if art == "wix-seite":
        if not daten["einstellungen"].get("weg_b_url") or not daten["video"].get("klein_weg_b"):
            sys.exit("Bau abgebrochen. Fuer Weg B fehlt einstellungen.weg_b_url oder video.klein_weg_b.")
        seite = schneide(seite, "FORMULAR")
        seite = entmarke(seite, "WEG-B")
        return seite.replace("{{BILD_ZIEL}}", html.escape(daten["einstellungen"]["weg_b_url"]))
    sys.exit('Bau abgebrochen. einstellungen.anmeldung muss "formular" oder "wix-seite" sein.')


def main():
    daten = lade()
    adresse = daten["einstellungen"].get("seiten_adresse", "")
    adresse_fest = bool(adresse) and adresse != ADRESS_PLATZHALTER

    for quelle, ziel in SEITEN:
        pfad = os.path.join(HIER, quelle)
        if not os.path.exists(pfad):
            sys.exit("Fehlt: %s" % quelle)
        with open(pfad, encoding="utf-8") as f:
            seite = f.read()
        if ziel == "index.html":
            seite = anmeldung_waehlen(seite, daten)
        seite = setze_platzhalter(seite, daten, quelle)
        if START in seite:
            a, b = seite.index(START), seite.index(ENDE) + len(ENDE)
            seite = seite[:a] + daten_block(daten) + seite[b:]
        if adresse_fest and ziel == "index.html":
            seite = seite.replace('<meta name="robots"',
                                  '<link rel="canonical" href="%s/">\n<meta name="robots"' % html.escape(adresse.rstrip("/")), 1)
        if "googleapis" in seite:
            sys.exit("Bau abgebrochen. %s verweist auf Google Fonts." % quelle)
        with open(os.path.join(HIER, ziel), "w", encoding="utf-8") as f:
            f.write(seite)
        print("%s gebaut, %d Zeichen." % (ziel, len(seite)))

    if adresse_fest:
        basis = adresse.rstrip("/")
        with open(os.path.join(HIER, "robots.txt"), "w", encoding="utf-8") as f:
            f.write("User-agent: *\nAllow: /\nDisallow: /.netlify/\nDisallow: /danke.html\n\nSitemap: %s/sitemap.xml\n" % basis)
        with open(os.path.join(HIER, "sitemap.xml"), "w", encoding="utf-8") as f:
            f.write('<?xml version="1.0" encoding="UTF-8"?>\n'
                    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                    '  <url>\n    <loc>%s/</loc>\n    <lastmod>%s</lastmod>\n  </url>\n</urlset>\n'
                    % (html.escape(basis), datetime.date.today().isoformat()))
        print("robots.txt und sitemap.xml auf %s gesetzt." % basis)
        print("Keine offenen Platzhalter.")
    else:
        print("\nOffen vor dem Livegang: einstellungen.seiten_adresse in fragen.json "
              "(die Unterdomain des Checks). Danach neu bauen, dann stimmen "
              "robots.txt, sitemap.xml und die kanonische Adresse.")


if __name__ == "__main__":
    main()
