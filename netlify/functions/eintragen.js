// Traegt eine Leserin des Wirkungschecks in Sandras bestehendes Wix-Formular
// ein (Video gegen Adresse). Angelegt 25.10.2026, ersetzt die Anbindung an
// einen Newsletter-Dienst aus der Check-Vorlage. Der Browser ruft nur diese Funktion auf, der
// Wix-Schluessel bleibt auf dem Server.
//
// Was hingeht: Vorname, E-Mail-Adresse und das Abo-Haekchen. Sonst nichts,
// keine Antworten, kein Ergebnis.
//
// Quelle fuer Endpunkt, Kopfzeilen und Koerper, abgerufen am 25.10.2026:
//   https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/create-submission.md
//   https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/about-submission-values.md
//   https://dev.wix.com/docs/go-headless/authentication/admin/make-rest-api-calls-with-an-api-key.md
//
//   POST https://www.wixapis.com/form-submission-service/v4/submissions
//   Kopfzeilen: Authorization: <API-Schluessel> (ohne "Bearer"),
//               wix-site-id: <Site-ID>, Content-Type: application/json
//   Koerper:    { "submission": { "formId": "<GUID>",
//                   "submissions": { "<target>": <Wert>, ... } } }
//   Schluessel in "submissions" sind die "target"-Namen der Formularfelder
//   (nicht ID, nicht Beschriftung). Ein unbekannter Schluessel laesst laut
//   Doku die ganze Einsendung scheitern. Ein BOOLEAN-Feld (Abo-Haekchen)
//   bekommt true. Berechtigung des Schluessels: Wix Forms (SCOPE.FORMS...).
//
// UNGEPRUEFT bis zum Test am 30.10.2026: ob eine Einsendung ueber die API
// dieselben Folgen hat wie eine auf der Wix-Seite (Kontakt anlegen, Abo-Status,
// Bestaetigungsmail, Automation). Siehe LIESMICH, Abschnitt zum Termin.
//
// Umgebungsvariablen (Netlify):
//   WIX_API_KEY, WIX_SITE_ID, WIX_FORM_ID
//   WIX_FELD_VORNAME, WIX_FELD_EMAIL, WIX_FELD_ABO   (target-Namen der Felder)
//   ERLAUBTE_HERKUNFT  (kommagetrennt, z. B. https://check.sicherauftreten.com)

const WIX_ENDPUNKT = "https://www.wixapis.com/form-submission-service/v4/submissions";
const PFLICHT = ["WIX_API_KEY", "WIX_SITE_ID", "WIX_FORM_ID", "WIX_FELD_VORNAME", "WIX_FELD_EMAIL", "WIX_FELD_ABO"];

const MELDUNG_EINGABE = "Bitte gib deinen Vornamen und eine gültige E-Mail-Adresse ein.";
const MELDUNG_ABO = "Bitte setz das Häkchen für die Anmeldung.";
const MELDUNG_BREMSE = "Zu viele Anfragen. Bitte versuch es in einer Stunde noch einmal.";
const MELDUNG_STOERUNG = "Die Anmeldung ist gerade nicht möglich. Bitte versuch es später noch einmal.";

// Aufrufbremse. Haelt nur so lange, wie Netlify denselben Container
// wiederverwendet, bremst also Dauerfeuer aus einer Quelle, ist aber keine
// harte Obergrenze. Gleiches Muster wie in der Check-Vorlage.
const FENSTER_MS = 60 * 60 * 1000; // eine Stunde
const MAX_JE_STUNDE = 5;
const aufrufe = new Map();

function zuVielAufrufe(kennung) {
  const jetzt = Date.now();
  const bisher = (aufrufe.get(kennung) || []).filter((t) => jetzt - t < FENSTER_MS);
  if (bisher.length >= MAX_JE_STUNDE) return true;
  bisher.push(jetzt);
  aufrufe.set(kennung, bisher);
  if (aufrufe.size > 5000) aufrufe.clear();
  return false;
}

// Nur die eigenen Seiten duerfen diese Funktion aufrufen.
function erlaubteListe() {
  return (process.env.ERLAUBTE_HERKUNFT || "").split(",").map((h) => h.trim()).filter(Boolean);
}
function herkunftErlaubt(herkunft) {
  if (!herkunft) return false;
  if (erlaubteListe().includes(herkunft)) return true;
  if (/^https:\/\/[a-z0-9-]+--[a-z0-9-]+\.netlify\.app$/.test(herkunft)) return true; // Vorschau-Deploys
  if (/^http:\/\/localhost:\d+$/.test(herkunft)) return true; // lokale Arbeit
  return false;
}

