#!/usr/bin/env python3
"""
Holt die Schriften eines Kunden von Google Fonts nach assets/fonts/ und schreibt
die @font-face-Bloecke aus, die in vorlage.html gehoeren.

    python3 schriften-holen.py "Montserrat:600,700" "Open Sans:400,700,400i"

Warum das ueberhaupt ein Skript ist: Schriften duerfen nicht per <link> von
fonts.googleapis.com geladen werden. Jeder Aufruf dorthin uebertraegt die
IP-Adresse des Besuchers in die USA, und genau dafuer gibt es in Deutschland
Abmahnungen (LG Muenchen I, 20.01.2022, Az. 3 O 17493/20). Die Dateien liegen
darum lokal, und die Seite ruft Google nie auf.

Zwei Dinge, die dieses Skript automatisch richtig macht:

1. **Variable Fonts.** Google liefert fuer mehrere Gewichte derselben Familie
   oft ein und dieselbe Datei. Wer sie unter verschiedenen Namen ablegt, laesst
   den Besucher dasselbe zweimal laden. Das Skript erkennt Doubletten am
   Inhalt und legt eine Datei je Familie, Stil und Zeichenbereich an, mit einer
   Gewichtsspanne im @font-face.

2. **Nur latin und latin-ext.** Google liefert bis zu zehn Zeichenbereiche mit,
   darunter Kyrillisch und Vietnamesisch. Fuer deutsche Texte sind zwei davon
   noetig.

Der Lizenztext gehoert dazu: Schriften von Google Fonts stehen fast immer unter
der SIL Open Font License, die verlangt, dass ihr Text mitgeliefert wird. Das
Skript legt eine Vorlage dafuer an, sobald sie fehlt.
"""

import hashlib
import os
import re
import sys
import urllib.parse
import urllib.request

HIER = os.path.dirname(os.path.abspath(__file__))
ZIEL = os.path.join(HIER, "assets", "fonts")

# Ein aktueller Browser-Kennzeichner, sonst liefert Google das aeltere
# Schriftformat statt woff2.
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

BEREICHE = ("latin", "latin-ext")


def kurzname(familie):
    return familie.lower().replace(" ", "")


def wunsch_zerlegen(angabe):
    """'Open Sans:400,700,400i' wird zu ('Open Sans', [(400,False),(700,False),(400,True)])"""
    if ":" not in angabe:
        sys.exit("Bitte in der Form \"Familie:400,700\" angeben, bekommen: %s" % angabe)
    familie, gewichte = angabe.split(":", 1)
    liste = []
    for g in gewichte.split(","):
        g = g.strip()
        kursiv = g.endswith("i")
        if kursiv:
            g = g[:-1]
        if not g.isdigit():
            sys.exit("Kein Schriftgewicht: %s" % g)
        liste.append((int(g), kursiv))
    return familie.strip(), liste


def css_adresse(wuensche):
    teile = []
    for familie, gewichte in wuensche:
        werte = sorted({("1,%d" % g) if k else ("0,%d" % g) for g, k in gewichte})
        teile.append("family=%s:ital,wght@%s"
                     % (urllib.parse.quote(familie), ";".join(werte)))
    return "https://fonts.googleapis.com/css2?" + "&".join(teile) + "&display=swap"


