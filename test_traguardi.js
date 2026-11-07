// I traguardi storici (traguardi.json) e la festa in Home, contro un ricalcolo fatto qui.
//
// NATO IL 07/11/2026, la notte della prima Divisione 1 del club. Verifica che:
//   - gli eroi scritti a mano siano ESATTAMENTE chi e' stato in campo in tutte le partite del
//     traguardo (righe con almeno un secondo), ne' uno di piu' ne' uno di meno;
//   - la partita "decisiva" sia l'ultima, e quella a cui i contatori di EA attribuiscono la
//     promozione (le ultime N partite prima della lettura che la mostra, README "Record e scalata");
//   - ogni tessera della festa riporti cifre giuste (gol, assist, media, migliore in campo);
//   - la festa stia in Home finche' non c'e' una retrocessione dopo, e poi resti nei Record:
//     questo si prova su una simulazione, aggiungendo ai dati una retrocessione finta.
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
    verifica("nessun traguardo: niente festa in Home", T(d.getElementById("festa")) ? ["c'e' una festa senza traguardi"] : []);
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

  // ---- La festa in Home
  const d = apri(DATA).window.document; await pausa(1500);
  const errF = { festa: [], tessere: [], record: [] };
  for (const t of TRAG) {
    const f = d.querySelector(`#festa [data-traguardo="${t.id}"]`);
    if (!f) { errF.festa.push(`${t.id}: nessuna festa in Home`); continue; }
    const chip = [...f.querySelectorAll("[data-partita]")].map(x => x.dataset.partita);
    if (chip.join() !== t.partite.join()) errF.festa.push(`${t.id}: partite mostrate [${chip}], attese [${t.partite}]`);
    const dec = f.querySelector(".festa-partita.decisiva");
    if (!dec || dec.dataset.partita !== t.decisiva) errF.festa.push(`${t.id}: decisiva evidenziata sbagliata`);
    const P = t.partite.map(id => perId.get(id));
    const vinte = P.filter(m => m.win).length, gf = P.reduce((x, m) => x + m.goals_for, 0), gs = P.reduce((x, m) => x + m.goals_against, 0);
    const sotto = T(f.querySelector(".festa-sotto"));
    if (!sotto.includes(`${vinte} vittori`) || !sotto.includes(`${gf} gol fatti, ${gs} subiti`)) errF.festa.push(`${t.id}: "${sotto}", attese ${vinte} vittorie, ${gf}-${gs}`);
    const tessere = [...f.querySelectorAll("[data-eroe]")];
    if (tessere.map(x => x.dataset.eroe).join() !== t.eroi.join()) errF.tessere.push(`${t.id}: tessere [${tessere.map(x => x.dataset.eroe)}], eroi [${t.eroi}]`);
    for (const x of tessere) {
      const n = x.dataset.eroe;
      let g = 0, a = 0, v = 0, mom = 0, k = 0;
      P.forEach(m => { const p = righe(m.match_id).find(r => r.player_name === n); if (p) { k++; g += p.goals || 0; a += p.assists || 0; v += p.rating || 0; mom += p.mom ? 1 : 0; } });
      const cifre = [...x.querySelectorAll(".festa-cifre > span")].map(T).join(" ");
      const att = `${g} gol ${a} assist media ${(v / k).toFixed(2)}${mom ? ` ⭐ ${mom}` : ""}`;
      if (cifre.replace(/\s+/g, " ") !== att) errF.tessere.push(`${n}: "${cifre}", atteso "${att}"`);
      if (!x.querySelector(".player-link")) errF.tessere.push(`${n}: nome non cliccabile`);
    }
    const rec = d.querySelector(`#recordTraguardi [data-traguardo="${t.id}"]`);
    if (!rec) errF.record.push(`${t.id}: non c'e' nei Record`);
    else for (const n of t.eroi) if (!T(rec).includes(n)) errF.record.push(`${t.id}: nei Record manca ${n}`);
  }
  verifica("la festa in Home: partite, decisiva, vittorie e gol", errF.festa);
  verifica("una tessera per eroe, con gol, assist, media e migliore in campo giusti", errF.tessere);
  verifica("il traguardo resta nei Record, con tutti gli eroi", errF.record);

  // ---- Simulazione: una retrocessione dopo il traguardo
  const ultimaPartita = crono[crono.length - 1], ultimaLettura = DATA.history[DATA.history.length - 1];
  const finta = { ...ultimaPartita, match_id: "simulata-retrocessione", played_at: "2099-01-01T21:00:00+00:00", win: 0, loss: 1, tie: 0 };
  const sim = { ...DATA, matches: [finta, ...DATA.matches], matchPlayers: { ...DATA.matchPlayers, [finta.match_id]: [] },
    history: [...DATA.history, { ...ultimaLettura, fetched_at: "2099-01-01T22:00:00+00:00",
      relegations: ultimaLettura.relegations + 1, games_played: ultimaLettura.games_played + 1 }] };
  const ds = apri(sim).window.document; await pausa(1500);
  const errS = [];
  if (T(ds.getElementById("festa"))) errS.push("dopo una retrocessione la festa e' ancora in Home");
  for (const t of TRAG) if (!ds.querySelector(`#recordTraguardi [data-traguardo="${t.id}"]`)) errS.push(`${t.id}: sparito anche dai Record`);
  verifica("simulata una retrocessione: la festa lascia la Home e resta nei Record", errS);

  console.log(falliti === 0 ? "\nI traguardi tornano con il ricalcolo." : `\n${falliti} controlli falliti.`);
  process.exit(falliti === 0 ? 0 : 1);
})();
