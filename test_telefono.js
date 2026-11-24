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
const apriPagina = testo => new JSDOM(testo.replace(/<script id="lib-chartjs">[\s\S]*?<\/script>/, ""), {
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
const dom = apriPagina(html);
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
  const lettera = m => (m.win ? "V" : (m.tie ? "P" : "S"));   // pareggio = P, come in Home
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
      const c = { V: 0, P: 0, S: 0 }; b.ids.forEach(id => c[lettera(perId.get(id))]++);
      const saldo = T(b.testa.querySelector(".tel-saldo"));
      if (saldo !== `${c.V}V ${c.P}P ${c.S}S`) err.push(`${nome} ${k}: saldo "${saldo}", atteso ${c.V}V ${c.P}P ${c.S}S`);
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

  // ---- Serate (18/11/2026) ----
  // Ogni serata del calendario, mese per mese: i riquadri, le righe delle partite e dei
  // giocatori contro DATA.serate, DATA.matches e DATA.matchPlayers. Lo skill rating no: dipende
  // dalle istantanee del club e da come la pagina sceglie il "prima" e il "dopo".
  const errSerate = [], errTutte = [];
  const viste = new Set();
  const controllaSchede = () => {
    for (const scheda of d.querySelectorAll("#serataDettaglio > .panel")) {
      const trs = [...scheda.querySelectorAll("table.serata-partite tbody tr")];
      if (!trs.length) continue;
      const chiave = serataDi.get(trs[0].dataset.match);
      const s = (DATA.serate || []).find(x => x.chiave === chiave);
      if (!s) { errSerate.push(`partita ${trs[0].dataset.match}: nessuna serata nei dati`); continue; }
      if (viste.has(chiave)) continue;
      viste.add(chiave);
      const ms = s.matchIds.map(id => perId.get(String(id))).filter(Boolean);
      const c = { V: 0, P: 0, S: 0 }; ms.forEach(m => c[lettera(m)]++);
      const gf = ms.reduce((t, m) => t + m.goals_for, 0), gs = ms.reduce((t, m) => t + m.goals_against, 0);
      const riq = k => T(scheda.querySelector(`.tel-riquadro b[data-v="${k}"]`));
      if (riq("partite") !== String(ms.length)) errSerate.push(`${s.giorno}: riquadro partite ${riq("partite")}, attese ${ms.length}`);
      if (riq("saldo") !== `${c.V}V ${c.P}P ${c.S}S`) errSerate.push(`${s.giorno}: saldo ${riq("saldo")}, atteso ${c.V}V ${c.P}P ${c.S}S`);
      if (riq("gol") !== `${gf} – ${gs}`) errSerate.push(`${s.giorno}: gol ${riq("gol")}, attesi ${gf} – ${gs}`);
      if (trs.map(tr => tr.dataset.match).join() !== ms.map(m => String(m.match_id)).join()) errSerate.push(`${s.giorno}: partite diverse da quelle della serata`);
      trs.forEach((tr, i) => {
        const m = perId.get(tr.dataset.match); if (!m) return;
        if (T(tr.querySelector(".tel-esito")) !== lettera(m)) errSerate.push(`${s.giorno} ${m.match_id}: esito ${T(tr.querySelector(".tel-esito"))}, atteso ${lettera(m)}`);
        if (T(tr.querySelector(".tel-ris")) !== `${m.goals_for} – ${m.goals_against}`) errSerate.push(`${s.giorno} ${m.match_id}: risultato ${T(tr.querySelector(".tel-ris"))}`);
        if (tr.classList.contains("tel-oltre") !== (i >= 5)) errSerate.push(`${s.giorno}: la partita ${i + 1} ${i >= 5 ? "non e' nascosta" : "e' nascosta"} prima di "mostra tutte"`);
      });
      const bott = scheda.querySelector(".tel-tutte");
      if (!!bott !== (ms.length > 5)) errTutte.push(`${s.giorno}: ${ms.length} partite, tasto "mostra tutte" ${bott ? "presente" : "assente"}`);
      if (bott) {
        clic(bott);
        if (!scheda.querySelector("table.serata-partite").classList.contains("tutte") || scheda.querySelector(".tel-tutte")) errTutte.push(`${s.giorno}: "mostra tutte" toccato, le partite restano nascoste`);
      }
      // I giocatori: presenze, media voto, gol, assist e stelle rifatti dalle pagelle.
      const agg = new Map();
      ms.forEach(m => ((DATA.matchPlayers || {})[m.match_id] || []).forEach(p => {
        const a = agg.get(p.player_name) || { n: 0, somma: 0, gol: 0, ass: 0, mom: 0 };
        a.n++; a.somma += p.rating || 0; a.gol += p.goals || 0; a.ass += p.assists || 0; a.mom += p.mom || 0;
        agg.set(p.player_name, a);
      }));
      const gio = [...scheda.querySelectorAll("table.serata-giocatori tbody tr")];
      if (gio.length !== agg.size) errSerate.push(`${s.giorno}: ${gio.length} giocatori, attesi ${agg.size}`);
      gio.forEach(tr => {
        const nome = T(tr.querySelector(".tel-giocatore .pname")), a = agg.get(nome);
        if (!a) { errSerate.push(`${s.giorno}: "${nome}" non ha giocato quella sera`); return; }
        const sotto = T(tr.querySelector(".tel-giocatore .tel-sotto"));
        const pres = (sotto.match(/(\d+) pres/) || [0, -1])[1], gol = (sotto.match(/(\d+) gol/) || [0, 0])[1], ass = (sotto.match(/(\d+) assist/) || [0, 0])[1];
        if (Number(pres) !== a.n || Number(gol) !== a.gol || Number(ass) !== a.ass) errSerate.push(`${s.giorno} ${nome}: "${sotto}", attesi ${a.n} pres, ${a.gol} gol, ${a.ass} assist`);
        if (Math.abs(num(T(tr.querySelector(".tel-voto"))) - a.somma / a.n) > TOLL) errSerate.push(`${s.giorno} ${nome}: media ${T(tr.querySelector(".tel-voto"))}, attesa ${(a.somma / a.n).toFixed(2)}`);
        const stelle = T(tr.querySelector(".tel-motm"));
        if ((a.mom ? (a.mom > 1 ? `⭐${a.mom}` : "⭐") : "") !== stelle) errSerate.push(`${s.giorno} ${nome}: stelle "${stelle}", MOTM ${a.mom}`);
        if (!tr.querySelector(".tel-giocatore .player-link[data-player]")) errSerate.push(`${s.giorno} ${nome}: il nome non apre la scheda`);
      });
    }
  };
  const mesiVisti = new Set();
  for (let giro = 0; giro < 60; giro++) {
    const titolo = T(d.querySelector("#serateFiltri .calTitolo"));
    if (!mesiVisti.has(titolo)) {
      mesiVisti.add(titolo);
      const giorni = [...d.querySelectorAll("#serateFiltri .calDay.haPartite")].map(x => x.dataset.g);
      for (const g of giorni) { clic(d.querySelector(`#serateFiltri .calDay.haPartite[data-g="${g}"]`)); controllaSchede(); }
    }
    // Il mese precedente non ancora visto, finche' ce n'e' uno.
    const nav = [...d.querySelectorAll("#serateFiltri .calNav")].filter(n => n.style.visibility !== "hidden");
    const prima = T(d.querySelector("#serateFiltri .calTitolo"));
    let mosso = false;
    for (const n of nav) {
      clic(n);
      if (!mesiVisti.has(T(d.querySelector("#serateFiltri .calTitolo")))) { mosso = true; break; }
      if (T(d.querySelector("#serateFiltri .calTitolo")) !== prima) clic([...d.querySelectorAll("#serateFiltri .calNav")].find(x => x.dataset.d === String(-Number(n.dataset.d))));
    }
    if (!mosso) break;
  }
  if (viste.size !== (DATA.serate || []).length) errSerate.push(`serate controllate ${viste.size}, nei dati ${(DATA.serate || []).length}`);
  verifica(`Serate: riquadri, partite e giocatori di ogni serata contro i dati grezzi (${viste.size} serate)`, errSerate);
  verifica("Serate: oltre la quinta partita il tasto \"mostra tutte\", e toccato le mostra", errTutte);

  // ---- Avversari (18/11/2026) ----
  // Riferimento: DATA.matches raggruppate per nome dell'avversario, rifatte qui. jsdom non applica
  // il CSS, quindi "nascosta" si legge dalla classe tel-oltre, che e' cio' che il CSS nasconde.
  const NORM = s => String(s || "Sconosciuto").replace(/\s+/g, " ").trim();
  const avv = new Map();
  partite.forEach(m => {
    const k = NORM(m.opponent_name);
    if (!avv.has(k)) avv.set(k, { n: 0, v: 0, p: 0, s: 0, gf: 0, gs: 0, ultima: null });
    const a = avv.get(k);
    a.n++; a.gf += m.goals_for; a.gs += m.goals_against;
    if (m.win) a.v++; else if (m.tie) a.p++; else a.s++;
    if (!a.ultima || (m.ts || 0) > (a.ultima.ts || 0)) a.ultima = m;
  });
  const PER_VOLTA = 20;   // quante righe alla volta: deciso con Peppe il 18/11/2026
  const righeAvv = () => [...d.querySelectorAll("#opponentsTable tbody tr")].filter(tr => tr.querySelector(".tel-avversario"));
  const visibiliAvv = () => righeAvv().filter(tr => !tr.classList.contains("tel-oltre"));
  const nomeAvv = tr => T(tr.querySelector(".tel-avv"));
  const altriAvv = d.getElementById("opponentAltri");
  const ordina = d.getElementById("opponentOrdina");
  const filtroAvv = d.getElementById("opponentFilter");
  const scegli = v => { ordina.value = v; ordina.dispatchEvent(new w.Event("change")); };
  const cerca = v => { filtroAvv.value = v; filtroAvv.dispatchEvent(new w.Event("input")); };

  // 1. All'apertura: i piu' recenti, venti, e il tasto con il conto giusto.
  const errAperto = [];
  const perRecenza = [...avv.entries()].sort((x, y) => (y[1].ultima.ts || 0) - (x[1].ultima.ts || 0)).map(([k]) => k);
  const vis0 = visibiliAvv().map(nomeAvv);
  if (vis0.length !== Math.min(PER_VOLTA, avv.size)) errAperto.push(`${vis0.length} righe visibili, attese ${Math.min(PER_VOLTA, avv.size)}`);
  vis0.forEach((n, i) => { if (n !== perRecenza[i]) errAperto.push(`posizione ${i + 1}: ${n}, atteso ${perRecenza[i]}`); });
  const resto = avv.size - PER_VOLTA;
  if (resto > 0 && (altriAvv.hidden || !T(altriAvv).includes(`ne restano ${resto}`))) errAperto.push(`tasto: "${T(altriAvv)}" hidden=${altriAvv.hidden}, attesi ${resto} rimasti`);
  verifica(`Avversari: all'apertura i ${PER_VOLTA} piu' recenti e il tasto per gli altri`, errAperto);

  // 2. Tocco dopo tocco fino all'ultimo: ogni riga contro i dati.
  const errAvv = [];
  let giri = 0;
  while (!altriAvv.hidden && giri++ < 100) clic(altriAvv);
  if (!altriAvv.hidden) errAvv.push("il tasto non sparisce mai");
  if (visibiliAvv().length !== avv.size) errAvv.push(`${visibiliAvv().length} avversari visibili alla fine, nei dati ${avv.size}`);
  const vistiAvv = new Set();
  righeAvv().forEach(tr => {
    const n = nomeAvv(tr), a = avv.get(n);
    if (!a) { errAvv.push(`"${n}" non nei dati`); return; }
    vistiAvv.add(n);
    const es = T(tr.querySelector(".tel-esito"));
    if (es !== lettera(a.ultima)) errAvv.push(`${n}: lettera ${es}, ultima partita ${lettera(a.ultima)}`);
    const sotto = T(tr.querySelector(".tel-sotto"));
    if (a.n > 1) {
      if (!sotto.startsWith(`${a.n} partite`)) errAvv.push(`${n}: "${sotto}", attese ${a.n} partite`);
      const val = `${T(tr.querySelector(".tel-valore b"))} ${T(tr.querySelector(".tel-valore span"))}`;
      if (val !== `${a.v}V ${a.p}P ${a.s}S gol ${a.gf}–${a.gs}`) errAvv.push(`${n}: "${val}", atteso ${a.v}V ${a.p}P ${a.s}S gol ${a.gf}–${a.gs}`);
    } else {
      if (/partite/.test(sotto)) errAvv.push(`${n}: una partita sola ma scritto "${sotto}"`);
      const ris = T(tr.querySelector(".tel-ris"));
      if (ris !== `${a.gf} – ${a.gs}`) errAvv.push(`${n}: risultato "${ris}", atteso ${a.gf} – ${a.gs}`);
    }
  });
  if (vistiAvv.size !== avv.size) errAvv.push(`avversari in pagina ${vistiAvv.size}, nei dati ${avv.size}`);
  verifica(`Avversari: ogni riga da telefono contro i dati grezzi (${avv.size} avversari)`, errAvv);

  // 3. Ordine e ricerca. Cambiare ordine riparte da venti; cercare trova anche chi e' nascosto.
  const errOrdineAvv = [];
  scegli("games");
  const maxN = Math.max(...[...avv.values()].map(a => a.n));
  const vg = visibiliAvv();
  if (vg.length !== Math.min(PER_VOLTA, avv.size)) errOrdineAvv.push(`dopo il cambio d'ordine ${vg.length} righe, attese ${PER_VOLTA}`);
  if (vg.length && avv.get(nomeAvv(vg[0])).n !== maxN) errOrdineAvv.push(`"Piu' affrontati": primo ${nomeAvv(vg[0])} con ${avv.get(nomeAvv(vg[0])).n}, il massimo e' ${maxN}`);
  scegli("lastTs");
  const nascosto = perRecenza[perRecenza.length - 1];
  cerca(nascosto);
  const trovati = visibiliAvv().map(nomeAvv);
  if (!trovati.includes(nascosto)) errOrdineAvv.push(`cercando "${nascosto}" (il meno recente) non compare: ${trovati.join(", ")}`);
  if (!altriAvv.hidden) errOrdineAvv.push("durante la ricerca il tasto \"mostra altri\" resta");
  // Una ricerca che trova piu' di venti avversari: il limite non vale, si vedono tutti.
  // (Con un nome solo il risultato sta comunque nelle prime venti righe e non prova niente.)
  const largo = ["fc", "a", "e"].find(x => [...avv.keys()].filter(k => k.toLowerCase().includes(x)).length > PER_VOLTA);
  if (largo) {
    const attesi = [...avv.keys()].filter(k => k.toLowerCase().includes(largo)).length;
    cerca(largo);
    if (visibiliAvv().length !== attesi) errOrdineAvv.push(`cercando "${largo}": ${visibiliAvv().length} visibili, attesi ${attesi}`);
  }
  cerca("");
  verifica("Avversari: ordine \"piu' affrontati\" e ricerca anche fra i nascosti", errOrdineAvv);

  // 4. Fasce di livello: la riga da telefono dice gli stessi numeri delle celle della tabella
  //    (quelle le rifa' da zero test_avversari.js).
  const errFasce = [];
  const fasceAvv = [...d.querySelectorAll("#livelloAvversari tbody tr")];
  // Senza fasce la pagina deve dire perche' (FC 26: i livelli raccolti dopo la fine del titolo).
  if (fasceAvv.length === 0 && !/Il livello degli avversari/.test(T(d.getElementById("livelloAvversari")))) errFasce.push("nessuna fascia e nessuna spiegazione");
  fasceAvv.forEach(tr => {
    const c = l => T(tr.querySelector(`td[data-label="${l}"]`));
    const atteso = `${c("Partite")} partite · ${c("Bilancio")} · ${c("Gol").replace("-", "–")}`;
    if (T(tr.querySelector(".tel-fascia .tel-sotto")) !== atteso) errFasce.push(`${c("Fascia")}: "${T(tr.querySelector(".tel-fascia .tel-sotto"))}", atteso "${atteso}"`);
    if (T(tr.querySelector(".tel-fascia .tel-valore b")) !== c("Punti a partita")) errFasce.push(`${c("Fascia")}: punti ${T(tr.querySelector(".tel-fascia .tel-valore b"))}, tabella ${c("Punti a partita")}`);
  });
  verifica("Avversari: le fasce di livello da telefono dicono i numeri della tabella", errFasce);

  // ---- Indice di Forza (18/11/2026) ----
  // L'indice lo rifa' da zero test_indice.js partendo dai dati grezzi, cella per cella della
  // tabella: qui la riga da telefono deve dire gli stessi numeri di quelle celle, giocatore per
  // giocatore, in tutte e sette le tabelle. Piu' le cose che esistono solo sul telefono: il
  // reparto scelto, i conti sui pulsanti, il link della tecnica.
  const cella = (tr, l) => T(tr.querySelector(`td[data-label="${l}"]`));
  const tessera = (tr, e) => { const t = [...tr.querySelectorAll(".tel-tessera")].find(x => T(x.querySelector("span")) === e); return t ? T(t.querySelector("b")) : null; };
  const righeForza = sel => [...d.querySelectorAll(sel)].filter(tr => tr.querySelector(".tel-riga"));

  const errGen = [];
  const gen = righeForza("#powerTable tbody tr");
  if (gen.length === 0) errGen.push("nessuna riga nella generale");
  gen.forEach(tr => {
    const nome = T(tr.querySelector(".tel-riga .pname")), g = cella(tr, "Giocatore");
    if (nome !== g) errGen.push(`riga "${nome}", colonna "${g}"`);
    const pos = cella(tr, "#"), rango = T(tr.querySelector(".tel-rango"));
    if (rango !== (pos.startsWith("#") ? pos.slice(1) : "–")) errGen.push(`${g}: posizione ${rango}, colonna ${pos}`);
    const indice = cella(tr, "Indice"), val = T(tr.querySelector(".tel-valore b"));
    if (pos.startsWith("#") ? val !== indice : val !== "—") errGen.push(`${g}: indice ${val}, colonna ${indice}`);
    if (pos.startsWith("#") && T(tr.querySelector(".tel-valore span")) !== cella(tr, "Δ")) errGen.push(`${g}: variazione "${T(tr.querySelector(".tel-valore span"))}", colonna "${cella(tr, "Δ")}"`);
    const forma = cella(tr, "Forma").split(" ")[0];
    for (const [e, v] of [["Storico", cella(tr, "Storico")], ["Forma", forma], ["Media", cella(tr, "Media")], ["G+A/partita", cella(tr, "G+A/partita")], ["Tecnica", cella(tr, "Tecnica")], ["MOTM%", cella(tr, "MOTM%")]])
      if (tessera(tr, e) !== v) errGen.push(`${g}: tessera ${e} ${tessera(tr, e)}, colonna ${v}`);
    if (pos.startsWith("#") && forma !== "-" && !T(tr.querySelector(".tel-sotto")).includes(`forma ${forma}`)) errGen.push(`${g}: sotto il nome "${T(tr.querySelector(".tel-sotto"))}", forma ${forma}`);
  });
  verifica(`Indice di Forza: la generale da telefono dice i numeri delle colonne (${gen.length} giocatori)`, errGen);

  const errRep = [];
  const pannelli = [...d.querySelectorAll("#roleBoards .forza-reparto")];
  const bottoniRep = [...d.querySelectorAll("#roleBoards .tel-reparti [data-reparto]")];
  if (pannelli.length === 0) errRep.push("nessun reparto");
  if (bottoniRep.length !== pannelli.length) errRep.push(`${bottoniRep.length} pulsanti per ${pannelli.length} reparti`);
  // Si parte dal reparto con piu' partite, sommate dalla colonna "Partite nel ruolo".
  const partiteRep = p => [...p.querySelectorAll('td[data-label="Partite nel ruolo"]')].reduce((t, c) => t + Number(T(c)), 0);
  const repAtteso = pannelli.slice().sort((x, y) => partiteRep(y) - partiteRep(x))[0];
  const scelti = () => [...d.querySelectorAll("#roleBoards .forza-reparto")].filter(p => p.classList.contains("tel-scelto")).map(p => p.dataset.reparto);
  if (repAtteso && scelti().join() !== repAtteso.dataset.reparto) errRep.push(`all'apertura scelto ${scelti().join()}, atteso ${repAtteso.dataset.reparto} (piu' partite)`);
  const MED = { "🥇": "1", "🥈": "2", "🥉": "3" };
  let righeRep = 0;
  for (const b of bottoniRep) {
    clic(b);
    const rep = b.dataset.reparto;
    if (scelti().join() !== rep) errRep.push(`toccato ${rep}, visibili ${scelti().join() || "nessuno"}`);
    const righe = righeForza(`#roleBoards .forza-reparto[data-reparto="${rep}"] tbody tr`);
    if (!T(b).endsWith(" " + righe.length)) errRep.push(`${rep}: pulsante "${T(b)}", righe ${righe.length}`);
    righe.forEach(tr => {
      righeRep++;
      const g = cella(tr, "Giocatore").replace(/ da assegnare$/, "");
      if (T(tr.querySelector(".tel-riga .pname")) !== g) errRep.push(`${rep}: riga "${T(tr.querySelector(".tel-riga .pname"))}", colonna "${g}"`);
      const pos = cella(tr, "#"), indice = cella(tr, "Indice"), val = T(tr.querySelector(".tel-valore b"));
      const rangoAtteso = MED[pos] || (/^\d+$/.test(pos) ? pos : "–");
      if (T(tr.querySelector(".tel-rango")) !== rangoAtteso) errRep.push(`${rep} ${g}: posizione ${T(tr.querySelector(".tel-rango"))}, colonna ${pos}`);
      const valAtteso = /^\d/.test(indice) ? indice : indice === "n/d" ? "n/d" : "—";
      if (val !== valAtteso) errRep.push(`${rep} ${g}: indice ${val}, colonna ${indice}`);
      const sotto = T(tr.querySelector(".tel-sotto"));
      const n = cella(tr, "Partite nel ruolo");
      if (sotto !== `${n} ${n === "1" ? "partita" : "partite"} qui · ${cella(tr, "Gol")} gol · ${cella(tr, "Assist")} assist`) errRep.push(`${rep} ${g}: "${sotto}"`);
      for (const e of ["Media", "G+A/partita", "Tecnica", "MOTM%", "Gol", "Assist"])
        if (tessera(tr, e) !== cella(tr, e)) errRep.push(`${rep} ${g}: tessera ${e} ${tessera(tr, e)}, colonna ${cella(tr, e)}`);
    });
  }
  // Il minimo di partite ridisegna i reparti: la scelta deve restare e i conti seguire.
  const ultimoRep = bottoniRep.length ? bottoniRep[bottoniRep.length - 1].dataset.reparto : null;
  const dieci = d.querySelector('#roleMinFilters [data-min="10"]');
  if (dieci && ultimoRep) {
    clic(dieci);
    if (scelti().join() !== ultimoRep) errRep.push(`dopo il minimo a 10 il reparto scelto e' ${scelti().join()}, non piu' ${ultimoRep}`);
    [...d.querySelectorAll("#roleBoards .tel-reparti [data-reparto]")].forEach(b => {
      const n = righeForza(`#roleBoards .forza-reparto[data-reparto="${b.dataset.reparto}"] tbody tr`).length;
      if (!T(b).endsWith(" " + n)) errRep.push(`minimo 10, ${b.dataset.reparto}: pulsante "${T(b)}", righe ${n}`);
    });
    clic(d.querySelector('#roleMinFilters [data-min="1"]'));
  }
  verifica(`Indice di Forza: reparti uno alla volta, ogni riga contro le colonne (${righeRep} righe)`, errRep);

  // Il link della tecnica apre il riquadro di QUELLA riga e lascia la riga aperta.
  const errTec = [];
  const conTec = [...righeForza("#powerTable tbody tr"), ...righeForza("#roleBoards tbody tr")];
  conTec.forEach(tr => {
    const b = tr.querySelector(".tel-tec");
    if (!b) { errTec.push(`${cella(tr, "Giocatore")}: manca il link`); return; }
    const cellaTec = tr.querySelector("td[data-label='Tecnica'] .tec-apri");
    if (!cellaTec || cellaTec.dataset.tec !== b.dataset.tec) { errTec.push(`${cella(tr, "Giocatore")}: link ${b.dataset.tec}, colonna ${cellaTec && cellaTec.dataset.tec}`); return; }
    if (!tr.classList.contains("aperta")) clic(tr.querySelector(".tel-riga"));
    clic(b);
    const det = d.getElementById("tec-" + b.dataset.tec);
    if (!det || !det.classList.contains("open")) errTec.push(`${b.dataset.tec}: riquadro non aperto`);
    if (!tr.classList.contains("aperta")) errTec.push(`${b.dataset.tec}: la riga si e' chiusa`);
    clic(b);
    if (det && det.classList.contains("open")) errTec.push(`${b.dataset.tec}: secondo tocco non lo chiude`);
    clic(tr.querySelector(".tel-riga"));
  });
  verifica(`Indice di Forza: il link della tecnica apre il riquadro della sua riga (${conTec.length} righe)`, errTec);

  // ---- Vittorie e sconfitte (24/11/2026) ----
  // Partite, gol fatti e subiti e porta inviolata si rifanno qui da DATA.matches; le altre
  // voci (tiri, passaggi, contrasti, voto) devono dire i numeri delle colonne della stessa riga.
  const errDiag = [];
  const esitoDi = m => (m.win ? "V" : m.tie ? "P" : "S");
  const gruppiEsito = { V: [], P: [], S: [] };
  partite.forEach(m => gruppiEsito[esitoDi(m)].push(m));
  const media = (arr, f) => arr.reduce((t, m) => t + f(m), 0) / arr.length;
  const attesiDiag = {
    "Partite": ["V", "P", "S"].map(k => String(gruppiEsito[k].length)),
    "Gol fatti": ["V", "P", "S"].map(k => gruppiEsito[k].length ? media(gruppiEsito[k], m => m.goals_for).toFixed(1) : "—"),
    "Gol subiti": ["V", "P", "S"].map(k => gruppiEsito[k].length ? media(gruppiEsito[k], m => m.goals_against).toFixed(1) : "—"),
    "Porta inviolata": ["V", "P", "S"].map(k => gruppiEsito[k].length ? Math.round(100 * media(gruppiEsito[k], m => (m.goals_against === 0 ? 1 : 0))) + "%" : "—"),
  };
  const righeDiag = [...d.querySelectorAll("#diagnosiTabella tbody tr")];
  if (righeDiag.length === 0) errDiag.push("nessuna riga");
  const visteDiag = new Set();
  righeDiag.forEach(tr => {
    const eti = T(tr.querySelector(".tel-diag .tel-eti")), lab = cella(tr, "Indicatore");
    if (eti !== lab) errDiag.push(`riga "${eti}", colonna "${lab}"`);
    const tre = [...tr.querySelectorAll(".tel-tre b")].map(T);
    const colonne = [cella(tr, "Vittoria"), cella(tr, "Pareggio"), cella(tr, "Sconfitta")];
    if (tre.join("|") !== colonne.join("|")) errDiag.push(`${lab}: telefono ${tre.join(" ")}, colonne ${colonne.join(" ")}`);
    if (attesiDiag[lab]) { visteDiag.add(lab); if (tre.join("|") !== attesiDiag[lab].join("|")) errDiag.push(`${lab}: ${tre.join(" ")}, dai dati ${attesiDiag[lab].join(" ")}`); }
    const diff = cella(tr, "Differenza"), sotto = T(tr.querySelector(".tel-diag .tel-sotto"));
    if (diff !== sotto) errDiag.push(`${lab}: differenza "${sotto}", colonna "${diff}"`);
  });
  Object.keys(attesiDiag).forEach(k => { if (!visteDiag.has(k)) errDiag.push(`manca la riga "${k}"`); });
  verifica(`Vittorie e sconfitte: le righe da telefono contro i dati grezzi e le colonne (${righeDiag.length} voci)`, errDiag);

  // ---- Scheda osservatore (24/11/2026) ----
  // Ogni giocatore, con ogni metro di confronto: la riga da telefono dice il suo numero, il
  // riferimento e lo scarto delle colonne.
  const errOss = [];
  let casiOss = 0, righeOss = 0;
  const nomiOss = [...d.querySelectorAll("#ossGiocatori [data-n]")].map(b => b.dataset.n);
  const metriOss = [...d.querySelectorAll("#ossMetro [data-m]")].map(b => b.dataset.m);
  if (!nomiOss.length || !metriOss.length) errOss.push(`giocatori ${nomiOss.length}, metri ${metriOss.length}`);
  for (const n of nomiOss) {
    clic(d.querySelector(`#ossGiocatori [data-n="${n}"]`));
    for (const m of metriOss) {
      clic(d.querySelector(`#ossMetro [data-m="${m}"]`));
      const righeT = [...d.querySelectorAll("#ossConfronto .oss-tabella tbody tr")];
      if (!righeT.length) continue;   // confronto non possibile: la pagina lo dice a parole
      casiOss++;
      righeT.forEach(tr => {
        righeOss++;
        const tds = [...tr.querySelectorAll("td[data-label]")];
        const lab = T(tds[0]).replace(/ \(né bene né male\)$/, "");
        const suo = T(tds[1]).replace(/ · pochi dati$/, "").replace(/·\s*pochi dati$/, "").trim();
        const base = T(tds[2]), scarto = T(tds[3].querySelector("span"));
        const tel = tr.querySelector(".tel-oss");
        if (!tel) { errOss.push(`${n}/${m} ${lab}: manca la riga da telefono`); return; }
        if (T(tel.querySelector(".tel-eti")).replace(/ né bene né male$/, "") !== lab) errOss.push(`${n}/${m}: "${T(tel.querySelector(".tel-eti"))}" contro "${lab}"`);
        if (T(tel.querySelector(".tel-valore b")) !== suo) errOss.push(`${n}/${m} ${lab}: ${T(tel.querySelector(".tel-valore b"))}, colonna ${suo}`);
        if (T(tel.querySelector(".tel-sotto")) !== `rif. ${base} · ${scarto}`) errOss.push(`${n}/${m} ${lab}: "${T(tel.querySelector(".tel-sotto"))}", colonne rif. ${base} · ${scarto}`);
        if (/pochi dati/.test(T(tds[1])) !== /pochi dati/.test(T(tel.querySelector(".tel-valore")))) errOss.push(`${n}/${m} ${lab}: "pochi dati" non coincide`);
      });
    }
  }
  if (casiOss === 0) errOss.push("nessun confronto controllato");
  verifica(`Scheda osservatore: ogni riga da telefono contro le colonne (${nomiOss.length} giocatori, ${casiOss} confronti, ${righeOss} righe)`, errOss);

  // ---- Riepilogo: margini di gol (24/11/2026) ----
  // Il grafico non si legge sul telefono e al suo posto c'e' un elenco: i conteggi si rifanno
  // da DATA.matches, la barra piu' lunga e' il margine piu' frequente.
  const errMarg = [];
  w.showPage("riepilogo");
  await new Promise(r => setTimeout(r, 200));
  const fasceMarg = [["Sconfitta pesante", x => x <= -3], ["Sconfitta netta", x => x === -2], ["Sconfitta di misura", x => x === -1],
    ["Pareggio", x => x === 0], ["Vittoria di misura", x => x === 1], ["Vittoria netta", x => x === 2], ["Vittoria schiacciante", x => x >= 3]];
  const contiMarg = fasceMarg.map(([, f]) => partite.filter(m => f(m.goals_for - m.goals_against)).length);
  const righeMarg = [...d.querySelectorAll("#telMargini .tel-margine")];
  if (righeMarg.length !== fasceMarg.length) errMarg.push(`${righeMarg.length} righe, attese ${fasceMarg.length}`);
  const maxMarg = Math.max(...contiMarg, 1);
  righeMarg.forEach((r, i) => {
    if (!fasceMarg[i]) return;
    const eti = T(r.querySelector(".tel-margine-testa span")), n = T(r.querySelector(".tel-margine-testa b"));
    if (!eti.startsWith(fasceMarg[i][0])) errMarg.push(`riga ${i + 1}: "${eti}", attesa ${fasceMarg[i][0]}`);
    if (n !== String(contiMarg[i])) errMarg.push(`${fasceMarg[i][0]}: ${n}, dai dati ${contiMarg[i]}`);
    const larg = parseFloat(r.querySelector(".tel-margine-traccia div").style.width);
    if (Math.abs(larg - 100 * contiMarg[i] / maxMarg) > 0.06) errMarg.push(`${fasceMarg[i][0]}: barra ${larg}%, attesa ${(100 * contiMarg[i] / maxMarg).toFixed(1)}%`);
  });
  verifica("Riepilogo: i margini di gol da telefono contro i dati grezzi", errMarg);

  // ---- Formazione (24/11/2026) ----
  const errForm = [];
  const righeForm = [...d.querySelectorAll("#formationTable tbody tr")];
  if (righeForm.length === 0) errForm.push("nessuna riga");
  const sulCampo = new Set([...d.querySelectorAll("#pitchField .pitch-player[data-player]")].map(x => x.dataset.player));
  righeForm.forEach(tr => {
    const tel = tr.querySelector(".tel-formazione");
    const g = cella(tr, "Giocatore");
    if (!tel) { errForm.push(`${g}: manca la riga da telefono`); return; }
    if (T(tel.querySelector(".pname")) !== g) errForm.push(`riga "${T(tel.querySelector(".pname"))}", colonna "${g}"`);
    if (T(tel.querySelector(".tel-ruolo")) !== cella(tr, "Ruolo")) errForm.push(`${g}: ruolo ${T(tel.querySelector(".tel-ruolo"))}, colonna ${cella(tr, "Ruolo")}`);
    if (T(tel.querySelector(".tel-valore b")) !== cella(tr, "Indice")) errForm.push(`${g}: indice ${T(tel.querySelector(".tel-valore b"))}, colonna ${cella(tr, "Indice")}`);
    const n = cella(tr, "Partite nel ruolo");
    const sottoAtteso = `${n} ${n === "1" ? "partita" : "partite"} · media ${cella(tr, "Media voto")}${/stima/.test(cella(tr, "Fonte")) ? " · stima" : ""}`;
    if (T(tel.querySelector(".tel-sotto")) !== sottoAtteso) errForm.push(`${g}: "${T(tel.querySelector(".tel-sotto"))}", atteso "${sottoAtteso}"`);
    if (!sulCampo.has(g)) errForm.push(`${g} in elenco ma non sul campo`);
  });
  if (righeForm.length !== sulCampo.size) errForm.push(`${righeForm.length} in elenco, ${sulCampo.size} sul campo`);
  verifica(`Formazione: l'elenco da telefono contro le colonne e il campo (${righeForm.length} giocatori)`, errForm);

  // Oggi nessun posto e' riempito a stima, e la parola "stima" sotto il nome resterebbe senza
  // prova. Una seconda copia della pagina in cui nessuna partita risulta giocata in difesa:
  // i tre posti dietro si riempiono con l'Indice di Forza generale, cioe' a stima.
  const errStima = [];
  const datiStima = JSON.parse(JSON.stringify(DATA));
  Object.values(datiStima.matchPlayers || {}).forEach(lista => lista.forEach(p => { if (p.pos === "defender") p.pos = "goalkeeper"; }));
  // Le posizioni si ricalcolano: piu' sopra la pagina e' gia' stata riscritta (la serata mista).
  const iniS = html.indexOf("const DATA = ") + "const DATA = ".length;
  const fineS = iniS + html.slice(iniS).search(/;\r?\n/);
  const domStima = apriPagina(html.slice(0, iniS) + JSON.stringify(datiStima).replace(/</g, "\\u003c") + html.slice(fineS));
  await new Promise(r => setTimeout(r, 1500));
  const righeStima = [...domStima.window.document.querySelectorAll("#formationTable tbody tr")].filter(tr => /stima/.test(cella(tr, "Fonte")));
  if (righeStima.length === 0) errStima.push("la copia senza difensori non ha prodotto nessuna stima: il caso non e' provato");
  righeStima.forEach(tr => {
    if (!T(tr.querySelector(".tel-formazione .tel-sotto")).endsWith("· stima")) errStima.push(`${cella(tr, "Giocatore")}: a stima ma sotto il nome "${T(tr.querySelector(".tel-formazione .tel-sotto"))}"`);
  });
  domStima.window.close();
  verifica(`Formazione: chi e' messo a stima lo dice anche sul telefono (${righeStima.length} posti, in una copia senza difensori)`, errStima);

  console.log(falliti === 0 ? "\nLa vista da telefono torna con i dati." : `\n${falliti} controlli falliti.`);
  process.exit(falliti === 0 ? 0 : 1);
})();
