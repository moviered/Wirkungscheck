// Werkzeug fuer den Termin mit Sandra am 30.10.2026. Angelegt 25.10.2026,
// NICHT ausgefuehrt. Braucht Node 18 oder neuer, keine Pakete.
//
// Der Schluessel wird nur fuer diesen Aufruf in die Shell gegeben und nirgends
// gespeichert. Beispiel (Leerzeichen am Zeilenanfang haelt ihn aus dem Verlauf):
//
//    export WIX_API_KEY='...'  WIX_SITE_ID='...'
//   node wix-test.mjs formulare
//      listet alle Wix-Formulare der Seite: ID, Name, Felder mit target-Namen
//
//    export WIX_FORM_ID='...'
//   node wix-test.mjs formular
//      zeigt nur dieses Formular, mit den Feldern
//
//    export WIX_FELD_VORNAME='...' WIX_FELD_EMAIL='...' WIX_FELD_ABO='...'
//   node wix-test.mjs einsenden test@beispiel.de Testname --wirklich
//      schickt GENAU EINE Einsendung, wie sie eintragen.js schicken wuerde
//
// Quellen, abgerufen am 25.10.2026:
//   Formulare auflisten: GET https://www.wixapis.com/form-schema-service/v4/forms?namespace=wix.form_app.form
//     https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/list-forms.md
//   Ein Formular:        GET https://www.wixapis.com/form-schema-service/v4/forms/{formId}
//     https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/get-form.md
//   Einsendung:          POST https://www.wixapis.com/form-submission-service/v4/submissions
//     https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/create-submission.md
//   Kopfzeilen: Authorization: <Schluessel>, wix-site-id: <Site-ID>
//     https://dev.wix.com/docs/go-headless/authentication/admin/make-rest-api-calls-with-an-api-key.md

const BASIS = "https://www.wixapis.com";
const NAMESPACE = "wix.form_app.form";

function brauche(...namen) {
  const fehlt = namen.filter((n) => !process.env[n]);
  if (fehlt.length) {
    console.error("Fehlt in der Shell: " + fehlt.join(", "));
    process.exit(1);
  }
}

function kopf() {
  return {
    "Authorization": process.env.WIX_API_KEY,
    "wix-site-id": process.env.WIX_SITE_ID,
    "Content-Type": "application/json",
  };
}

async function rufe(pfad, optionen = {}) {
  const r = await fetch(BASIS + pfad, { ...optionen, headers: kopf(), signal: AbortSignal.timeout(15000) });
  const text = await r.text();
  let daten;
  try { daten = JSON.parse(text); } catch { daten = text; }
  if (!r.ok) {
    console.error("Wix antwortet " + r.status + ":");
    console.error(typeof daten === "string" ? daten.slice(0, 1500) : JSON.stringify(daten, null, 2).slice(0, 1500));
    process.exit(2);
  }
  return daten;
}

// Beschriftung kann Text oder ein Rich-Text-Objekt sein (Haekchen-Felder).
function textAus(wert) {
  if (wert == null) return "";
  if (typeof wert === "string") return wert;
  const teile = [];
  (function lauf(o) {
    if (!o || typeof o !== "object") return;
    if (o.textData && typeof o.textData.text === "string") teile.push(o.textData.text);
    for (const v of Object.values(o)) lauf(v);
  })(wert);
  return teile.join(" ");
}

// Sammelt alle Felder mit target-Namen, egal ob unter "fields" oder "formFields".
function felder(form) {
  const gesehen = new Map();
  for (const f of form.fields || []) {
    if (!f.target) continue;
    gesehen.set(f.target, {
      target: f.target,
      typ: (f.view && f.view.fieldType) || "",
      beschriftung: textAus(f.view && f.view.label),
      pflicht: !!(f.validation && f.validation.required),
    });
  }
  for (const f of form.formFields || []) {
    const io = f.inputOptions || {};
    if (!io.target) continue;
    const alt = gesehen.get(io.target) || {};
    gesehen.set(io.target, {
      target: io.target,
      typ: alt.typ || f.identifier || "",
      eingabe: io.inputType || "",
      beschriftung: alt.beschriftung || textAus(io),
      pflicht: alt.pflicht || !!io.required,
    });
  }
  return [...gesehen.values()];
}

function zeigeFormular(form) {
  console.log("\nFormular: " + (form.properties && form.properties.name || form.name || "(ohne Name)"));
  console.log("  WIX_FORM_ID = " + form.id);
  for (const f of felder(form)) {
    console.log("  target " + f.target.padEnd(28) + (f.typ || "").padEnd(22) + (f.eingabe || "").padEnd(9) +
                (f.pflicht ? "Pflicht  " : "         ") + (f.beschriftung || "").slice(0, 60));
  }
  console.log("  Hinweis: Vorname = CONTACTS_FIRST_NAME, E-Mail = CONTACTS_EMAIL, Abo-Haekchen = CONTACTS_SUBSCRIBE");
}

const [befehl, ...rest] = process.argv.slice(2);

if (befehl === "formulare") {
  brauche("WIX_API_KEY", "WIX_SITE_ID");
  const d = await rufe("/form-schema-service/v4/forms?namespace=" + NAMESPACE + "&paging.limit=100");
  const liste = d.forms || [];
  console.log(liste.length + " Formular(e) im Bereich " + NAMESPACE);
  for (const form of liste) zeigeFormular(form);
} else if (befehl === "formular") {
  brauche("WIX_API_KEY", "WIX_SITE_ID", "WIX_FORM_ID");
  const d = await rufe("/form-schema-service/v4/forms/" + encodeURIComponent(process.env.WIX_FORM_ID));
  zeigeFormular(d.form || d);
} else if (befehl === "einsenden") {
  brauche("WIX_API_KEY", "WIX_SITE_ID", "WIX_FORM_ID", "WIX_FELD_VORNAME", "WIX_FELD_EMAIL", "WIX_FELD_ABO");
  const wirklich = rest.includes("--wirklich");
  const [adresse, vorname = "Test"] = rest.filter((x) => x !== "--wirklich");
  if (!adresse || !adresse.includes("@")) {
    console.error("Aufruf: node wix-test.mjs einsenden <test-adresse> [vorname] --wirklich");
    process.exit(1);
  }
  const submissions = {
    [process.env.WIX_FELD_VORNAME]: vorname,
    [process.env.WIX_FELD_EMAIL]: adresse,
    [process.env.WIX_FELD_ABO]: true,
  };
  const koerper = { submission: { formId: process.env.WIX_FORM_ID, submissions } };
  console.log("Geht an Wix:\n" + JSON.stringify(koerper, null, 2));
  if (!wirklich) {
    console.log("\nNichts geschickt. Mit --wirklich am Ende geht genau diese eine Einsendung raus.");
    process.exit(0);
  }
  const d = await rufe("/form-submission-service/v4/submissions", { method: "POST", body: JSON.stringify(koerper) });
  const s = d.submission || {};
  console.log("\nAngenommen. Einsendung " + s.id + ", Status " + s.status + ", Kontakt " + (s.contactId || "(keiner gemeldet)"));
  console.log("Jetzt pruefen: Kontakt in Wix (Abo-Status), Postfach der Testadresse.");
} else {
  console.log("Befehle: formulare | formular | einsenden <adresse> [vorname] --wirklich");
  console.log("Anleitung oben in dieser Datei und im LIESMICH, Abschnitt zum Termin am 30.10.");
}
