// Il livello degli avversari, ricalcolato dai dati grezzi e confrontato con cio' che la
// pagina STAMPA: il riquadro in cima ad Avversari e la voce "Contro avversari piu' forti"
// nelle curiosita' di ogni giocatore.
//
// NATO L'11/11/2026. Le due parti confrontavano lo skill rating dell'avversario, letto fino a
// sei settimane prima, con il NOSTRO di oggi. In FC 27 siamo passati da 1407 a 1742, quindi
// quasi tutti risultavano "piu' deboli" (180 partite su 252) e contro chi era "alla pari" si
// facevano meno punti che contro i piu' forti. La regola giusta: le due squadre lette nello
// stesso istante, cioe' il nostro skill rating all'ora in cui e' stato letto il loro.
//
// Questo file non chiama funzioni della pagina: legge DATA (partite, avversari, storico del
// club), rifa' le fasce per conto suo e confronta i numeri stampati. Controlla anche che sui
// dati veri la regola vecchia dia un risultato diverso: se coincidessero, il test non
// saprebbe distinguere il difetto.
//
// Uso:  node test_avversari.js [percorso/index.html]

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

const html = fs.readFileSync(file, "utf8");
const ini = html.indexOf("const DATA = ") + "const DATA = ".length;
const DATA = JSON.parse(html.slice(ini, ini + html.slice(ini).search(/;\r?\n/)));

// ---- Il riferimento ----------------------------------------------------------------------
const SOGLIA = 50;  // README, «Il livello degli avversari»: entro 50 punti si e' alla pari
const storia = (DATA.history || []).filter(h => h.skill_rating)
  .map(h => ({ t: Date.parse(h.fetched_at), sr: Number(h.skill_rating) }))
  .sort((a, b) => a.t - b.t);
// Una lettura dell'avversario fatta piu' di un giorno fuori dal nostro storico (l'archivio di
// un titolo chiuso, riletto durante quello dopo) non ha un nostro valore dello stesso momento.
const GIORNO = 24 * 3600 * 1000;
function nostroAl(iso) {
  const t = Date.parse(iso);
  if (isNaN(t) || t < storia[0].t - GIORNO || t > storia[storia.length - 1].t + GIORNO) return null;
  const prima = storia.filter(h => h.t <= t);
  return prima.length ? prima[prima.length - 1].sr : storia[0].sr;
}
function scarto(m) {
  const a = m && m.opponent_club_id ? (DATA.avversari || {})[String(m.opponent_club_id)] : null;
  if (!a || !a.skill_rating || !storia.length) return null;
  const nostro = nostroAl(a.fetched_at);
  return nostro === null ? null : Number(a.skill_rating) - nostro;
}
const fasciaDi = d => d > SOGLIA ? "Più forti di noi" : d < -SOGLIA ? "Più deboli di noi" : "Al nostro livello";

const attese = {};
const vecchie = {};
const oggi = Number((DATA.latest || {}).skill_rating);
for (const m of DATA.matches || []) {
  const d = scarto(m);
  if (d === null) continue;
  const f = fasciaDi(d);
  const a = attese[f] = attese[f] || { n: 0, v: 0, p: 0, s: 0, gf: 0, ga: 0, pt: 0 };
  a.n++; a.gf += m.goals_for || 0; a.ga += m.goals_against || 0;
  if (m.goals_for > m.goals_against) { a.v++; a.pt += 3; }
  else if (m.goals_for === m.goals_against) { a.p++; a.pt += 1; }
  else a.s++;
  const fv = fasciaDi(Number(DATA.avversari[String(m.opponent_club_id)].skill_rating) - oggi);
  vecchie[fv] = (vecchie[fv] || 0) + 1;
}

// ---- La pagina -----------------------------------------------------------------------------
const dom = new JSDOM(html.replace(/<script id="lib-chartjs">[\s\S]*?<\/script>/, ""), {
  runScripts: "dangerously", pretendToBeVisual: true, url: "https://pesix97.github.io/lentoni-dashboard/",
  beforeParse(w) {
    const nulla = () => {};
    const ctx = new Proxy({}, { get: (_, k) => {
      if (k === "createLinearGradient" || k === "createRadialGradient" || k === "createPattern") return () => ({ addColorStop: nulla });
      if (k === "measureText") return () => ({ width: 10 });
      if (k === "canvas") return { width: 1000, height: 1000 };
      return nulla; } });
    w.Chart = function () { return { destroy: nulla, update: nulla, data: { datasets: [] }, options: {} }; };
    w.Chart.register = nulla; w.Chart.defaults = new Proxy({}, { get: () => ({}) });
    w.matchMedia = () => ({ matches: false, addListener: nulla, removeListener: nulla, addEventListener: nulla, removeEventListener: nulla });
    w.IntersectionObserver = function () { return { observe: nulla, disconnect: nulla, unobserve: nulla }; };
    w.HTMLCanvasElement.prototype.getContext = () => ctx;
    w.HTMLCanvasElement.prototype.toDataURL = () => "data:,";
    w.scrollTo = nulla;
  },
});
const T = el => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

