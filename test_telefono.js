// La vista da telefono di Giocatori e Carriera: ogni numero dell'elenco contro i dati grezzi
// della pagina, per ogni statistica che si puo' scegliere dal pannello.
//
// NATO IL 18/11/2026 insieme alla vista. Sul telefono ogni riga ha due celle sue (.tel-riga,
// .tel-dettaglio), scritte da un pezzo di codice diverso da quello delle colonne: il rischio e'
// proprio che le due strade si separino, e che il numero grande dica una cosa e la tabella
// un'altra. Per questo il riferimento non e' la tabella, ma DATA.roster e DATA.carriera
// ricalcolati qui; solo i passaggi tentati a partita (che la pagina stima dall'archivio) si
// confrontano con la loro colonna.
//
// jsdom non applica il CSS: qui si controlla cosa c'e' scritto e come risponde ai tocchi, non
// cosa si vede. Quello va guardato in un Chromium vero a 375px.
//
// Uso:  node test_telefono.js [percorso/index.html]

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

let html = fs.readFileSync(file, "utf-8");
const ini = html.indexOf("const DATA = ") + "const DATA = ".length;
const fineDati = ini + html.slice(ini).search(/;\r?\n/);
const DATA = JSON.parse(html.slice(ini, fineDati));

// Una serata con partite di due tipi, se i dati non ne hanno: senza, un saldo di serata
// contato su tutte le partite invece che su quelle del filtro darebbe lo stesso numero e
// nessun controllo potrebbe accorgersene (nei dati di FC 27 al 18/11/2026 non ce n'e' una).
// Si cambia il tipo di una partita sia nei dati della pagina sia nel riferimento qui sotto.
{
  const perIdM = new Map((DATA.matches || []).map(m => [String(m.match_id), m]));
  const mista = (DATA.serate || []).some(s => new Set(s.matchIds.map(id => (perIdM.get(String(id)) || {}).match_type)).size > 1);
  const s = !mista && (DATA.serate || []).find(x => x.matchIds.length >= 2 && x.matchIds.every(id => perIdM.has(String(id))));
  if (s) {
    const m = perIdM.get(String(s.matchIds[0]));
    m.match_type = m.match_type === "playoffMatch" ? "leagueMatch" : "playoffMatch";
    // "<" scritto come <: un nome con "</script>" non deve chiudere il blocco dei dati.
    html = html.slice(0, ini) + JSON.stringify(DATA).replace(/</g, "\\u003c") + html.slice(fineDati);
  }
}

// Il riferimento, scritto qui e non preso dalla pagina.
const ATTESO = {
  games_played: r => r.games_played, goals: r => r.goals, assists: r => r.assists,
  rating_ave: r => r.rating_ave, win_rate: r => r.win_rate, man_of_the_match: r => r.man_of_the_match,
  goals_plus_assists: r => r.goals + r.assists,
  contribution_pg: r => r.games_played ? (r.goals + r.assists) / r.games_played : 0,
  red_cards: r => r.red_cards, pass_success_rate: r => r.pass_success_rate, passes_made: r => r.passes_made,
  tackle_success_rate: r => r.tackle_success_rate, tackles_made: r => r.tackles_made,
  shot_success_rate: r => r.shot_success_rate, clean_sheets_def: r => r.clean_sheets_def,
};
// Tolleranza: la pagina arrotonda a due decimali (±0,005); 0,006 regge il caso peggiore.
const TOLL = 0.006;
const num = s => parseFloat(String(s).replace("%", ""));

// Il totale di carriera come in test_carriera.js: conteggi sommati, media e % pesate sulle partite.
function totale(per) {
  const righe = (DATA.carriera.titoli || []).filter(t => per[t]).map(t => per[t]);
  if (!righe.length) return null;
  const s = k => righe.reduce((t, r) => t + (r[k] || 0), 0);
  const pg = s("games_played");
  const pesata = k => righe.reduce((t, r) => t + r[k] * r.games_played, 0) / pg;
  return { games_played: pg, goals: s("goals"), assists: s("assists"), man_of_the_match: s("man_of_the_match"),
    rating_ave: pesata("rating_ave"), win_rate: pesata("win_rate") };
}

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
    // Un telefono: la pagina chiede la larghezza con matchMedia, che jsdom non ha.
    w.matchMedia = q => ({ matches: /max-width:\s*700px/.test(q), media: q, addEventListener: nulla, removeEventListener: nulla, addListener: nulla, removeListener: nulla });
  },
});
const T = el => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

