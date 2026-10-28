// I record, la scalata e il resoconto della serata, ricalcolati da zero e confrontati con cio'
// che la pagina STAMPA.
//
// NATO IL 28/10/2026 insieme alla sezione Record. Come test_indice.js non usa nessuna funzione
// della pagina: legge i dati, rifa' i conti con codice suo, apre la pagina e confronta.
//
// Le regole che verifica (README, "Record e scalata"):
//   - il record e' il valore piu' alto; a parita' e' di chi ci e' arrivato prima;
//   - battuto = il valore di adesso supera quello di prima dell'ultima serata, ed e' stato
//     fatto in quella serata; eguagliato = stesso valore, raggiunto in quella serata;
//   - una promozione si attribuisce alle ultime N partite giocate prima della lettura che la
//     mostra, con N = partite in piu' contate da EA in quella lettura.
//
// Uso:  node test_record.js [percorso/index.html]

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

// ---- I dati ----
const html = fs.readFileSync(file, "utf-8");
const ini = html.indexOf("const DATA = ") + "const DATA = ".length;
const fineDati = ini + html.slice(ini).search(/;\r?\n/);
let DATA = JSON.parse(html.slice(ini, fineDati));
let htmlPagina = html;

// Simulazione: la pagina com'era la sera in cui e' caduto un record. Se ieri sera non e' caduto
// niente, il controllo su "battuto nell'ultima serata" verificherebbe solo un'assenza; cosi'
// invece prova anche il caso che conta. Il processo principale si rilancia con --fino-a e la
// chiave di quella serata: qui si tagliano partite, serate e istantanee del club come se fosse
// la mattina dopo, e si rimettono nella pagina come fa il generatore.
const iFino = process.argv.indexOf("--fino-a");
const FINO_A = iFino > -1 ? process.argv[iFino + 1] : null;
if (FINO_A) {
  const tutte = DATA.serate;
  const k = tutte.findIndex(s => s.chiave === FINO_A);
  if (k < 0) { console.error(`Serata ${FINO_A} non trovata.`); process.exit(1); }
  const tenute = tutte.slice(k);
  const ids = new Set(tenute.flatMap(s => s.matchIds));
  const dopo = k > 0 ? tutte[k - 1].matchIds.map(id => DATA.matches.find(m => m.match_id === id).played_at).sort()[0] : null;
  DATA = { ...DATA, serate: tenute,
    matches: DATA.matches.filter(m => ids.has(m.match_id)),
    matchPlayers: Object.fromEntries(Object.entries(DATA.matchPlayers).filter(([id]) => ids.has(id))),
    history: (DATA.history || []).filter(h => !dopo || h.fetched_at < dopo) };
  htmlPagina = html.slice(0, ini) + JSON.stringify(DATA).replace(/</g, "\\u003c") + html.slice(fineDati);
}
// I nomi nella pagina passano per la neutralizzazione (test_sicurezza.js); qui si confronta il
// testo, che e' lo stesso.
const partite = [...(DATA.matches || [])].sort((a, b) => a.played_at < b.played_at ? -1 : a.played_at > b.played_at ? 1 : 0);
const serataDi = {};
(DATA.serate || []).forEach(s => s.matchIds.forEach(id => { serataDi[id] = s; }));
const giorno = m => serataDi[m.match_id].giorno;
const righe = m => (DATA.matchPlayers || {})[m.match_id] || [];

