// I traguardi storici (traguardi.json) nei Record, contro un ricalcolo fatto qui.
//
// NATO IL 07/11/2026, la notte della prima Divisione 1 del club. Verifica che:
//   - gli eroi scritti a mano siano ESATTAMENTE chi e' stato in campo in tutte le partite del
//     traguardo (righe con almeno un secondo), ne' uno di piu' ne' uno di meno;
//   - la partita "decisiva" sia l'ultima, e quella a cui i contatori di EA attribuiscono la
//     promozione (le ultime N partite prima della lettura che la mostra, README "Record e scalata");
//   - il traguardo stia nei Record con tutti gli eroi e il risultato giusto della decisiva;
//   - non compaia da nessun'altra parte: la festa in Home e' stata tolta l'08/11/2026, su
//     richiesta di Peppe, e questo controllo impedisce che torni per sbaglio.
//
// Uso:  node test_traguardi.js [percorso/index.html]

const fs = require("fs");
let JSDOM;
try { ({ JSDOM } = require("jsdom")); }
catch (e) { console.error("jsdom non installato: `npm install jsdom`. Senza, questo controllo non gira."); process.exit(2); }
const file = process.argv[2] || "index.html";
if (!fs.existsSync(file)) { console.error(`File non trovato: ${file}`); process.exit(1); }

let falliti = 0;
function verifica(descrizione, errori) {
  if (errori.length === 0) { console.log(`  ok    ${descrizione}`); return; }
  console.log(`  FAIL  ${descrizione}  ->  ${errori.length} differenze`);
  errori.slice(0, 5).forEach(e => console.log(`          ${e}`));
  falliti++;
}

const html = fs.readFileSync(file, "utf-8");
const ini = html.indexOf("const DATA = ") + "const DATA = ".length;
const fineDati = ini + html.slice(ini).search(/;\r?\n/);
const DATA = JSON.parse(html.slice(ini, fineDati));
const TRAG = DATA.traguardi || [];
const perId = new Map((DATA.matches || []).map(m => [m.match_id, m]));
const righe = id => (DATA.matchPlayers || {})[id] || [];

