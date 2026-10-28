// L'Indice di Forza e il testa a testa, ricalcolati DA ZERO e confrontati con cio' che la
// pagina STAMPA.
//
// NATO IL 28/10/2026. Gli altri controlli verificano che la pagina sia coerente con se
// stessa: i pezzi sommano al totale, il riquadro alla colonna. Un errore che sbaglia tutte le
// parti allo stesso modo li passa tutti. E' successo: nella forma recente il MOTM era una
// frazione (0,20) misurata su una scala in percentuale (0-50), quindi valeva quasi zero per
// tutti - e le voci del testa a testa sommavano lo stesso, al centesimo.
//
// Qui il riferimento e' indipendente: i pesi, le scale e le regole sono riscritti da capo
// dal README, e i numeri partono dai dati grezzi (carriere EA e righe di partita). Questo
// file NON chiama nessuna funzione della pagina: la apre, legge i numeri stampati, e li
// rifa' per conto suo.
//
// Se si cambia di proposito un peso o una scala, va cambiato anche qui. E' voluto: una
// modifica ai pesi deve essere una decisione, non un effetto collaterale.
//
// Uso:  node test_indice.js [percorso/index.html]

const fs = require("fs");
let JSDOM;
try { ({ JSDOM } = require("jsdom")); }
catch (e) { console.error("jsdom non installato: `npm install jsdom`. Senza, questo controllo non gira."); process.exit(2); }

const file = process.argv[2] || "index.html";
if (!fs.existsSync(file)) { console.error(`File non trovato: ${file}`); process.exit(1); }

let falliti = 0;
function verifica(descrizione, errori, campione) {
  if (errori.length === 0) { console.log(`  ok    ${descrizione}`); return; }
  console.log(`  FAIL  ${descrizione}  ->  ${errori.length} differenze`);
  errori.slice(0, campione || 4).forEach(e => console.log(`          ${e}`));
  falliti++;
}

// ---------------------------------------------------------------------------------------
// Le regole, riscritte dal README (sezioni "I pesi dell'Indice di Forza", "Una percentuale
// vale quanto il suo denominatore", "I pesi della tecnica sono quattro", "Gol subiti dei
// difensori", "I campioni piccoli non pesano quanto quelli grandi").
// ---------------------------------------------------------------------------------------
const PESI = { rating: 0.35, contrib: 0.30, motm: 0.05, tech: 0.30, disc: 0.05 };
const SCALE = { rating: [5, 10], contrib: [0, 4], motm: [0, 50], tech: [0, 100], disc: [0, 0.2] };
const PESI_TEC = {
  DIFENSORI:      { passaggi: 0.25, contrasti: 0.40, tiro: 0.05, difesa: 0.30 },
  CENTROCAMPISTI: { passaggi: 0.40, contrasti: 0.30, tiro: 0.30, difesa: 0 },
  ESTERNI:        { passaggi: 0.40, contrasti: 0.20, tiro: 0.40, difesa: 0 },
  TREQUARTISTA:   { passaggi: 0.50, contrasti: 0.10, tiro: 0.40, difesa: 0 },
  ATTACCANTI:     { passaggi: 0.45, contrasti: 0.10, tiro: 0.45, difesa: 0 },
};
const SCALE_TEC = { passaggi: [60, 90], contrasti: [5, 50], tiro: [10, 50], difesa: [4, 0] };
const PROVE_CREDIBILI = { passaggi: 150, contrasti: 40, tiro: 25, difesa: 5 };
const PEZZI = ["passaggi", "contrasti", "tiro", "difesa"];
const PRESENZE_FORMA = 4, CRED_FORMA = 5;          // forma: almeno 4 presenze, n/(n+5)
const MIN_REPARTO = 2, CRED_REPARTO = 8;            // reparti: 0 fino a 2 partite, poi (n-2)/(n-2+8)
const IN_CLASSIFICA_REPARTO = 3;

const scala = (v, [a, b]) => Math.max(0, Math.min(1, ((v || 0) - a) / (b - a)));
const pesiDi = g => PESI_TEC[g] || PESI_TEC.ATTACCANTI;