// Ogni "prestazione da record" e' {v, chi, t, giorno}: valore, giocatore (o null), istante.
function serie(lista, ok, chi) {
  const out = []; let n = 0, primo = null, ultimo = null;
  const chiudi = () => { if (n) out.push({ v: n, chi: chi === undefined ? null : chi, t: ultimo.played_at, giorno: giorno(primo) === giorno(ultimo) ? giorno(ultimo) : `dal ${giorno(primo)} al ${giorno(ultimo)}` }); n = 0; };
  for (const m of lista) { if (ok(m)) { if (!n) primo = m; n++; ultimo = m; } else chiudi(); }
  chiudi();
  return out;
}
function perSerata(lista) {
  const g = new Map();
  for (const m of lista) { const k = serataDi[m.match_id].chiave; if (!g.has(k)) g.set(k, []); g.get(k).push(m); }
  return [...g.values()];
}
const PERSONALI = {
  golGiocatore: p => p.goals || 0, assistGiocatore: p => p.assists || 0,
  gaGiocatore: p => (p.goals || 0) + (p.assists || 0), votoGiocatore: p => p.rating || 0,
  passaggiGiocatore: p => p.passes_made || 0, contrastiGiocatore: p => p.tackles_made || 0,
};
function prestazioni(lista, limite) {
  const r = {
    serieVittorie: serie(lista, m => m.win),
    imbattibilita: serie(lista, m => !m.loss),
    porteInviolate: serie(lista, m => !m.goals_against),
    vittoriaLarga: lista.filter(m => m.win).map(m => ({ v: m.goals_for - m.goals_against, chi: null, t: m.played_at, giorno: giorno(m) })),
    golPartita: lista.map(m => ({ v: m.goals_for, chi: null, t: m.played_at, giorno: giorno(m) })),
    vittorieSerata: perSerata(lista).map(g => ({ v: g.filter(m => m.win).length, chi: null, t: g[g.length - 1].played_at, giorno: giorno(g[0]) })),
    golSerata: perSerata(lista).map(g => ({ v: g.reduce((t, m) => t + m.goals_for, 0), chi: null, t: g[g.length - 1].played_at, giorno: giorno(g[0]) })),
    skillRating: (DATA.history || []).filter(h => h.skill_rating && (!limite || h.fetched_at < limite)).map(h => ({ v: h.skill_rating, chi: null, t: h.fetched_at, giorno: null })),
    golSerataGiocatore: [], serieGolGiocatore: [],
  };
  for (const k in PERSONALI) r[k] = [];
  for (const m of lista) for (const p of righe(m))
    for (const k in PERSONALI) r[k].push({ v: PERSONALI[k](p), chi: p.player_name, t: m.played_at, giorno: giorno(m) });
  for (const g of perSerata(lista)) {
    const tot = {};
    for (const m of g) for (const p of righe(m)) { tot[p.player_name] = tot[p.player_name] || { v: 0, t: null }; tot[p.player_name].v += p.goals || 0; tot[p.player_name].t = m.played_at; }
    for (const [chi, x] of Object.entries(tot)) r.golSerataGiocatore.push({ v: x.v, chi, t: x.t, giorno: giorno(g[0]) });
  }
  const giocate = {};
  for (const m of lista) for (const p of righe(m)) (giocate[p.player_name] = giocate[p.player_name] || []).push({ ...m, gol: p.goals || 0 });
  for (const [chi, l] of Object.entries(giocate)) serie(l, m => m.gol > 0, chi).forEach(x => r.serieGolGiocatore.push(x));
  // Il record: il valore piu' alto, il primo ad arrivarci.
  const rec = {};
  for (const [k, l] of Object.entries(r)) {
    const c = l.filter(x => x.v > 0).sort((a, b) => a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
    if (!c.length) { rec[k] = null; continue; }
    const max = Math.max(...c.map(x => x.v));
    const tutti = c.filter(x => x.v === max);
    rec[k] = { v: max, primo: tutti[0], pari: tutti.slice(1) };
  }
  return rec;
}

const ultima = (DATA.serate || [])[0];
const inizioUltima = ultima ? ultima.matchIds.map(id => partite.find(m => m.match_id === id).played_at).sort()[0] : null;
const ORA = prestazioni(partite, null);
const PRIMA = ultima ? prestazioni(partite.filter(m => !ultima.matchIds.includes(m.match_id)), inizioUltima) : {};
const ATTESE_NOVITA = {};
for (const k in ORA) {
  const o = ORA[k], p = PRIMA[k];
  if (!o || !ultima) continue;
  if (o.v > (p ? p.v : 0) && o.primo.t >= inizioUltima) ATTESE_NOVITA[k] = "battuto";
  else if (p && o.v === p.v && o.pari.some(x => x.t >= inizioUltima)) ATTESE_NOVITA[k] = "eguagliato";
}

// Promozioni e retrocessioni.
const EVENTI = [];
const H = DATA.history || [];
for (let i = 1; i < H.length; i++) {
  const a = H[i - 1], b = H[i];
  const dp = b.promotions - a.promotions, dr = b.relegations - a.relegations;
  if (dp <= 0 && dr <= 0) continue;
  const n = Math.max(1, b.games_played - a.games_played);
  const quali = partite.filter(m => m.played_at <= b.fetched_at).slice(-n);
  const serate = [...new Set(quali.map(m => serataDi[m.match_id].chiave))];
  for (let k = 0; k < dp; k++) EVENTI.push({ tipo: "promozione", quali, serata: serate.length === 1 ? serate[0] : null });
  for (let k = 0; k < dr; k++) EVENTI.push({ tipo: "retrocessione", quali, serata: serate.length === 1 ? serate[0] : null });
}

// ---- La pagina ----
const nulla = () => {};
const dom = new JSDOM(htmlPagina.replace(/<script id="lib-chartjs">[\s\S]*?<\/script>/, ""), {
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
const num = s => { const m = String(s).match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };

(async () => {
  await new Promise(r => setTimeout(r, 1500));
  const d = dom.window.document;

  console.log("\nRecord: ogni riga ricalcolata da zero");
  const err = { righe: [], valori: [], chi: [], quando: [], pari: [], segni: [] };
  const righePagina = [...d.querySelectorAll("#record tr[data-record]")];
  const chiaviPagina = righePagina.map(tr => tr.dataset.record);
  for (const k of Object.keys(ORA)) if (!chiaviPagina.includes(k)) err.righe.push(`manca la riga ${k}`);
  for (const tr of righePagina) {
    const k = tr.dataset.record, r = ORA[k];
    const c = {}; tr.querySelectorAll("td[data-label]").forEach(td => { c[td.dataset.label] = td; });
    if (r === undefined) { err.righe.push(`riga inattesa ${k}`); continue; }
    if (r === null) { if (!/ancora nessuno/.test(T(tr))) err.valori.push(`${k}: atteso "ancora nessuno"`); continue; }
    if (num(T(c.Valore.querySelector("strong"))) !== r.v) err.valori.push(`${k}: stampato ${T(c.Valore.querySelector("strong"))}, atteso ${r.v}`);
    if (r.primo.chi !== null && T(c.Chi && c.Chi.querySelector(".player-link")) !== r.primo.chi)
      err.chi.push(`${k}: stampato ${T(c.Chi && c.Chi.querySelector(".player-link"))}, atteso ${r.primo.chi}`);
    if (r.primo.giorno && !T(c.Quando).startsWith(r.primo.giorno)) err.quando.push(`${k}: stampato "${T(c.Quando)}", atteso che cominci con "${r.primo.giorno}"`);
    // Chi lo eguaglia: per i giocatori i nomi (mai il detentore), per la squadra le date.
    const testoPari = T(r.primo.chi !== null ? c.Chi : c.Quando);
    if (r.primo.chi !== null) {
      const altri = [...new Set(r.pari.map(x => x.chi).filter(n => n !== r.primo.chi))];
      const m = testoPari.match(/eguagliato da ([^·]+)/);
      const stampati = m ? m[1].split(",").map(s => s.trim()).filter(Boolean) : [];
      if (stampati.sort().join() !== altri.sort().join()) err.pari.push(`${k}: eguagliato da [${stampati}], attesi [${altri}]`);
      if (stampati.includes(r.primo.chi)) err.pari.push(`${k}: il detentore compare fra chi lo eguaglia`);
    } else if (r.pari.length && !/eguagliato/.test(testoPari)) err.pari.push(`${k}: eguagliato ${r.pari.length} volte, non scritto`);
    const segno = /battuto nell'ultima serata/.test(T(tr)) ? "battuto" : /eguagliato nell'ultima serata/.test(T(tr)) ? "eguagliato" : undefined;
    if (segno !== ATTESE_NOVITA[k]) err.segni.push(`${k}: segno "${segno || "nessuno"}", atteso "${ATTESE_NOVITA[k] || "nessuno"}"`);
  }
  verifica(`tutte le righe ci sono (${righePagina.length})`, err.righe);
  verifica("i valori", err.valori);
  verifica("chi detiene i record personali (il primo ad arrivarci)", err.chi);
  verifica("quando", err.quando);
  verifica("chi lo eguaglia", err.pari);
  verifica("battuti ed eguagliati nell'ultima serata", err.segni);

  console.log("\nLa scalata: promozioni e retrocessioni");
  const errS = [];
  const ev = [...d.querySelectorAll("#recordScalata [data-evento]")];
  if (ev.length !== EVENTI.length) errS.push(`eventi stampati ${ev.length}, attesi ${EVENTI.length}`);
  ev.forEach((e, i) => {
    const x = EVENTI[i]; if (!x) return;
    if (e.dataset.evento !== x.tipo) errS.push(`evento ${i + 1}: ${e.dataset.evento}, atteso ${x.tipo}`);
    const unico = x.quali.length === 1 ? x.quali[0] : null;
    if (unico && !T(e).includes(`${unico.goals_for}-${unico.goals_against} contro ${unico.opponent_name}`))
      errS.push(`evento ${i + 1}: "${T(e)}", attesa la partita ${unico.goals_for}-${unico.goals_against} contro ${unico.opponent_name}`);
    if (!unico && / contro /.test(T(e))) errS.push(`evento ${i + 1}: indica una partita, ma le candidate sono ${x.quali.length}`);
  });
  const saldo = EVENTI.reduce((t, e) => t + (e.tipo === "promozione" ? 1 : -1), 0);
  const saldoTxt = T(d.getElementById("recordSaldo"));
  if (EVENTI.length && !(saldo > 0 ? saldoTxt.includes(`${saldo} divisione`) || saldoTxt.includes(`${saldo} divisioni`) : true)) errS.push(`saldo: "${saldoTxt}", atteso ${saldo}`);
  verifica(`eventi, partita che li ha portati, saldo (${EVENTI.length} eventi, saldo ${saldo})`, errS);
  // Le frecce nel calendario del mese mostrato: un giorno per ogni serata con un evento.
  const meseMostrato = ultima ? ultima.matchIds.map(id => partite.find(m => m.match_id === id))[0] : null;
  const giorniAttesi = new Set(EVENTI.filter(e => e.serata).map(e => (DATA.serate.find(s => s.chiave === e.serata) || {}).giornoInizio || (DATA.serate.find(s => s.chiave === e.serata) || {}).giorno)
    .filter(g => meseMostrato && g && g.slice(3, 5) === giorno(meseMostrato).slice(3, 5)));
  const frecce = d.querySelectorAll("#serate .calEvento").length;
  verifica(`frecce nel calendario del mese mostrato (${frecce})`, frecce === giorniAttesi.size ? [] : [`frecce ${frecce}, giorni con evento ${giorniAttesi.size}`]);

  console.log("\nIl resoconto dell'ultima serata, in home");
  const errR = [];
  const corpo = d.getElementById("resocontoBody");
  if (!ultima) { if (T(corpo)) errR.push("nessuna serata, ma c'e' un resoconto"); }
  else {
    const P = ultima.matchIds.map(id => partite.find(m => m.match_id === id));
    const v = P.filter(m => m.win).length, l = P.filter(m => m.loss).length;
    const esito = T(corpo.querySelector('[data-riga="esito"]'));
    if (!esito.startsWith(`⚽ ${P.length} partit`)) errR.push(`esito: "${esito}", attese ${P.length} partite`);
    if (v && !esito.includes(`${v} vint`)) errR.push(`esito: "${esito}", attese ${v} vinte`);
    if (l && !esito.includes(`${l} pers`)) errR.push(`esito: "${esito}", attese ${l} perse`);
    const gf = P.reduce((t, m) => t + m.goals_for, 0), gs = P.reduce((t, m) => t + m.goals_against, 0);
    if (!esito.includes(`${gf} gol fatti, ${gs} subiti`)) errR.push(`esito: "${esito}", attesi ${gf} gol fatti e ${gs} subiti`);
    // Il migliore: media voto piu' alta fra chi ha giocato almeno meta' delle partite.
    const per = {};
    P.forEach(m => righe(m).forEach(p => { const x = per[p.player_name] = per[p.player_name] || { n: 0, s: 0, ga: 0 }; x.n++; x.s += p.rating || 0; x.ga += (p.goals || 0) + (p.assists || 0); }));
    const cand = Object.entries(per).filter(([, x]) => x.n >= Math.ceil(P.length / 2)).sort((a, b) => b[1].s / b[1].n - a[1].s / a[1].n || b[1].ga - a[1].ga);
    const migl = T(corpo.querySelector('[data-riga="migliore"] .player-link'));
    if (cand.length && migl !== cand[0][0]) errR.push(`migliore: ${migl}, atteso ${cand[0][0]}`);
    const recStampati = [...corpo.querySelectorAll('[data-riga="record"]')].map(x => x.dataset.record).sort();
    const recAttesi = Object.keys(ATTESE_NOVITA).sort();
    if (recStampati.join() !== recAttesi.join()) errR.push(`record nel resoconto: [${recStampati}], attesi [${recAttesi}]`);
    const div = corpo.querySelectorAll('[data-riga="divisione"]').length;
    const divAttesi = EVENTI.filter(e => e.serata === ultima.chiave).length;
    if (div !== divAttesi) errR.push(`promozioni/retrocessioni nel resoconto: ${div}, attese ${divAttesi}`);
  }
  verifica("partite, esito, gol, il migliore, record e divisione", errR);

  if (FINO_A) {
    verifica("nella serata simulata e' caduto almeno un record (il caso da provare)",
      Object.values(ATTESE_NOVITA).includes("battuto") ? [] : ["nessun record battuto: la simulazione non prova niente"]);
  } else {
    // L'ultima serata in cui e' caduto un record: quella del primo arrivo al valore di un record
    // attuale. Se e' ieri sera, il caso e' gia' coperto qui sopra.
    const primi = Object.values(ORA).filter(Boolean).map(r => r.primo)
      .map(x => partite.find(m => m.played_at === x.t)).filter(Boolean)
      .sort((a, b) => a.played_at < b.played_at ? 1 : -1);
    const serata = primi.length ? serataDi[primi[0].match_id] : null;
    if (serata && ultima && serata.chiave !== ultima.chiave) {
      console.log(`\nSimulazione: la pagina com'era dopo la serata del ${serata.giorno}, quando e' caduto un record`);
      const figlio = require("child_process").spawnSync(process.execPath, [__filename, file, "--fino-a", serata.chiave], { encoding: "utf-8" });
      const utili = (figlio.stdout || "").split("\n").filter(l => /^ +(ok|FAIL) /.test(l) || /^ {10}/.test(l));
      console.log(utili.map(l => "  " + l).join("\n"));
      verifica("la serata simulata torna in tutto", figlio.status === 0 ? [] : [`uscita ${figlio.status}`]);
    }
  }
  console.log(falliti === 0 ? "\nRecord, scalata e resoconto tornano con il ricalcolo." : `\n${falliti} controlli falliti.`);
  process.exit(falliti === 0 ? 0 : 1);
})();