(async () => {
  await new Promise(r => setTimeout(r, 1500));
  const w = dom.window, d = w.document;
  const clic = el => { if (el) el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); return !!el; };
  const righe = tabella => [...d.querySelectorAll(`#${tabella} tbody tr`)].filter(tr => tr.querySelector(".tel-riga"));
  const sceltePannello = () => [...d.querySelectorAll("#statSheet [data-stat]")].map(b => b.dataset.stat);

  // ---- Giocatori ----
  // La rosa e' chi ha almeno la soglia di partite del titolo (MIN_GAMES_PER_TITOLO, scritta
  // nella pagina dal generatore): DATA.roster contiene anche chi resta sotto.
  const soglia = Number((html.match(/const LEADERBOARD_MIN_GAMES = (\d+)/) || [])[1]);
  if (!Number.isFinite(soglia)) { console.error("soglia di partite non trovata nella pagina"); process.exit(1); }
  const rosa = new Map((DATA.roster || []).filter(r => r.games_played >= soglia).map(r => [r.player_name, r]));
  const errRighe = [];
  if (righe("rosterTable").length !== rosa.size) errRighe.push(`righe ${righe("rosterTable").length}, giocatori in rosa ${rosa.size}`);
  verifica("una riga da telefono per ogni giocatore in rosa", errRighe);

  if (!clic(d.getElementById("rosterScegli"))) { verifica("il pulsante della statistica esiste", ["manca #rosterScegli"]); }
  const chiavi = sceltePannello();
  verifica(`il pannello offre ${chiavi.length} statistiche`, chiavi.length >= 16 ? [] : [`solo ${chiavi.length}: [${chiavi}]`]);
  clic(d.getElementById("statSheet"));   // tocco fuori dal pannello: si chiude
  verifica("il tocco fuori dal pannello lo chiude", d.getElementById("statSheet").hidden ? [] : ["resta aperto"]);

  // Per ogni statistica: il numero grande di ogni giocatore, l'ordine, il pulsante.
  // I passaggi tentati a partita si leggono dalla loro colonna, attivata apposta.
  const passaggiColonna = new Map();
  clic(d.querySelector('#rosterColonne [data-col="pass_attempts_pg"]'));
  d.querySelectorAll("#rosterTable tbody tr").forEach(tr => {
    const td = tr.querySelector('td[data-label="Passaggi tentati a partita"]');
    if (td) passaggiColonna.set(T(tr.querySelector("td[data-label='Giocatore'] .player-link")), num(T(td)));
  });
  clic(d.querySelector('#rosterColonne [data-col="pass_attempts_pg"]'));
  const errValore = [], errOrdine = [], errBottone = [];
  for (const k of chiavi) {
    clic(d.getElementById("rosterScegli"));
    clic(d.querySelector(`#statSheet [data-stat="${k}"]`));
    if (!d.getElementById("statSheet").hidden) errBottone.push(`${k}: il pannello resta aperto dopo la scelta`);
    const valori = [];
    for (const tr of righe("rosterTable")) {
      const nome = T(tr.querySelector(".tel-riga .pname")), v = tr.querySelector(".tel-valore");
      if (!v || v.dataset.stat !== k) { errValore.push(`${k} ${nome}: il numero grande mostra ${v ? v.dataset.stat : "niente"}`); continue; }
      const stampato = num(T(v.querySelector("b"))); valori.push(stampato);
      const atteso = k === "pass_attempts_pg" ? passaggiColonna.get(nome) : (ATTESO[k] && rosa.has(nome) ? ATTESO[k](rosa.get(nome)) : undefined);
      if (atteso === undefined) { errValore.push(`${k} ${nome}: nessun riferimento`); continue; }
      if (Math.abs(stampato - atteso) > TOLL) errValore.push(`${k} ${nome}: stampato ${stampato}, atteso ${Number(atteso).toFixed(2)}`);
    }
    if (valori.some((x, i) => i > 0 && x > valori[i - 1])) errOrdine.push(`${k}: non decrescente [${valori.slice(0, 8).join(", ")}...]`);
    const testo = T(d.getElementById("rosterScegli"));
    const etichetta = T(d.querySelector(`#statSheet [data-stat="${k}"]`));
    if (testo !== `${etichetta} ↓`) errBottone.push(`${k}: il pulsante dice "${testo}", atteso "${etichetta} ↓"`);
  }
  verifica("il numero grande di ogni giocatore, per ogni statistica, contro i dati grezzi", errValore);
  verifica("scelta una statistica, l'elenco e' ordinato dal piu' alto", errOrdine);
  verifica("il pulsante dice la statistica scelta, e il pannello si chiude", errBottone);

  // Toccare di nuovo la stessa statistica inverte l'ordine.
  clic(d.getElementById("rosterScegli")); clic(d.querySelector('#statSheet [data-stat="goals"]'));
  clic(d.getElementById("rosterScegli")); clic(d.querySelector('#statSheet [data-stat="goals"]'));
  const crescente = righe("rosterTable").map(tr => num(T(tr.querySelector(".tel-valore b"))));
  verifica("la stessa statistica scelta due volte inverte l'ordine",
    crescente.every((x, i) => i === 0 || crescente[i - 1] <= x) && T(d.getElementById("rosterScegli")).endsWith("↑") ? [] : [`[${crescente.slice(0, 8)}] "${T(d.getElementById("rosterScegli"))}"`]);
  clic(d.getElementById("rosterScegli")); clic(d.querySelector('#statSheet [data-stat="goals"]'));

  // Le tessere che si vedono aprendo una riga: nove, tutte giuste, senza il numero gia' grande.
  const errTessere = [];
  const ETI = {}; chiavi.forEach(k => { ETI[T(d.querySelector(`#statSheet [data-stat="${k}"]`))] = k; });
  for (const tr of righe("rosterTable")) {
    const nome = T(tr.querySelector(".tel-riga .pname")), r = rosa.get(nome);
    const tess = [...tr.querySelectorAll(".tel-tessera")];
    if (tess.length !== 9) errTessere.push(`${nome}: ${tess.length} tessere, attese 9`);
    for (const t of tess) {
      const k = ETI[T(t.querySelector("span"))];
      if (!k) { errTessere.push(`${nome}: tessera sconosciuta "${T(t.querySelector("span"))}"`); continue; }
      if (k === "goals") errTessere.push(`${nome}: i gol sono gia' il numero grande, ma compaiono anche fra le tessere`);
      const att = ATTESO[k](r), st = num(T(t.querySelector("b")));
      if (Math.abs(st - att) > TOLL) errTessere.push(`${nome} ${k}: stampato ${st}, atteso ${Number(att).toFixed(2)}`);
    }
  }
  verifica("le tessere della riga aperta contro i dati grezzi", errTessere);

  // Il tocco: apre e chiude la riga; "Apri scheda completa" apre la scheda di QUEL giocatore.
  const errTocco = [];
  const prima = righe("rosterTable")[0], nomePrima = T(prima.querySelector(".pname"));
  clic(prima.querySelector(".tel-chi"));
  if (!prima.classList.contains("aperta")) errTocco.push("toccata, la riga non si apre");
  clic(prima.querySelector(".tel-valore"));
  if (prima.classList.contains("aperta")) errTocco.push("toccata di nuovo, la riga non si chiude");
  d.getElementById("playerModal").innerHTML = "";
  clic(prima.querySelector(".tel-scheda"));
  const titolo = T(d.querySelector("#playerModal .pm-name"));
  if (!titolo.startsWith(nomePrima)) errTocco.push(`"Apri scheda completa" di ${nomePrima} apre "${titolo || "niente"}"`);
  if (prima.classList.contains("aperta")) errTocco.push("il pulsante della scheda ha anche aperto la riga");
  verifica("tocco sulla riga e sul pulsante della scheda", errTocco);

  // ---- Carriera, Totale di tutti i titoli ----
  const errCarriera = [];
  const nomiCarriera = Object.keys(DATA.carriera.giocatori || {}).filter(n => totale(DATA.carriera.giocatori[n]));
  if (righe("carrieraTable").length !== nomiCarriera.length) errCarriera.push(`righe ${righe("carrieraTable").length}, giocatori con carriera ${nomiCarriera.length}`);
  for (const k of ["games_played", "goals", "assists", "rating_ave", "win_rate", "man_of_the_match", "goals_plus_assists", "contribution_pg"]) {
    clic(d.getElementById("carrieraScegli"));
    if (!clic(d.querySelector(`#statSheet [data-stat="${k}"]`))) { errCarriera.push(`${k}: manca nel pannello`); continue; }
    const valori = [];
    for (const tr of righe("carrieraTable")) {
      const nome = T(tr.querySelector(".tel-riga .pname")), tot = totale(DATA.carriera.giocatori[nome] || {});
      const st = num(T(tr.querySelector(".tel-valore b"))); valori.push(st);
      if (!tot) { errCarriera.push(`${k} ${nome}: nessun riferimento`); continue; }
      const att = ATTESO[k](tot);
      if (Math.abs(st - att) > TOLL) errCarriera.push(`${k} ${nome}: stampato ${st}, atteso ${att.toFixed(2)}`);
    }
    if (valori.some((x, i) => i > 0 && x > valori[i - 1])) errCarriera.push(`${k}: non decrescente`);
  }
  verifica("Carriera: il numero grande sul totale di tutti i titoli", errCarriera);

  // ---- Partite (18/11/2026) ----
  // Riferimento: DATA.matches e DATA.serate. Le serate sono "chi gioca la stessa sera", con le
  // loro matchIds: ogni intestazione deve avere sotto esattamente le partite della sua serata.
  const partite = DATA.matches || [];
  const perId = new Map(partite.map(m => [String(m.match_id), m]));
  const serataDi = new Map();
  (DATA.serate || []).forEach(s => (s.matchIds || []).forEach(id => serataDi.set(String(id), s.chiave)));
  const TIPO = { leagueMatch: "Campionato", playoffMatch: "Playoff", friendlyMatch: "Amichevole" };
  const lettera = m => (m.win ? "V" : (m.tie ? "N" : "S"));
  const blocchi = () => {   // [{ testa, ids: [...] }] nell'ordine della pagina
    const out = [];
    d.querySelectorAll("#matchesTable > tbody > tr").forEach(tr => {
      if (tr.classList.contains("tel-serata")) out.push({ testa: tr, ids: [] });
      else if (tr.classList.contains("match-row") && out.length) out[out.length - 1].ids.push(tr.dataset.match);
    });
    return out;
  };
  const controllaElenco = (attese, nome) => {
    const err = [];
    const righeP = [...d.querySelectorAll("#matchesTable tr.match-row")];
    if (righeP.length !== attese.length) err.push(`${nome}: ${righeP.length} righe, attese ${attese.length}`);
    righeP.forEach(tr => {
      const m = perId.get(tr.dataset.match);
      if (!m) { err.push(`partita ${tr.dataset.match} non nei dati`); return; }
      const es = T(tr.querySelector(".tel-esito")), avv = T(tr.querySelector(".tel-avv")), ris = T(tr.querySelector(".tel-ris"));
      const tipo = T(tr.querySelector(".tel-sotto")).split("· ")[1];
      if (es !== lettera(m)) err.push(`${m.match_id}: esito ${es}, atteso ${lettera(m)}`);
      const avvAtteso = String(m.opponent_name || "-").replace(/\s+/g, " ").trim();   // come T()
      if (!avv.startsWith(avvAtteso)) err.push(`${m.match_id}: avversario "${avv}", atteso "${avvAtteso}"`);
      if (ris !== `${m.goals_for} – ${m.goals_against}`) err.push(`${m.match_id}: risultato "${ris}", atteso ${m.goals_for} – ${m.goals_against}`);
      if (tipo !== (TIPO[m.match_type] || m.match_type)) err.push(`${m.match_id}: tipo "${tipo}", atteso ${TIPO[m.match_type]}`);
      if (T(tr.querySelector('td[data-label="Tipo"]')) !== (TIPO[m.match_type] || m.match_type)) err.push(`${m.match_id}: tipo nella tabella "${T(tr.querySelector('td[data-label="Tipo"]'))}"`);
    });
    // Le serate: le partite sotto un'intestazione sono una serata sola, ogni serata compare una
    // volta, e il saldo e' contato sui risultati grezzi delle partite mostrate.
    const viste = new Set();
    for (const b of blocchi()) {
      const chiavi = new Set(b.ids.map(id => serataDi.get(id) || id));
      if (chiavi.size !== 1) { err.push(`${nome}: un'intestazione copre ${chiavi.size} serate`); continue; }
      const k = [...chiavi][0];
      if (viste.has(k)) err.push(`${nome}: la serata ${k} compare due volte`);
      viste.add(k);
      const attesiIds = attese.filter(m => (serataDi.get(String(m.match_id)) || String(m.match_id)) === k).map(m => String(m.match_id));
      if (attesiIds.join() !== b.ids.join()) err.push(`${nome} ${k}: partite [${b.ids.length}], attese [${attesiIds.length}]`);
      const c = { V: 0, N: 0, S: 0 }; b.ids.forEach(id => c[lettera(perId.get(id))]++);
      const saldo = T(b.testa.querySelector(".tel-saldo"));
      if (saldo !== `${c.V}V ${c.N}N ${c.S}S`) err.push(`${nome} ${k}: saldo "${saldo}", atteso ${c.V}V ${c.N}N ${c.S}S`);
    }
    return err;
  };
  verifica(`Partite: ogni riga e ogni serata contro i dati grezzi (${partite.length} partite)`, controllaElenco(partite, "tutte"));
  const errFiltro = [];
  for (const tipo of ["playoffMatch", "leagueMatch", "tutte"]) {
    if (!clic(d.querySelector(`#partiteFiltro [data-tipo="${tipo}"]`))) { errFiltro.push(`manca il filtro ${tipo}`); continue; }
    errFiltro.push(...controllaElenco(tipo === "tutte" ? partite : partite.filter(m => m.match_type === tipo), tipo));
  }
  verifica("Partite: il filtro per tipo, con righe e saldi rifatti sul solo tipo scelto", errFiltro);

  // La partita aperta: un giocatore per riga, voto e numeri contro DATA.matchPlayers.
  const errPagelle = [];
  let aperte = 0;
  for (const tr of [...d.querySelectorAll("#matchesTable tr.match-row")].slice(0, 15)) {
    const m = perId.get(tr.dataset.match), giocatori = (DATA.matchPlayers || {})[m.match_id] || [];
    clic(tr.querySelector(".tel-partita"));
    const det = d.getElementById(`detail-${tr.dataset.idx}`);
    if (!det.classList.contains("open")) { errPagelle.push(`${m.match_id}: toccata, non si apre`); continue; }
    aperte++;
    const pag = [...det.querySelectorAll(".pagelle tbody tr")];
    if (pag.length !== giocatori.length) errPagelle.push(`${m.match_id}: ${pag.length} giocatori, attesi ${giocatori.length}`);
    pag.forEach(r => {
      const p = giocatori.find(x => x.player_name === T(r.querySelector(".tel-pagella .pname")));
      if (!p) { errPagelle.push(`${m.match_id}: "${T(r.querySelector(".pname"))}" non era in campo`); return; }
      if (num(T(r.querySelector(".tel-voto"))) !== Number(p.rating)) errPagelle.push(`${m.match_id} ${p.player_name}: voto ${T(r.querySelector(".tel-voto"))}, atteso ${p.rating}`);
      const sint = T(r.querySelector(".tel-pagella .tel-sotto"));
      const gol = (sint.match(/(\d+) gol/) || [0, 0])[1], ass = (sint.match(/(\d+) assist/) || [0, 0])[1];
      if (Number(gol) !== (p.goals || 0) || Number(ass) !== (p.assists || 0)) errPagelle.push(`${m.match_id} ${p.player_name}: "${sint}", attesi ${p.goals} gol e ${p.assists} assist`);
      if (!!r.querySelector(".tel-motm") !== !!p.mom) errPagelle.push(`${m.match_id} ${p.player_name}: stella del migliore in campo sbagliata`);
    });
    if (pag[0]) {
      clic(pag[0].querySelector(".tel-pagella"));
      if (!pag[0].classList.contains("aperta")) errPagelle.push(`${m.match_id}: tocco sul giocatore, non si apre`);
      if (!det.classList.contains("open")) errPagelle.push(`${m.match_id}: il tocco sul giocatore ha chiuso la partita`);
    }
    clic(tr.querySelector(".tel-partita"));
    if (det.classList.contains("open")) errPagelle.push(`${m.match_id}: toccata di nuovo, non si chiude`);
  }
  verifica(`Partite: pagelle della partita aperta contro i dati grezzi (${aperte} partite aperte)`, aperte ? errPagelle : ["nessuna partita aperta"]);

  console.log(falliti === 0 ? "\nLa vista da telefono torna con i dati." : `\n${falliti} controlli falliti.`);
  process.exit(falliti === 0 ? 0 : 1);
})();