// ---------------------------------------------------------------------------------------
// I dati grezzi, letti dalla pagina (sono quelli del generatore, controllati contro il
// database da test_pipeline.py).
// ---------------------------------------------------------------------------------------
const html = fs.readFileSync(file, "utf-8");
const ini = html.indexOf("const DATA = ") + "const DATA = ".length;
const DATA = JSON.parse(html.slice(ini, ini + html.slice(ini).search(/;\r?\n/)));
// La rosa: solo chi ha almeno MIN_GAMES partite di carriera (README, "La scheda si apre anche
// per chi non e' ancora in rosa"). La soglia cambia col titolo e il generatore la scrive nella
// pagina: 0 per FC 27, 30 per FC 26. Anche la media del club si calcola su questa rosa.
const sogliaRosa = html.match(/const LEADERBOARD_MIN_GAMES = (\d+);/);
if (!sogliaRosa) { console.error("Soglia della rosa (LEADERBOARD_MIN_GAMES) non trovata nella pagina."); process.exit(1); }
const roster = (DATA.roster || []).filter(r => r.games_played >= Number(sogliaRosa[1]));
const RG = DATA.roleGroups || {};
const MATCHES = DATA.matches || [];
const righeDi = m => (DATA.matchPlayers || {})[m.match_id] || [];
// I nomi arrivano neutralizzati in pagina (vedi test_sicurezza.js): qui sono quelli grezzi,
// e i gamertag della rosa non contengono caratteri da neutralizzare.

// Reparto abituale: roles.json, altrimenti la posizione EA piu' frequente (a parita' la
// prima vista, nell'ordine delle partite), altrimenti la posizione preferita.
const conteggioPos = new Map();
MATCHES.forEach(m => righeDi(m).forEach(p => {
  if (!p.pos) return;
  if (!conteggioPos.has(p.player_name)) conteggioPos.set(p.player_name, new Map());
  const c = conteggioPos.get(p.player_name); c.set(p.pos, (c.get(p.pos) || 0) + 1);
}));
const posPrincipale = n => {
  const c = conteggioPos.get(n); if (!c) return null;
  let migliore = null; c.forEach((v, k) => { if (!migliore || v > migliore[1]) migliore = [k, v]; });
  return migliore[0];
};
const repartoAbituale = r => (RG.players || {})[r.player_name]
  || (RG.macro || {})[posPrincipale(r.player_name) || r.favorite_position] || null;

// Gol subiti ogni 90': solo righe con il dato e con almeno un secondo in campo.
function golSubiti(righe) {
  let gol = 0, sec = 0;
  righe.forEach(p => {
    if (p.goals_conceded === null || p.goals_conceded === undefined || !(p.seconds_played > 0)) return;
    gol += p.goals_conceded; sec += p.seconds_played;
  });
  return { valore: sec > 0 ? gol * 5400 / sec : 0, partite: sec / 5400 };
}
const righePerNome = new Map();
MATCHES.forEach(m => righeDi(m).forEach(p => {
  if (!righePerNome.has(p.player_name)) righePerNome.set(p.player_name, []);
  righePerNome.get(p.player_name).push(p);
}));

// La media del club: dai totali di carriera (tentativi stimati da riusciti e percentuale),
// e per i gol subiti da tutte le righe del titolo.
const stima = (fatti, perc) => (perc > 0 ? (fatti || 0) / (perc / 100) : 0);
const somma = (lista, f) => lista.reduce((t, x) => t + f(x), 0);
const tuttiGs = (() => {
  let gol = 0, sec = 0;
  MATCHES.forEach(m => righeDi(m).forEach(p => {
    if (p.goals_conceded === null || p.goals_conceded === undefined || !(p.seconds_played > 0)) return;
    gol += p.goals_conceded; sec += p.seconds_played;
  }));
  return sec > 0 ? gol * 5400 / sec : 2.5;
})();
const MEDIA = {
  passaggi:  somma(roster, r => r.passes_made || 0)  / somma(roster, r => stima(r.passes_made, r.pass_success_rate)) * 100,
  contrasti: somma(roster, r => r.tackles_made || 0) / somma(roster, r => stima(r.tackles_made, r.tackle_success_rate)) * 100,
  tiro:      somma(roster, r => r.goals || 0)        / somma(roster, r => stima(r.goals, r.shot_success_rate)) * 100,
  difesa:    tuttiGs,
};

// Ogni pezzo tirato verso la media del club in proporzione alle prove, poi sulla sua scala.
function quote(val, prove) {
  const q = {};
  PEZZI.forEach(k => {
    const n = prove[k] || 0, c = n > 0 ? n / (n + PROVE_CREDIBILI[k]) : 0;
    q[k] = scala(c * (val[k] || 0) + (1 - c) * MEDIA[k], SCALE_TEC[k]);
  });
  return q;
}
const tecnicaDa = (q, g) => 100 * PEZZI.reduce((t, k) => t + (pesiDi(g)[k] || 0) * q[k], 0);