def hole(url, binaer=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    daten = urllib.request.urlopen(req, timeout=30).read()
    return daten if binaer else daten.decode("utf-8")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__.strip().split("\n\n")[1])

    wuensche = [wunsch_zerlegen(a) for a in sys.argv[1:]]
    css = hole(css_adresse(wuensche))

    # Google setzt vor jeden Block einen Kommentar mit dem Namen des Bereichs
    teile = re.split(r"/\*\s*([a-z-]+)\s*\*/", css)
    gefunden = []
    for i in range(1, len(teile), 2):
        bereich, block = teile[i], teile[i + 1]
        if bereich not in BEREICHE:
            continue
        gefunden.append({
            "bereich": bereich,
            "familie": re.search(r"font-family:\s*'([^']+)'", block).group(1),
            "stil": re.search(r"font-style:\s*(\w+)", block).group(1),
            "gewicht": int(re.search(r"font-weight:\s*(\d+)", block).group(1)),
            "url": re.search(r"url\((https://[^)]+\.woff2)\)", block).group(1),
            "unicode": re.search(r"unicode-range:\s*([^;]+);", block).group(1).strip(),
        })

    if not gefunden:
        sys.exit("Google hat fuer diese Angabe nichts geliefert. Schreibweise pruefen.")

    os.makedirs(ZIEL, exist_ok=True)

    # Laden, Doubletten am Inhalt erkennen, je Gruppe eine Datei ablegen
    nach_pruefsumme = {}
    for eintrag in gefunden:
        daten = hole(eintrag["url"], binaer=True)
        eintrag["daten"] = daten
        eintrag["summe"] = hashlib.md5(daten).hexdigest()

    gruppen = {}
    for e in gefunden:
        schluessel = (e["familie"], e["stil"], e["bereich"])
        gruppen.setdefault(schluessel, []).append(e)

    bloecke, gesamt = [], 0
    for (familie, stil, bereich), liste in sorted(gruppen.items()):
        summen = {e["summe"] for e in liste}
        gewichte = sorted(e["gewicht"] for e in liste)
        spanne = ("%d %d" % (gewichte[0], gewichte[-1])) if len(summen) == 1 and len(gewichte) > 1 \
                 else None

        if spanne:  # eine Datei, ganze Spanne
            paare = [(spanne, liste[0])]
        else:       # getrennte Dateien je Gewicht
            paare = [(str(e["gewicht"]), e) for e in liste]

        for gewichtsangabe, e in paare:
            name = "%s%s%s-%s.woff2" % (
                kurzname(familie),
                "" if spanne else "-%d" % e["gewicht"],
                "-italic" if stil == "italic" else "",
                bereich,
            )
            pfad = os.path.join(ZIEL, name)
            with open(pfad, "wb") as f:
                f.write(e["daten"])
            gesamt += len(e["daten"])
            print("%-42s %6.1f KB" % (name, len(e["daten"]) / 1024))

            bloecke.append(
                "@font-face {\n"
                "  font-family: '%s';\n"
                "  font-style: %s;\n"
                "  font-weight: %s;\n"
                "  font-display: swap;\n"
                "  src: url('assets/fonts/%s') format('woff2');\n"
                "  unicode-range: %s;\n"
                "}" % (familie, stil, gewichtsangabe, name, e["unicode"])
            )

    print("\n%d Dateien, zusammen %.1f KB." % (len(bloecke), gesamt / 1024))

    lizenz = os.path.join(ZIEL, "LIZENZ-SIL-OFL.txt")
    if not os.path.exists(lizenz):
        with open(lizenz, "w", encoding="utf-8") as f:
            f.write(
                "Die Schriften in diesem Ordner stehen unter der SIL Open Font License 1.1.\n"
                "Sie duerfen eingebettet, weitergegeben und auf einer Webseite ausgeliefert\n"
                "werden, auch kommerziell. Bedingung ist, dass dieser Lizenztext mitgeliefert\n"
                "wird und die Schriften nicht fuer sich allein verkauft werden.\n\n"
                "NOCH EINZUSETZEN: der vollstaendige Lizenztext der jeweiligen Schrift.\n"
                "Er liegt im Github-Projekt der Schrift als OFL.txt.\n"
            )
        print("Lizenz-Vorlage angelegt: assets/fonts/LIZENZ-SIL-OFL.txt")
        print("Den vollstaendigen OFL-Text noch einsetzen.")

    print("\nDiese Bloecke gehoeren oben in vorlage.html, anstelle der bisherigen:\n")
    print("\n".join(bloecke))


if __name__ == "__main__":
    main()