(async () => {
  await new Promise(r => setTimeout(r, 1500));
  const w = dom.window, d = w.document;

  console.log("\nLivello degli avversari: il riquadro");
  const errR = [];
  const stampate = {};
  d.querySelectorAll("#livelloAvversari tbody tr").forEach(tr => {
    const c = {}; tr.querySelectorAll("td[data-label]").forEach(td => { c[td.dataset.label] = T(td); });
    stampate[c.Fascia.replace(/^●\s*/, "")] = c;
  });
  const fasce = new Set([...Object.keys(attese), ...Object.keys(stampate)]);
  // Nessuna fascia attesa (titolo chiuso, avversari riletti dopo): il riquadro deve dirlo.
  if (!fasce.size && !/non si può confrontare|non è ancora disponibile/.test(T(d.getElementById("livelloAvversari"))))
    errR.push(`nessuna fascia, e il riquadro non lo spiega: «${T(d.getElementById("livelloAvversari")).slice(0, 80)}»`);
  for (const f of fasce) {
    const a = attese[f], c = stampate[f];
    if (!a) { errR.push(`${f}: stampata, ma nessuna partita attesa`); continue; }
    if (!c) { errR.push(`${f}: attese ${a.n} partite, la riga non c'e'`); continue; }
    const att = { Partite: String(a.n), Bilancio: `${a.v}V ${a.p}P ${a.s}S`, Gol: `${a.gf}-${a.ga}`, "Punti a partita": (a.pt / a.n).toFixed(2) };
    for (const k of Object.keys(att)) if (c[k] !== att[k]) errR.push(`${f}, ${k}: stampato «${c[k]}», atteso «${att[k]}»`);
  }
  verifica("le fasce tornano con il confronto nello stesso istante", errR);

  // Se la regola vecchia desse le stesse fasce, questo test non saprebbe distinguerle.
  const diverse = Object.keys({ ...vecchie, ...attese }).some(f => (vecchie[f] || 0) !== ((attese[f] || {}).n || 0));
  verifica("sui dati veri la regola vecchia (nostro skill rating di oggi) darebbe fasce diverse",
    diverse || !Object.keys(attese).length ? [] : ["le due regole coincidono: il test non distingue il difetto"]);

  console.log("\nLivello degli avversari: la voce nelle curiosita' di ogni giocatore");
  const errG = [];
  const inRosa = new Set((DATA.roster || []).map(r => r.player_name));
  const bottoni = [...d.querySelectorAll("#ossGiocatori .filter-btn")].map(b => b.dataset.n);
  if (!bottoni.length) errG.push("nessun giocatore nelle curiosita'");
  let mostrate = 0;
  for (const n of bottoni) {
    if (!inRosa.has(n)) continue;
    let forti = 0, deboli = 0;
    for (const m of DATA.matches || []) {
      const righe = (DATA.matchPlayers[m.match_id] || []).filter(p => p.player_name === n);
      const s = scarto(m);
      if (s === null) continue;
      if (s >= 0) forti += righe.length; else deboli += righe.length;
    }
    const b = d.querySelector(`#ossGiocatori .filter-btn[data-n="${n}"]`);
    b.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const voce = [...d.querySelectorAll("#ossCuriosita .panel > div")].find(x => T(x.children[0]) === "Contro avversari più forti");
    const attesa = forti >= 5 && deboli >= 5;
    if (!!voce !== attesa) { errG.push(`${n}: voce ${voce ? "presente" : "assente"}, attesa ${attesa ? "presente" : "assente"} (${forti} forti, ${deboli} deboli)`); continue; }
    if (!voce) continue;
    mostrate++;
    const nota = T(voce.children[2]);
    const num = [...nota.matchAll(/(\d+) partit/g)].map(x => Number(x[1]));
    if (num[0] !== forti || num[1] !== deboli) errG.push(`${n}: stampato «${nota}», attese ${forti} contro piu' forti e ${deboli} contro piu' deboli`);
  }
  if (bottoni.length && !mostrate && Object.keys(attese).length) errG.push("la voce non compare per nessun giocatore: il controllo non ha guardato niente");
  verifica(`i conteggi tornano per ogni giocatore (${mostrate} con la voce)`, errG);

  console.log(falliti ? `\n${falliti} controlli falliti` : "\nTutto a posto");
  process.exit(falliti ? 1 : 0);
})();