function voci(grezzi) {
  return { rating: scala(grezzi.rating, SCALE.rating), contrib: scala(grezzi.contrib, SCALE.contrib),
           motm: scala(grezzi.motmPct, SCALE.motm), tech: scala(grezzi.tech, SCALE.tech),
           disc: scala(grezzi.disc, SCALE.disc) };
}
const punteggio = v => Math.max(0, Math.min(100,
  100 * (PESI.rating * v.rating + PESI.contrib * v.contrib + PESI.motm * v.motm + PESI.tech * v.tech - PESI.disc * v.disc)));

// ---- Storico: carriere EA. Tentativi stimati, ma mai meno di quelli contati in archivio.
const STORICO = new Map(roster.map(r => {
  const n = r.player_name, gp = r.games_played || 0, arch = righePerNome.get(n) || [];
  const gs = golSubiti(arch);
  const val = { passaggi: r.pass_success_rate, contrasti: r.tackle_success_rate, tiro: r.shot_success_rate, difesa: gs.valore };
  const prove = {
    passaggi:  Math.max(stima(r.passes_made, r.pass_success_rate),   somma(arch, p => p.pass_attempts || 0)),
    contrasti: Math.max(stima(r.tackles_made, r.tackle_success_rate), somma(arch, p => p.tackle_attempts || 0)),
    tiro:      Math.max(stima(r.goals, r.shot_success_rate),          somma(arch, p => p.shots || 0)),
    difesa:    gs.partite,
  };
  const g = repartoAbituale(r), q = quote(val, prove);
  const grezzi = { rating: r.rating_ave, contrib: gp ? (r.goals + r.assists) / gp : 0,
                   motmPct: gp ? r.man_of_the_match / gp * 100 : 0, tech: tecnicaDa(q, g), disc: gp ? r.red_cards / gp : 0 };
  const v = voci(grezzi);
  return [n, { g, val, q, grezzi, v, score: punteggio(v) }];
}));

// ---- Forma: le ultime N partite archiviate (0 = tutte), stessi pesi e scale.
function forma(finestra) {
  const scelte = finestra > 0 ? MATCHES.slice(0, finestra) : MATCHES;
  const per = new Map();
  scelte.forEach(m => righeDi(m).forEach(p => {
    if (!per.has(p.player_name)) per.set(p.player_name, []);
    per.get(p.player_name).push(p);
  }));
  const out = new Map();
  per.forEach((lst, n) => {
    const k = lst.length; if (k < PRESENZE_FORMA) return;
    const s = f => somma(lst, p => p[f] || 0);
    const gs = golSubiti(lst);
    const val = { passaggi: s("pass_attempts") ? s("passes_made") / s("pass_attempts") * 100 : 0,
                  contrasti: s("tackle_attempts") ? s("tackles_made") / s("tackle_attempts") * 100 : 0,
                  tiro: s("shots") ? s("goals") / s("shots") * 100 : 0, difesa: gs.valore };
    const prove = { passaggi: s("pass_attempts"), contrasti: s("tackle_attempts"), tiro: s("shots"), difesa: gs.partite };
    const g = STORICO.has(n) ? STORICO.get(n).g : null, q = quote(val, prove);
    const grezzi = { rating: s("rating") / k, contrib: (s("goals") + s("assists")) / k,
                     motmPct: s("mom") / k * 100, tech: tecnicaDa(q, g), disc: s("red_cards") / k };
    const v = voci(grezzi);
    out.set(n, { games: k, val, q, grezzi, v, score: punteggio(v) });
  });
  return out;
}

// ---- Il miscuglio: la forma pesa peso x n/(n+5).
function miscela(finestra, peso) {
  const F = forma(finestra), ris = new Map();
  STORICO.forEach((st, n) => {
    const f = F.get(n), pf = f ? peso * f.games / (f.games + CRED_FORMA) : 0;
    const mix = (a, b) => (f ? (1 - pf) * a + pf * b : a);
    const v = {}; Object.keys(st.v).forEach(k => { v[k] = mix(st.v[k], f ? f.v[k] : 0); });
    const grezzi = {}; Object.keys(st.grezzi).forEach(k => { grezzi[k] = mix(st.grezzi[k], f ? f.grezzi[k] : 0); });
    const q = {}; PEZZI.forEach(k => { q[k] = f && pf > 0 ? (1 - pf) * st.q[k] + pf * f.q[k] : st.q[k]; });
    ris.set(n, { blended: mix(st.score, f ? f.score : 0), storico: st.score, forma: f ? f.score : null,
                 presenze: f ? f.games : 0, haForma: !!f, v, grezzi, q, g: st.g });
  });
  return ris;
}

