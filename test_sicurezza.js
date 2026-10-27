// Un nome che arriva da fuori non deve mai diventare codice nella pagina.
//
// NATO IL 27/10/2026. La pagina inserisce HTML in oltre settanta punti, e i nomi ci finivano
// dentro cosi' come arrivavano da EA. I gamertag hanno un alfabeto ristretto, ma i nomi dei
// club avversari li sceglie chiunque: un club chiamato <img src=x onerror=...> avrebbe fatto
// eseguire il suo codice a chiunque aprisse la dashboard. Nessuno dei 317 avversari in
// archivio lo faceva: il buco era aperto, non usato.
//
// Questo controllo prende la pagina vera, AVVELENA i dati - nome di un avversario, nome di un
// club nella tabella avversari, nome da pro di un giocatore - e la apre in jsdom. Poi visita
// ogni sezione e chiede due cose:
//
//   1. nessun elemento iniettato esiste nella pagina (niente <img id="xss...">, nessun
//      attributo onerror da nessuna parte);
//   2. il nome si legge comunque, come testo: va neutralizzato, non fatto sparire.
//
// La protezione del blocco <script> dei dati (un nome con "</script>") e' del generatore, e
// la controlla test_pipeline.py (test_un_nome_con_script_non_chiude_il_blocco_dei_dati).
//
// Uso:  node test_sicurezza.js [percorso/index.html]

const fs = require("fs");

let JSDOM;
try {
  ({ JSDOM } = require("jsdom"));
} catch (e) {
  console.error("jsdom non installato: `npm install jsdom`. Senza, questo controllo non gira.");
  process.exit(2);
}

const file = process.argv[2] || "index.html";
if (!fs.existsSync(file)) {
  console.error(`File non trovato: ${file}`);
  process.exit(1);
}

let falliti = 0;
function verifica(descrizione, condizione, dettaglio) {
  if (condizione) {
    console.log(`  ok    ${descrizione}`);
  } else {
    console.log(`  FAIL  ${descrizione}${dettaglio ? "  ->  " + dettaglio : ""}`);
    falliti++;
  }
}

const VELENO = (id) => `<img src=x id="${id}" onerror="window.__xss='${id}'">Club${id}`;

let html = fs.readFileSync(file, "utf-8")
  .replace(/<script id="lib-chartjs">[\s\S]*?<\/script>/, "");
const inizio = html.indexOf("const DATA = ") + "const DATA = ".length;
// ";" seguito da a capo, LF o CRLF: la pagina generata su Windows ha i CRLF.
const fine = inizio + html.slice(inizio).search(/;\r?\n/);
const dati = JSON.parse(html.slice(inizio, fine));

console.log("\nI nomi che arrivano da fuori restano testo");

// Dove si avvelena. Se un archivio non ha uno di questi pezzi, quel pezzo si salta.
const iniettati = [];
if ((dati.matches || []).length) {
  dati.matches.slice(0, 3).forEach((m, i) => { m.opponent_name = VELENO("xssPartita" + i); });
  iniettati.push("xssPartita0");
}
const idAvv = Object.keys(dati.avversari || {})[0];
if (idAvv) { dati.avversari[idAvv].name = VELENO("xssAvversario"); iniettati.push("xssAvversario"); }
if ((dati.roster || []).length) {
  dati.roster.forEach((r, i) => { r.pro_name = VELENO("xssPro" + i); });
  iniettati.push("xssPro0");
}
verifica("ci sono dati da avvelenare", iniettati.length > 0, "archivio vuoto");

// Si rimette nella pagina come fa il generatore (ogni "<" come \u003c).
const nuovi = JSON.stringify(dati).replace(/</g, "\\u003c");
html = html.slice(0, inizio) + nuovi + html.slice(fine);

const nulla = () => {};
const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  url: "https://pesix97.github.io/lentoni-dashboard/",
  beforeParse(w) {
    w.Chart = function () { return { destroy() {}, update() {} }; };
    w.Chart.register = () => {};
    const ctx = new Proxy({}, {
      get: (_, k) => {
        if (k === "createLinearGradient" || k === "createRadialGradient" || k === "createPattern")
          return () => ({ addColorStop: nulla });
        if (k === "measureText") return () => ({ width: 10 });
        if (k === "canvas") return { width: 1000, height: 1000 };
        return nulla;
      },
    });
    w.HTMLCanvasElement.prototype.getContext = () => ctx;
    w.HTMLCanvasElement.prototype.toDataURL = () => "data:,";
    w.scrollTo = nulla;
  },
});

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await pausa(1200);
  const w = dom.window;
  const d = w.document;

  // Ogni sezione, una per una: una sezione costruita solo quando la si apre deve essere
  // controllata anche lei, non solo quella che si vede all'apertura.
  const sezioni = [...new Set([...d.querySelectorAll("section[id]")].map((s) => s.id))];
  for (const id of sezioni) {
    w.location.hash = "#" + id;
    w.dispatchEvent(new w.HashChangeEvent("hashchange"));
    await pausa(30);
  }
  // E il testa a testa, che si ridisegna quando cambiano i menu.
  const selA = d.getElementById("h2hA"), selB = d.getElementById("h2hB");
  if (selA && selB && selA.options.length > 1) {
    selB.value = selB.options[1].value;
    selB.dispatchEvent(new w.Event("change"));
  }
  await pausa(50);

  const elementi = iniettati.map((id) => d.getElementById(id)).filter(Boolean);
  verifica("nessun elemento iniettato esiste nella pagina", elementi.length === 0,
    elementi.map((e) => `<${e.tagName.toLowerCase()} id=${e.id}> dentro ${e.closest("section[id]")?.id || "?"}`).join("; "));
  const conOnerror = [...d.querySelectorAll("[onerror]")];
  verifica("nessun attributo onerror da nessuna parte", conOnerror.length === 0,
    `${conOnerror.length} elementi`);
  verifica("nessun codice iniettato e' partito", w.__xss === undefined, `window.__xss = ${w.__xss}`);

  const testo = d.body.textContent;
  verifica("il nome avvelenato si legge come testo, non sparisce",
    testo.includes('<img src=x id="xssPartita0"'),
    "il nome dell'avversario non compare da nessuna parte");
  verifica(`sezioni visitate: ${sezioni.length}`, sezioni.length > 5, `solo ${sezioni.length}`);

  console.log(falliti === 0 ? "\nNessun nome diventa codice." : `\n${falliti} controlli falliti.`);
  process.exit(falliti === 0 ? 0 : 1);
})();
