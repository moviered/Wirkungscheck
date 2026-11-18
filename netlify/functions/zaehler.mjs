// Zaehlt, wie weit Besucher im Check kommen: Aufruf, Start, jede beantwortete
// Frage, Ergebnis, Eintragung. Daraus liest man ab, bei welcher Frage sie
// aussteigen. Angelegt 18.10.2026.
//
// Kein Cookie, keine Kennung, keine IP-Adresse, keine Antwort: Gespeichert
// wird nur je Monat eine Summe je Ereignis, also etwa { "start": 41,
// "muster-3": 30, "muster-3-ja": 12 }. Darum braucht der Zaehler kein Einwilligungs-Banner. In
// die Datenschutzerklaerung gehoert er trotzdem.
//
// Ablage: Netlify Blobs, Speicher "check-zaehler", ein Eintrag je Monat
// ("2026-10"). Vorschau-Deploys schreiben unter "test-2026-10", damit Proben
// die echten Zahlen nicht verfaelschen.
// Nachsehen: Netlify > Projekt > Data & Storage > Blobs, oder
//   netlify blobs:get check-zaehler 2026-10
//
// Quelle fuer getStore, getWithMetadata, setJSON mit onlyIfNew/onlyIfMatch und
// die starke Konsistenz: https://docs.netlify.com/build/data-and-storage/netlify-blobs/
// abgerufen am 18.10.2026, Paket @netlify/blobs 11.1.4.

import { getStore } from "@netlify/blobs";

// Sandras Check (25.10.2026): fuenf Muster statt Fragen. "muster-3" heisst
// Muster 3 beantwortet, "muster-3-ja" heisst dort "Ja, das kenne ich"
// gewaehlt. "ergebnis-leer": alle fuenf mit "Eher nicht" beantwortet.
const ANZAHL_MUSTER = 5;
const ERLAUBT = new Set(["aufruf", "start", "ergebnis", "ergebnis-leer", "eingetragen"]);
for (let i = 1; i <= ANZAHL_MUSTER; i++) {
  ERLAUBT.add("muster-" + i);
  ERLAUBT.add("muster-" + i + "-ja");
}

// Gleiches Muster wie in eintragen.js: nur die eigenen Seiten duerfen zaehlen.
function herkunftErlaubt(herkunft) {
  if (!herkunft) return false;
  const erlaubteListe = (process.env.ERLAUBTE_HERKUNFT || "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (erlaubteListe.includes(herkunft)) return true;
  if (/^https:\/\/[a-z0-9-]+--[a-z0-9-]+\.netlify\.app$/.test(herkunft)) return true; // Vorschau-Deploys
  if (/^http:\/\/localhost:\d+$/.test(herkunft)) return true; // lokale Arbeit
  return false;
}

export default async (req, context) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  if (!herkunftErlaubt(req.headers.get("origin") || "")) return new Response(null, { status: 403 });

  const ereignis = (await req.text()).trim().slice(0, 20);
  if (!ERLAUBT.has(ereignis)) return new Response(null, { status: 400 });

  const monat = new Date().toISOString().slice(0, 7);
  const echt = context.deploy && context.deploy.context === "production";
  const schluessel = (echt ? "" : "test-") + monat;
  const speicher = getStore({ name: "check-zaehler", consistency: "strong" });

  // Zwei gleichzeitige Besucher duerfen sich nicht gegenseitig ueberschreiben:
  // geschrieben wird nur, wenn der Eintrag seit dem Lesen unveraendert ist,
  // sonst neu lesen und noch einmal.
  for (let versuch = 0; versuch < 6; versuch++) {
    const alt = await speicher.getWithMetadata(schluessel, { type: "json" });
    const zahlen = (alt && alt.data) || {};
    zahlen[ereignis] = (zahlen[ereignis] || 0) + 1;
    const bedingung = alt ? { onlyIfMatch: alt.etag } : { onlyIfNew: true };
    const ergebnis = await speicher.setJSON(schluessel, zahlen, bedingung);
    if (ergebnis.modified) return new Response(null, { status: 204 });
  }
  console.error("Zaehler: Eintrag nach sechs Versuchen nicht geschrieben", ereignis);
  return new Response(null, { status: 503 });
};