// ---- Reparto per reparto: il reparto della singola partita, correzione verso la media.
function repartoPartita(mid, n, pos) {
  const ecc = (RG.exceptions || {})[mid + "|" + n]; if (ecc) return ecc;
  const man = (RG.players || {})[n], ea = (RG.macro || {})[pos];
  if (!man) return ea || null;
  const attesa = (RG.eaLabels || {})[n] || posPrincipale(n);
  if (pos && attesa && pos !== attesa) return ea || man;
  return man;
}
const credReparto = n => (n - MIN_REPARTO <= 0 ? 0 : (n - MIN_REPARTO) / (n - MIN_REPARTO + CRED_REPARTO));
function versoLaMedia(valori, partite) {
  const w = partite.map(credReparto), sw = w.reduce((a, b) => a + b, 0);
  const media = sw > 0 ? valori.reduce((t, v, i) => t + v * w[i], 0) / sw : valori.reduce((a, b) => a + b, 0) / valori.length;
  return valori.map((v, i) => w[i] * v + (1 - w[i]) * media);
}
function reparti() {
  const inRosa = new Set(roster.map(r => r.player_name)), agg = new Map();
  MATCHES.forEach(m => righeDi(m).forEach(p => {
    if (!inRosa.has(p.player_name)) return;
    const g = repartoPartita(m.match_id, p.player_name, p.pos); if (!g) return;
    const k = p.player_name + "|" + g;
    if (!agg.has(k)) agg.set(k, { nome: p.player_name, g, righe: [] });
    agg.get(k).righe.push(p);
  }));
  return [...agg.values()].map(a => {
    const lst = a.righe, k = lst.length, s = f => somma(lst, p => p[f] || 0), gs = golSubiti(lst);
    const val = { passaggi: s("pass_attempts") ? s("passes_made") / s("pass_attempts") * 100 : 0,
                  contrasti: s("tackle_attempts") ? s("tackles_made") / s("tackle_attempts") * 100 : 0,
                  tiro: s("shots") ? s("goals") / s("shots") * 100 : 0, difesa: gs.valore };
    const q = quote(val, { passaggi: s("pass_attempts"), contrasti: s("tackle_attempts"), tiro: s("shots"), difesa: gs.partite });
    return { nome: a.nome, g: a.g, games: k, gol: s("goals"), assist: s("assists"), rating: s("rating") / k,
             contrib: (s("goals") + s("assists")) / k, motmPct: s("mom") / k * 100, tech: tecnicaDa(q, a.g),
             disc: s("red_cards") / k, q };
  });
}

// ---------------------------------------------------------------------------------------
// La pagina vera, aperta come la apre un browser.
// ---------------------------------------------------------------------------------------
const nulla = () => {};
const dom = new JSDOM(html.replace(/<script id="lib-chartjs">[\s\S]*?<\/script>/, ""), {
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
    w.scrollTo = nulla;
  },
});
const T = el => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
const num = s => { const m = String(s).replace(/−/g, "-").match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };
const PEZZO_DA_ETICHETTA = { "passaggi riusciti": "passaggi", "contrasti riusciti": "contrasti", "tiri trasformati": "tiro", "gol subiti ogni 90'": "difesa",
  "Passaggi riusciti": "passaggi", "Contrasti vinti": "contrasti", "Realizzazione": "tiro", "Gol subiti ogni 90'": "difesa" };
const VOCE_DA_ETICHETTA = { "Media voto": "rating", "Gol+assist a partita": "contrib", "Efficienza tecnica": "tech", "Migliore in campo": "motm", "Cartellini rossi": "disc" };
// I punti scritti come "+1.6 punti a NOME" / "−1.6 punti a NOME" / "pari", dal punto di vista
// del giocatore di sinistra.
function puntiDaTesto(t, sinistra) {
  if (/^pari/.test(t)) return 0;
  const chi = t.split(" punti a ")[1].trim();
  return chi === sinistra ? Math.abs(num(t)) : -Math.abs(num(t));
}