function apri(dati) {
  const BS = String.fromCharCode(92);
  const pagina = html.slice(0, ini) + JSON.stringify(dati).replace(/</g, BS + "u003c") + html.slice(fineDati);
  const nulla = () => {};
  return new JSDOM(pagina.replace(/<script id="lib-chartjs">[\s\S]*?<\/script>/, ""), {
    runScripts: "dangerously", pretendToBeVisual: true, url: "https://pesix97.github.io/lentoni-dashboard/",
    beforeParse(w) {
      w.Chart = function () { return { destroy() {}, update() {} }; }; w.Chart.register = nulla;
      const ctx = new Proxy({}, { get: (_, k) => {
        if (k === "createLinearGradient" || k === "createRadialGradient" || k === "createPattern") return () => ({ addColorStop: nulla });
        if (k === "measureText") return () => ({ width: 10 });
        if (k === "canvas") return { width: 1000, height: 1000 };
        return nulla; } });
      w.HTMLCanvasElement.prototype.getContext = () => ctx;
      w.HTMLCanvasElement.prototype.toDataURL = () => "data:,";
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener: nulla, removeEventListener: nulla, addListener: nulla, removeListener: nulla }));
      w.scrollTo = nulla;
    },
  });
}
const T = el => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
const pausa = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log(`\nTraguardi di questo titolo: ${TRAG.length}`);
  if (!TRAG.length) {
    const d = apri(DATA).window.document; await pausa(1500);
    verifica("nessun traguardo: niente Traguardi nei Record", T(d.getElementById("recordTraguardi")) ? ["c'e' un riquadro senza traguardi"] : []);
    process.exit(falliti ? 1 : 0);
  }

  // ---- I dati del traguardo, contro le partite
  const errD = { partite: [], eroi: [], decisiva: [] };
  const crono = [...DATA.matches].sort((a, b) => a.played_at < b.played_at ? -1 : 1);
  for (const t of TRAG) {
    const P = t.partite.map(id => perId.get(id));
    if (P.some(m => !m)) { errD.partite.push(`${t.id}: partite non trovate nei dati`); continue; }
    if (P.some((m, i) => i && m.played_at < P[i - 1].played_at)) errD.partite.push(`${t.id}: partite non in ordine di tempo`);
    // In campo in TUTTE le partite: almeno un secondo in ognuna.
    const conta = {};
    P.forEach(m => righe(m.match_id).forEach(p => { if ((p.seconds_played || 0) > 0) conta[p.player_name] = (conta[p.player_name] || 0) + 1; }));
    const tutti = Object.keys(conta).filter(n => conta[n] === P.length).sort();
    if (tutti.join() !== [...t.eroi].sort().join()) errD.eroi.push(`${t.id}: eroi [${t.eroi}], in campo in tutte [${tutti}]`);
    if (t.decisiva !== P[P.length - 1].match_id) errD.decisiva.push(`${t.id}: la decisiva non e' l'ultima partita`);
    // La promozione secondo EA: la lettura in cui cresce il contatore, e le ultime N partite prima.
    if (t.tipo === "promozione") {
      const H = DATA.history || [];
      const ev = [];
      for (let i = 1; i < H.length; i++) if (H[i].promotions > H[i - 1].promotions) {
        const n = Math.max(1, H[i].games_played - H[i - 1].games_played);
        ev.push(crono.filter(m => m.played_at <= H[i].fetched_at).slice(-n).map(m => m.match_id));
      }
      if (!ev.some(ids => ids.includes(t.decisiva) && ids[ids.length - 1] === t.decisiva))
        errD.decisiva.push(`${t.id}: EA non attribuisce nessuna promozione alla partita decisiva`);
    }
  }
  verifica("le partite del traguardo ci sono, in ordine", errD.partite);
  verifica("gli eroi sono esattamente chi e' stato in campo in tutte le partite", errD.eroi);
  verifica("la decisiva e' l'ultima, e i contatori di EA le danno la promozione", errD.decisiva);

  // ---- Nei Record, e solo li'
  const d = apri(DATA).window.document; await pausa(1500);
  const errR = [], errH = [];
  for (const t of TRAG) {
    const rec = d.querySelectorAll(`#recordTraguardi [data-traguardo="${t.id}"]`);
    if (rec.length !== 1) { errR.push(`${t.id}: ${rec.length} righe nei Record, attesa 1`); continue; }
    const testo = T(rec[0]);
    for (const n of t.eroi) if (!testo.includes(n)) errR.push(`${t.id}: nei Record manca ${n}`);
    const nomi = [...rec[0].querySelectorAll(".player-link")].map(x => x.dataset.player);
    if (nomi.join() !== t.eroi.join()) errR.push(`${t.id}: nomi cliccabili [${nomi}], eroi [${t.eroi}]`);
    const m = perId.get(t.decisiva);
    if (!testo.includes(`${m.goals_for}-${m.goals_against} contro ${m.opponent_name}`))
      errR.push(`${t.id}: "${testo}", attesa la decisiva ${m.goals_for}-${m.goals_against} contro ${m.opponent_name}`);
    // Fuori dai Record: nessun elemento del traguardo, e nessuna sezione "festa" nella Home.
    const fuori = [...d.querySelectorAll(`[data-traguardo="${t.id}"]`)].filter(x => !x.closest("#recordTraguardi"));
    if (fuori.length) errH.push(`${t.id}: compare anche fuori dai Record (${fuori.map(x => x.className || x.tagName).join(", ")})`);
  }
  if (d.getElementById("festa")) errH.push("in Home c'e' ancora la sezione della festa");
  verifica("il traguardo e' nei Record, con tutti gli eroi e la decisiva", errR);
  verifica("e da nessun'altra parte: niente festa in Home", errH);

  console.log(falliti === 0 ? "\nI traguardi tornano con il ricalcolo." : `\n${falliti} controlli falliti.`);
  process.exit(falliti === 0 ? 0 : 1);
})();