const EMAIL_MUSTER = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

exports.handler = async (event) => {
  const herkunft = (event.headers && (event.headers.origin || event.headers.Origin)) || "";
  const erlaubt = herkunftErlaubt(herkunft);
  const headers = {
    "Access-Control-Allow-Origin": erlaubt ? herkunft : (erlaubteListe()[0] || ""),
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
  };
  const antwort = (status, inhalt) => ({ statusCode: status, headers, body: JSON.stringify(inhalt) });

  if (event.httpMethod === "OPTIONS") return { statusCode: erlaubt ? 204 : 403, headers, body: "" };
  if (event.httpMethod !== "POST") return antwort(405, { fehler: MELDUNG_STOERUNG });
  if (!erlaubt) return antwort(403, { fehler: MELDUNG_STOERUNG });

  const ip = (event.headers && (event.headers["x-nf-client-connection-ip"] ||
                                event.headers["client-ip"] ||
                                event.headers["x-forwarded-for"])) || "unbekannt";
  if (zuVielAufrufe(String(ip).split(",")[0].trim())) return antwort(429, { fehler: MELDUNG_BREMSE });

  // Eingabe pruefen
  let vorname, email, abo, honig;
  try {
    const body = JSON.parse(event.body || "{}");
    vorname = String(body.vorname || "").trim();
    email = String(body.email || "").trim();
    abo = body.abo === true;
    honig = String(body.webseite || "").trim();
  } catch {
    return antwort(400, { fehler: MELDUNG_EINGABE });
  }
  // Verstecktes Feld ausgefuellt: ein Programm, keine Leserin. Still annehmen,
  // nichts weitergeben.
  if (honig) return antwort(200, { ok: true });
  if (!vorname || vorname.length > 100 || /[<>]/.test(vorname) ||
      !email || email.length > 254 || !EMAIL_MUSTER.test(email)) {
    return antwort(400, { fehler: MELDUNG_EINGABE });
  }
  // Ohne Haekchen keine Einsendung.
  if (!abo) return antwort(400, { fehler: MELDUNG_ABO });

  // Einrichtung pruefen
  const fehlt = PFLICHT.filter((n) => !process.env[n]);
  if (fehlt.length) {
    console.error("eintragen: Umgebungsvariablen fehlen in Netlify: " + fehlt.join(", ") +
                  ". Einsendung an Wix nicht moeglich.");
    return antwort(500, { fehler: MELDUNG_STOERUNG });
  }

  const submissions = {};
  submissions[process.env.WIX_FELD_VORNAME] = vorname;
  submissions[process.env.WIX_FELD_EMAIL] = email;
  submissions[process.env.WIX_FELD_ABO] = true;

  try {
    const wix = await fetch(WIX_ENDPUNKT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": process.env.WIX_API_KEY,
        "wix-site-id": process.env.WIX_SITE_ID,
      },
      body: JSON.stringify({ submission: { formId: process.env.WIX_FORM_ID, submissions } }),
      signal: AbortSignal.timeout(10000),
    });

    if (!wix.ok) {
      // Ins Log nur Status und Fehlercode, keine Adresse.
      let code = "";
      try {
        const d = await wix.json();
        code = (d && d.details && d.details.applicationError && d.details.applicationError.code) ||
               (d && d.message) || "";
      } catch { /* kein JSON */ }
      console.error("eintragen: Wix antwortet " + wix.status + " " + String(code).slice(0, 200));
      return antwort(502, { fehler: MELDUNG_STOERUNG });
    }

    let status = "";
    try { const d = await wix.json(); status = (d && d.submission && d.submission.status) || ""; } catch { /* egal */ }
    console.log("eintragen: Einsendung angenommen" + (status ? ", Status " + status : ""));
    return antwort(200, { ok: true });
  } catch (fehler) {
    console.error("eintragen: Wix nicht erreichbar: " + (fehler && fehler.name));
    return antwort(502, { fehler: MELDUNG_STOERUNG });
  }
};