(async () => {
  await new Promise(r => setTimeout(r, 1500));
  const w = dom.window, d = w.document;
  const clic = sel => d.querySelector(sel).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  // Tolleranze: i valori stampati hanno un decimale (±0,05), la colonna Tecnica e le
  // percentuali MOTM nessuno (±0,5). Il caso peggiore e' l'arrotondamento stesso: un centesimo
  // in piu' serve solo ai float.
  const T1 = 0.051, T0 = 0.51;

  console.log("\nClassifica generale: ogni numero ricalcolato da zero (9 combinazioni)");
  const errClass = { indice: [], storico: [], forma: [], tecnica: [], riquadro: [], ordine: [] };
  let righeViste = 0;
  for (const fin of [30, 40, 0]) for (const peso of [0, 0.5, 1]) {
    clic(`#formWindowFilters [data-win="${fin}"]`); clic(`#formWeightFilters [data-w="${peso}"]`);
    const R = miscela(fin, peso), tag = `[${fin === 0 ? "tutte" : "ultime " + fin}, forma ${peso * 100}%]`;
    const nomi = [];
    d.querySelectorAll("#powerTable tbody > tr:not(.match-detail)").forEach(tr => {
      const c = {}; tr.querySelectorAll("td[data-label]").forEach(td => { c[td.dataset.label] = T(td); });
      const n = T(tr.querySelector(".player-link")), x = R.get(n); righeViste++; nomi.push(n);
      if (!x) { errClass.indice.push(`${tag} ${n}: non in rosa`); return; }
      if (/^\d/.test(c.Indice) && Math.abs(num(c.Indice) - x.blended) > T1) errClass.indice.push(`${tag} ${n}: stampato ${c.Indice}, atteso ${x.blended.toFixed(2)}`);
      if (Math.abs(num(c.Storico) - x.storico) > T1) errClass.storico.push(`${tag} ${n}: stampato ${c.Storico}, atteso ${x.storico.toFixed(2)}`);
      if (c.Forma !== "-") {
        if (!x.haForma || Math.abs(num(c.Forma) - x.forma) > T1 || num(c.Forma.split("(")[1]) !== x.presenze)
          errClass.forma.push(`${tag} ${n}: stampato ${c.Forma}, atteso ${x.forma === null ? "nessuna forma" : x.forma.toFixed(2) + " (" + x.presenze + " pt)"}`);
      } else if (x.haForma && peso > 0) errClass.forma.push(`${tag} ${n}: forma non stampata, attesa ${x.forma.toFixed(2)}`);
      if (Math.abs(num(c.Tecnica) - x.grezzi.tech) > T0) errClass.tecnica.push(`${tag} ${n}: stampato ${c.Tecnica}, atteso ${x.grezzi.tech.toFixed(2)}`);
      const det = d.getElementById("tec-g-" + n);
      (det ? [...det.querySelectorAll(".tecq-riga:not(.tecq-totale)")] : []).forEach(r => {
        const k = PEZZO_DA_ETICHETTA[T(r.querySelector(".tecq-eti"))], att = 100 * pesiDi(x.g)[k] * x.q[k];
        if (Math.abs(num(T(r.querySelector(".tecq-punti"))) - att) > T1) errClass.riquadro.push(`${tag} ${n} ${k}: stampato ${T(r.querySelector(".tecq-punti"))}, atteso ${att.toFixed(2)}`);
      });
    });
    const attesi = [...R.entries()].filter(([, x]) => x.haForma || peso === 0).sort((a, b) => b[1].blended - a[1].blended).map(([n]) => n);
    if (nomi.slice(0, attesi.length).join() !== attesi.join()) errClass.ordine.push(`${tag}: stampato ${nomi.slice(0, 5).join(", ")}..., atteso ${attesi.slice(0, 5).join(", ")}...`);
  }
  verifica(`righe lette: ${righeViste}`, righeViste >= 9 * 2 ? [] : ["troppo poche"]);
  verifica("Indice (miscela di storico e forma)", errClass.indice);
  verifica("Storico (carriere EA)", errClass.storico);
  verifica("Forma (con il MOTM in percentuale, come nello storico)", errClass.forma);
  verifica("colonna Tecnica", errClass.tecnica);
  verifica("riquadro della Tecnica, pezzo per pezzo", errClass.riquadro);
  verifica("ordine della classifica", errClass.ordine);

  console.log("\nTesta a testa: tutte le coppie, su tre viste");
  const sA = d.getElementById("h2hA"), sB = d.getElementById("h2hB");
  const nomi = [...sA.options].map(o => o.value);
  const errH = { punteggi: [], voci: [], valori: [], pezzi: [], valoriPezzi: [], segni: [] };
  let coppie = 0;
  for (const [fin, peso] of [[30, 0.5], [0, 1], [40, 0]]) {
    clic(`#formWindowFilters [data-win="${fin}"]`); clic(`#formWeightFilters [data-w="${peso}"]`);
    const R = miscela(fin, peso), tag = `[${fin === 0 ? "tutte" : "ultime " + fin}, forma ${peso * 100}%]`;
    for (const a of nomi) for (const b of nomi) {
      if (a === b) continue;
      sA.value = a; sB.value = b; sB.dispatchEvent(new w.Event("change")); coppie++;
      const A = R.get(a), B = R.get(b), k2 = `${tag} ${a} vs ${b}`;
      const m = T(d.getElementById("h2hVerdetto")).match(/\((-?[\d.]+) contro (-?[\d.]+)\)/);
      if (!m || Math.abs(+m[1] - A.blended) > T1 || Math.abs(+m[2] - B.blended) > T1)
        errH.punteggi.push(`${k2}: ${m && m[0]}, atteso ${A.blended.toFixed(2)} / ${B.blended.toFixed(2)}`);
      [...d.getElementById("h2hVoci").children].slice(1).forEach(div => {
        const k = VOCE_DA_ETICHETTA[T(div.children[0].children[0])];
        const segno = k === "disc" ? -1 : 1;
        const atteso = 100 * PESI[k] * (A.v[k] - B.v[k]) * segno, st = puntiDaTesto(T(div.children[0].children[1]), a);
        if (Math.abs(st - atteso) > T1 && !(st === 0 && Math.abs(atteso) < 0.05)) errH.voci.push(`${k2} ${k}: stampato ${st}, atteso ${atteso.toFixed(2)}`);
        const [va, vb] = T(div.children[2]).split("·")[0].split("contro").map(num);
        const ga = k === "motm" ? A.grezzi.motmPct : A.grezzi[k], gb = k === "motm" ? B.grezzi.motmPct : B.grezzi[k];
        const tol = k === "disc" ? 0.0006 : k === "tech" || k === "motm" ? T1 : 0.006;
        if (Math.abs(va - ga) > tol || Math.abs(vb - gb) > tol) errH.valori.push(`${k2} ${k}: stampato ${va} contro ${vb}, atteso ${ga.toFixed(3)} / ${gb.toFixed(3)}`);
        if (k !== "tech") return;
        // I pezzi della tecnica: i punti ripartiti in proporzione ai punti di ciascun pezzo,
        // e il valore scritto e' quello CONTATO, cioe' quello che genera quei punti.
        const quota = {}; PEZZI.forEach(z => { quota[z] = 100 * (pesiDi(A.g)[z] * A.q[z] - pesiDi(B.g)[z] * B.q[z]); });
        const totQ = PEZZI.reduce((t, z) => t + quota[z], 0);
        [...div.querySelectorAll("details > div > div")].filter(x => x.children.length >= 3 && x.querySelector("strong")).forEach(x => {
          const riga = T(x.children[0]), z = PEZZO_DA_ETICHETTA[riga.split(" — ")[0]];
          const pts = riga.match(/(pari|[+−]\d+\.\d punti a .*)$/)[1], st2 = puntiDaTesto(pts, a);
          const att = Math.abs(totQ) > 1e-9 ? atteso * quota[z] / totQ : 0;
          if (Math.abs(st2 - att) > T1) errH.pezzi.push(`${k2} ${z}: stampato ${pts}, atteso ${att.toFixed(2)}`);
          const [ca, cb] = T(x.children[2]).split("contro").map(num);
          const [lo, hi] = SCALE_TEC[z], conta = q => lo + q * (hi - lo), tolV = z === "difesa" ? 0.006 : T1;
          if (Math.abs(ca - conta(A.q[z])) > tolV || Math.abs(cb - conta(B.q[z])) > tolV)
            errH.valoriPezzi.push(`${k2} ${z}: scritto ${ca} contro ${cb}, contano ${conta(A.q[z]).toFixed(2)} / ${conta(B.q[z]).toFixed(2)}`);
          // A pesi uguali, i punti vanno a chi ha il valore migliore: e' la contraddizione che
          // un lettore vede subito, e che il 28/10/2026 c'era in 4 righe su 2200.
          const stessoPeso = pesiDi(A.g)[z] === pesiDi(B.g)[z];
          const megliA = z === "difesa" ? ca < cb : ca > cb;
          if (stessoPeso && ca !== cb && st2 !== 0 && megliA !== (st2 > 0)) errH.segni.push(`${k2} ${z}: ${T(x.children[2])}, ${pts}`);
        });
      });
    }
  }
  verifica(`coppie confrontate: ${coppie}`, coppie > 0 ? [] : ["nessuna"]);
  verifica("i due punteggi del verdetto", errH.punteggi);
  verifica("i punti di ogni voce (anche il MOTM)", errH.voci);
  verifica("i valori scritti sotto ogni voce", errH.valori);
  verifica("i punti dei pezzi della tecnica", errH.pezzi);
  verifica("i valori dei pezzi sono quelli che generano i punti", errH.valoriPezzi);
  verifica("a pesi uguali, i punti vanno a chi ha il valore migliore", errH.segni);

  console.log("\nReparto per reparto: ogni tabella, per ogni soglia minima");
  const ETI = { "Difensori": "DIFENSORI", "Centrocampisti": "CENTROCAMPISTI", "Esterni": "ESTERNI", "Trequartista": "TREQUARTISTA", "Attaccanti": "ATTACCANTI", "Portieri": "PORTIERI" };
  const TUTTI = reparti(), errR = { celle: [], indice: [], riquadro: [], ordine: [] };
  let righeR = 0;
  for (const minimo of [1, 3, 5, 10]) {
    clic(`#roleMinFilters [data-min="${minimo}"]`);
    d.querySelectorAll("#roleBoards .panel").forEach(pan => {
      const titolo = T(pan.querySelector("h3")); if (!titolo) return;
      const g = ETI[titolo.split(" — ")[0].replace(/^\S+\s/, "").trim()]; if (!g) return;
      const pool = TUTTI.filter(x => x.g === g && x.games >= minimo); if (!pool.length) return;
      const partite = pool.map(x => x.games), sm = {};
      ["rating", "contrib", "motmPct", "tech", "disc"].forEach(k => { sm[k] = versoLaMedia(pool.map(x => x[k]), partite); });
      pool.forEach((x, i) => {
        x.score = Math.max(0, Math.min(100, 100 * (PESI.rating * scala(sm.rating[i], SCALE.rating) + PESI.contrib * scala(sm.contrib[i], SCALE.contrib)
          + PESI.motm * scala(sm.motmPct[i], SCALE.motm) + PESI.tech * scala(sm.tech[i], SCALE.tech) - PESI.disc * scala(sm.disc[i], SCALE.disc))));
      });
      const per = new Map(pool.map(x => [x.nome, x])), tag = `[min ${minimo}] ${g}`, classificati = [];
      pan.querySelectorAll("tbody > tr:not(.match-detail)").forEach(tr => {
        const c = {}; tr.querySelectorAll("td[data-label]").forEach(td => { c[td.dataset.label] = T(td); });
        const n = T(tr.querySelector(".player-link")), x = per.get(n); righeR++;
        if (!x) { errR.celle.push(`${tag} ${n}: non atteso in questo reparto`); return; }
        [["Partite nel ruolo", x.games, 0], ["Gol", x.gol, 0], ["Assist", x.assist, 0], ["Media", x.rating, 0.006],
         ["G+A/partita", x.contrib, 0.006], ["Tecnica", x.tech, T0], ["MOTM%", x.motmPct, T0]].forEach(([col, att, tol]) => {
          if (Math.abs(num(c[col]) - att) > tol) errR.celle.push(`${tag} ${n} ${col}: stampato ${c[col]}, atteso ${(+att).toFixed(3)}`);
        });
        if (/^\d/.test(c.Indice) && Math.abs(num(c.Indice) - x.score) > T1) errR.indice.push(`${tag} ${n}: stampato ${c.Indice}, atteso ${x.score.toFixed(2)}`);
        if (/^\d/.test(c.Indice)) classificati.push(n);
        const det = [...pan.querySelectorAll("tr.match-detail")].find(t => t.id === `tec-r-${g}-${n}`);
        (det ? [...det.querySelectorAll(".tecq-riga:not(.tecq-totale)")] : []).forEach(r => {
          const k = PEZZO_DA_ETICHETTA[T(r.querySelector(".tecq-eti"))], att = 100 * pesiDi(g)[k] * x.q[k];
          if (Math.abs(num(T(r.querySelector(".tecq-punti"))) - att) > T1) errR.riquadro.push(`${tag} ${n} ${k}: stampato ${T(r.querySelector(".tecq-punti"))}, atteso ${att.toFixed(2)}`);
        });
      });
      const attesi = pool.length > 1 ? pool.filter(x => x.games >= IN_CLASSIFICA_REPARTO).sort((p, q) => q.score - p.score).map(x => x.nome) : [];
      if (classificati.join() !== attesi.join()) errR.ordine.push(`${tag}: stampato ${classificati.join(", ")}, atteso ${attesi.join(", ")}`);
    });
  }
  verifica(`righe lette: ${righeR}`, righeR > 0 ? [] : ["nessuna"]);
  verifica("partite, gol, assist, media, G+A, tecnica, MOTM", errR.celle);
  verifica("Indice del reparto (con la correzione verso la media)", errR.indice);
  verifica("riquadro della Tecnica, pezzo per pezzo", errR.riquadro);
  verifica("ordine di ogni reparto", errR.ordine);

  // ---- Passaggi tentati a partita (28/10/2026): un dato da guardare, fuori dall'indice.
  // In rosa: tentati di carriera (stimati da riusciti e percentuale, mai meno di quelli
  // contati in archivio) diviso le partite di carriera. Fuori rosa: solo l'archivio, contato.
  console.log("\nGiocatori: passaggi tentati a partita");
  const attesoPassaggi = new Map(roster.map(r => {
    const arch = righePerNome.get(r.player_name) || [];
    const tent = Math.max(stima(r.passes_made, r.pass_success_rate), somma(arch, p => p.pass_attempts || 0));
    return [r.player_name, r.games_played ? tent / r.games_played : 0];
  }));
  const fuoriRosa = name => {
    const righe = []; MATCHES.forEach(m => { const p = righeDi(m).find(x => x.player_name === name); if (p) righe.push(p); });
    return righe.length ? somma(righe, p => p.pass_attempts || 0) / righe.length : null;
  };
  const errP = { colonna: [], ordine: [], scheda: [] };
  const bottone = d.querySelector('#rosterColonne [data-col="pass_attempts_pg"]');
  if (!bottone) errP.colonna.push("manca il bottone per aggiungere la colonna");
  else {
    bottone.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const valori = [];
    d.querySelectorAll("#rosterTable tbody tr").forEach(tr => {
      const td = tr.querySelector('td[data-label="Passaggi tentati a partita"]'), n = T(tr.querySelector(".player-link"));
      if (!td) { errP.colonna.push(`${n}: colonna assente`); return; }
      const att = attesoPassaggi.get(n); valori.push(num(T(td)));
      if (att === undefined || Math.abs(num(T(td)) - att) > T1) errP.colonna.push(`${n}: stampato ${T(td)}, atteso ${att === undefined ? "non in rosa" : att.toFixed(2)}`);
    });
    if (valori.length !== attesoPassaggi.size) errP.colonna.push(`righe ${valori.length}, giocatori in rosa ${attesoPassaggi.size}`);
    if (valori.some((v, i) => i > 0 && v > valori[i - 1])) errP.ordine.push(`non in ordine decrescente: ${valori.join(", ")}`);
  }
  // La scheda di ogni nome cliccabile della pagina, in rosa e fuori.
  const nomiCliccabili = [...new Set([...d.querySelectorAll(".player-link[data-player]")].map(x => x.dataset.player))];
  let schede = 0;
  for (const n of nomiCliccabili) {
    const link = d.querySelector(`.player-link[data-player="${n.replace(/"/g, '\\"')}"]`);
    link.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const box = [...d.querySelectorAll(".pm-stat")].find(b => T(b.querySelector(".k")) === "Passaggi tentati a partita");
    const att = attesoPassaggi.has(n) ? attesoPassaggi.get(n) : fuoriRosa(n);
    if (att === null) continue;   // nessuna partita: la scheda non si apre, ed e' giusto
    schede++;
    if (!box) { errP.scheda.push(`${n}: casella assente`); continue; }
    if (Math.abs(num(T(box.querySelector(".v"))) - att) > T1) errP.scheda.push(`${n}: scritto ${T(box.querySelector(".v"))}, atteso ${att.toFixed(2)}`);
  }
  verifica("colonna nella tabella Giocatori, per ogni giocatore", errP.colonna);
  verifica("aggiunta la colonna, la tabella si ordina su di essa", errP.ordine);
  verifica(`casella nella scheda di ogni giocatore (${schede} schede aperte)`, schede > 0 ? errP.scheda : ["nessuna scheda aperta"]);

  console.log(falliti === 0 ? "\nOgni numero torna con il ricalcolo indipendente." : `\n${falliti} controlli falliti.`);
  process.exit(falliti === 0 ? 0 : 1);
})();
