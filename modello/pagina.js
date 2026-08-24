
const DATA = __DATA_JSON__;

// Esclude OVUNQUE (rosa, classifiche, premi, top marcatori, confronto giocatori) chi ha
// giocato meno di questo numero di partite col club: sample troppo piccolo per essere
// rappresentativo (es. 2 partite giocate falsano medie e statistiche). Il filtro è
// applicato una sola volta qui, alla fonte, così nessuna sezione può più mostrarli.
const LEADERBOARD_MIN_GAMES = __MIN_GAMES__;

// Chi ha lasciato il club non arriva nemmeno qui: generate_dashboard.py lo esclude
// prima di scrivere la pagina, e il suo nome non compare nel file. Vedi 'ex_giocatori'
// in roles.json.
DATA.roster = (DATA.roster || []).filter(r => r.games_played >= LEADERBOARD_MIN_GAMES);

// ---- Ruolo effettivo: la posizione occupata davvero in campo ----
// EA espone due cose diverse: "favoritePosition" (il ruolo dichiarato/archetipo del
// pro) e il campo "pos" di ogni singola partita (dove ha giocato per davvero).
// Contano solo le partite: se un attaccante viene schierato in difesa, quella
// partita pesa come difensore. Il ruolo preferito resta solo come ripiego per chi
// non ha ancora partite archiviate.
const ROLE_COUNTS_BY_NAME = (function(){
  const m = new Map();
  (DATA.matches || []).forEach(mt => {
    (DATA.matchPlayers[mt.match_id] || []).forEach(p => {
      if(!p.pos) return;
      if(!m.has(p.player_name)) m.set(p.player_name, {});
      const c = m.get(p.player_name);
      c[p.pos] = (c[p.pos] || 0) + 1;
    });
  });
  return m;
})();

function roleCountsSorted(name){
  const c = ROLE_COUNTS_BY_NAME.get(name);
  return c ? Object.entries(c).sort((a,b) => b[1] - a[1]) : [];
}

(DATA.roster || []).forEach(r => {
  const sorted = roleCountsSorted(r.player_name);
  r.role_counts = sorted.length ? Object.fromEntries(sorted) : null;
  r.role_matches = sorted.reduce((a, [,n]) => a + n, 0);
  r.role_effective = sorted.length ? sorted[0][0] : (r.favorite_position || null);
  r.role_from_matches = sorted.length > 0;
});

// ---- Ruoli del club e classifiche per reparto ----
// Stessa formula dell'Indice di Forza, ma ogni giocatore viene normalizzato SOLO contro i pari
// ruolo: cosi' un difensore non viene penalizzato dal fatto che gol e assist pesano il 20%.
// Il ruolo abituale arriva da roles.json (EA non distingue COC da CC); per la singola partita
// vince invece l'etichetta EA, cosi' chi gioca fuori ruolo viene conteggiato dove ha giocato.
const ROLE_CFG = DATA.roleGroups || {};
const GROUP_ORDER = ROLE_CFG.order || ["DIFENSORI", "CENTROCAMPISTI", "ESTERNI", "ATTACCANTI", "PORTIERI"];
const GROUP_LABELS = ROLE_CFG.labels || {};
const GROUP_OF_PLAYER = ROLE_CFG.players || {};
const EA_LABEL_OF_PLAYER = ROLE_CFG.eaLabels || {};
const MACRO_TO_GROUP = ROLE_CFG.macro || {};
const ROLE_EXCEPTIONS = ROLE_CFG.exceptions || {};
const GROUP_ICONS = { DIFENSORI: "🛡️", CENTROCAMPISTI: "🎛️", ESTERNI: "🏃", ATTACCANTI: "🎯", PORTIERI: "🧤" };

function mainPosOf(name){
  const sorted = roleCountsSorted(name);
  return sorted.length ? sorted[0][0] : null;
}

// Gruppo di UNA singola partita. Se l'etichetta EA di quella partita coincide con la posizione
// abituale del giocatore vale il ruolo scritto a mano (e' li' che serve: EA direbbe "midfielder"
// anche per un COC). Se invece differisce, ha giocato fuori ruolo e conta il dato EA.
// Qual e' l'etichetta che EA usa normalmente per questo giocatore quando gioca nel suo
// ruolo. Dedurla dalla posizione piu' frequente sembrava comodo, ma rendeva lo storico
// instabile: domenicocasaburi aveva 15 partite come "midfielder" e 15 come "forward", e
// una sola partita in piu' avrebbe riclassificato all'indietro tutte le altre. Quando
// l'etichetta e' dichiarata in roles.json il passato non si muove piu'.
function etichettaAttesa(name){
  return EA_LABEL_OF_PLAYER[name] || mainPosOf(name);
}

function groupForMatch(name, pos){
  const manual = GROUP_OF_PLAYER[name] || null;
  const fromEa = MACRO_TO_GROUP[pos] || null;
  if(!manual) return fromEa;
  const attesa = etichettaAttesa(name);
  if(pos && attesa && pos !== attesa) return fromEa || manual;
  return manual;
}

// Il ruolo ufficiale di un giocatore nella dashboard e' il suo gruppo di roles.json.
// Prima convivevano due nozioni diverse: le classifiche per reparto usavano i gruppi
// veri, tutto il resto (rosa, indice di forza, scheda giocatore) l'etichetta EA piu'
// frequente. Jysmu risultava "Centrocampo" in una sezione ed "Esterni" nell'altra.
// Chi non e' ancora assegnato in roles.json ripiega sull'etichetta EA, tradotta in gruppo.
function gruppoGiocatore(nome, ripiego){
  if(GROUP_OF_PLAYER[nome]) return GROUP_OF_PLAYER[nome];
  return MACRO_TO_GROUP[ripiego] || null;
}

const GRUPPO_CSS = {
  DIFENSORI: "defender", CENTROCAMPISTI: "midfielder", ESTERNI: "esterni",
  ATTACCANTI: "forward", PORTIERI: "goalkeeper",
};

function gruppoBadge(gruppo, daAssegnare){
  const cls = GRUPPO_CSS[gruppo] || "unknown";
  const etichetta = GROUP_LABELS[gruppo] || gruppo || "-";
  const titolo = daAssegnare
    ? ' title="Ruolo dedotto dai dati EA: non ancora assegnato in roles.json"' : "";
  return `<span class="role-badge ${cls}"${titolo}>${etichetta}${daAssegnare ? " ?" : ""}</span>`;
}

(DATA.roster || []).forEach(r => {
  r.gruppo = gruppoGiocatore(r.player_name, r.role_effective);
  r.gruppo_da_assegnare = !GROUP_OF_PLAYER[r.player_name];
});

function computeGroupScores(){
  const rosterNames = new Set((DATA.roster || []).map(r => r.player_name));
  const winByMatch = new Map((DATA.matches || []).map(m => [m.match_id, m.win ? 1 : 0]));
  const agg = {};
  (DATA.matches || []).forEach(m => {
    (DATA.matchPlayers[m.match_id] || []).forEach(p => {
      if(!rosterNames.has(p.player_name)) return;
      // Un'eccezione dichiarata a mano batte qualsiasi deduzione: e' l'unico modo di
      // separare un COC da un CC, che per EA hanno la stessa identica etichetta.
      const group = ROLE_EXCEPTIONS[m.match_id + "|" + p.player_name]
                 || groupForMatch(p.player_name, p.pos);
      if(!group) return;
      const key = p.player_name + "|" + group;
      if(!agg[key]){
        agg[key] = { player_name: p.player_name, group, games: 0, sumRating: 0, sumGoals: 0,
          sumAssists: 0, sumMom: 0, sumWin: 0, sumPassesMade: 0, sumPassAttempts: 0,
          sumTacklesMade: 0, sumTackleAttempts: 0, sumShots: 0, sumRedCards: 0,
          unassigned: !GROUP_OF_PLAYER[p.player_name] };
      }
      const a = agg[key];
      a.games++;
      a.sumRating        += p.rating || 0;
      a.sumGoals         += p.goals || 0;
      a.sumAssists       += p.assists || 0;
      a.sumMom           += p.mom || 0;
      a.sumWin           += winByMatch.get(m.match_id) || 0;
      a.sumPassesMade    += p.passes_made || 0;
      a.sumPassAttempts  += p.pass_attempts || 0;
      a.sumTacklesMade   += p.tackles_made || 0;
      a.sumTackleAttempts+= p.tackle_attempts || 0;
      a.sumShots         += p.shots || 0;
      a.sumRedCards      += p.red_cards || 0;
    });
  });
  return Object.values(agg).map(a => {
    const passSuccess   = a.sumPassAttempts > 0 ? (a.sumPassesMade / a.sumPassAttempts) * 100 : 0;
    const tackleSuccess = a.sumTackleAttempts > 0 ? (a.sumTacklesMade / a.sumTackleAttempts) * 100 : 0;
    const shotSuccess   = a.sumShots > 0 ? (a.sumGoals / a.sumShots) * 100 : 0;
    return { ...a,
      ratingAve: a.sumRating / a.games,
      contrib:   (a.sumGoals + a.sumAssists) / a.games,
      motmRate:  (a.sumMom / a.games) * 100,
      winRate:   (a.sumWin / a.games) * 100,
      techEff:   (passSuccess + tackleSuccess + shotSuccess) / 3,
      redRate:   a.sumRedCards / a.games,
    };
  });
}

// Il punteggio si normalizza sui soli giocatori che superano la soglia: cambiando il minimo
// cambia il gruppo di confronto, quindi va ricalcolato ogni volta invece che filtrato dopo.
// Quante partite servono perche' un dato valga per se stesso. Sotto questa soglia il
// valore del giocatore viene tirato verso la media del reparto, in proporzione a quante
// partite ha davvero giocato: con 1 partita conta per un sesto e per il resto vale la
// media, con 30 conta per l'86%.
//
// Nasce da un caso concreto (24/08/2026): Ironman-6-6 compariva in cima agli ESTERNI con
// UNA partita giocata li', sopra chi ci gioca da quaranta. Una partita buona non e' un
// rendimento, e' un episodio - ma senza correzione pesa esattamente quanto una carriera.
const CREDIBILITA = 5;

function credibilita(n){ return n / (n + CREDIBILITA); }

function versoLaMedia(valori, partite){
  const media = valori.reduce((t, v) => t + v, 0) / valori.length;
  return valori.map((v, i) => {
    const c = credibilita(partite[i]);
    return c * v + (1 - c) * media;
  });
}

function rankGroup(pool){
  if(pool.length === 0) return [];

  // Una metrica su cui tutti hanno lo stesso valore non distingue nessuno. Normalizzarla
  // darebbe 0.5 a testa, cioe' meta' del suo peso regalato a tutti: nei reparti dove
  // nessuno ha premi MOTM questo gonfiava ogni punteggio di 7.5 punti su 100, rendendo
  // i valori non confrontabili tra un reparto e l'altro. Qui invece la metrica viene
  // esclusa e il suo peso ridistribuito sulle altre, in proporzione.
  // Ogni metrica viene prima ridimensionata verso la media del reparto in base a quante
  // partite la sostengono. La classifica confronta cosi' quanto uno ha DIMOSTRATO, non
  // quanto e' andato bene una sera.
  const partite = pool.map(a => a.games);
  const METRICHE = [
    { chiave: "rating",  peso: 0.40, valori: versoLaMedia(pool.map(a => a.ratingAve), partite) },
    { chiave: "contrib", peso: 0.20, valori: versoLaMedia(pool.map(a => a.contrib), partite) },
    { chiave: "motm",    peso: 0.15, valori: versoLaMedia(pool.map(a => a.motmRate), partite) },
    { chiave: "win",     peso: 0.10, valori: versoLaMedia(pool.map(a => a.winRate), partite) },
    { chiave: "tech",    peso: 0.10, valori: versoLaMedia(pool.map(a => a.techEff), partite) },
  ];
  const disc = versoLaMedia(pool.map(a => a.redRate), partite);
  const haSpread = (v) => Math.max(...v) !== Math.min(...v);
  const attive = METRICHE.filter(m => haSpread(m.valori));
  const ignorate = METRICHE.filter(m => !haSpread(m.valori)).map(m => m.chiave);

  if(attive.length === 0){
    // Nessuna differenza tra i giocatori del reparto: qualsiasi punteggio sarebbe inventato.
    return pool.map(a => ({ ...a, score: 0, metricheIgnorate: ignorate, nonDistinguibili: true }))
               .sort((x, y) => y.games - x.games);
  }

  const pesoTotale = attive.reduce((t, m) => t + m.peso, 0);
  const norm = (v) => {
    const min = Math.min(...v), max = Math.max(...v);
    return v.map(x => (x - min) / (max - min));
  };
  const normalizzate = attive.map(m => ({ peso: m.peso / pesoTotale * 0.95, valori: norm(m.valori) }));
  const nDisc = haSpread(disc) ? norm(disc) : disc.map(() => 0);

  return pool.map((a, i) => ({ ...a,
    metricheIgnorate: ignorate,
    score: Math.max(0, Math.min(100, 100 * (
      normalizzate.reduce((t, m) => t + m.peso * m.valori[i], 0) - 0.05 * nDisc[i]
    ))),
  })).sort((x, y) => y.score - x.score);
}


function fmtDate(iso){
  if(!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString("it-IT", {day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit"});
}

const ROLE_LABELS = { forward: "Attacco", midfielder: "Centrocampo", defender: "Difesa", goalkeeper: "Portiere" };
function roleBadge(pos){
  const cls = ["forward","midfielder","defender","goalkeeper"].includes(pos) ? pos : "unknown";
  const label = ROLE_LABELS[pos] || pos || "-";
  return `<span class="role-badge ${cls}">${label}</span>`;
}

// ---- Indice di Forza: calcolo condiviso (usato dalla sezione dedicata E dalla card giocatore) ----
function computePowerScores(roster){
  if(!roster || roster.length === 0) return [];
  function normalize(values){
    const min = Math.min(...values), max = Math.max(...values);
    if(max === min) return values.map(() => 0.5);
    return values.map(v => (v - min) / (max - min));
  }
  const contrib = roster.map(r => r.games_played ? (r.goals + r.assists) / r.games_played : 0);
  const motmRate = roster.map(r => r.games_played ? r.man_of_the_match / r.games_played : 0);
  const techEff = roster.map(r => (r.pass_success_rate + r.tackle_success_rate + r.shot_success_rate) / 3);
  const redRate = roster.map(r => r.games_played ? r.red_cards / r.games_played : 0);

  const nRating = normalize(roster.map(r => r.rating_ave));
  const nContrib = normalize(contrib);
  const nMotm = normalize(motmRate);
  const nWin = normalize(roster.map(r => r.win_rate));
  const nTech = normalize(techEff);
  const nDisc = normalize(redRate);

  return roster.map((r, i) => {
    const score = Math.max(0, Math.min(100,
      100 * (
        0.40 * nRating[i] +
        0.20 * nContrib[i] +
        0.15 * nMotm[i] +
        0.10 * nWin[i] +
        0.10 * nTech[i] -
        0.05 * nDisc[i]
      )
    ));
    return {
      r,
      score,
      contrib: contrib[i],
      motmRate: motmRate[i] * 100,
      breakdown: { rating: nRating[i], contrib: nContrib[i], motm: nMotm[i], win: nWin[i], tech: nTech[i] },
    };
  });
}
const POWER_SCORES = computePowerScores(DATA.roster);
const POWER_SCORE_BY_NAME = new Map(POWER_SCORES.map(s => [s.r.player_name, s]));

// ---- Indice di Forza pesato (meccanismo tipo coefficiente UEFA) ----
// Il punteggio storico usa i totali di carriera: e' stabile ma reagisce
// lentissimamente. Quello di forma usa solo le ultime N partite archiviate.
// Il punteggio finale e' una media pesata dei due, cosi' una crescita o un calo
// recenti si vedono subito senza cancellare quello che uno ha costruito negli anni.
const FORM_MIN_APPS = 4;   // presenze minime nella finestra per avere un punteggio di forma
const FORM_WINDOWS = [30, 40, 0];
let formWindow = 30;
let formWeight = 0.5;      // 0 = solo storico, 1 = solo forma recente

// Scale di riferimento (min/max di ogni metrica sull'intera rosa, dai totali di
// carriera). Storico e forma DEVONO essere normalizzati sulla stessa scala:
// normalizzarli separatamente sui rispettivi gruppi produrrebbe un Δ falso,
// perche' misurerebbe la differenza tra i due gruppi e non il cambio di rendimento.
const POWER_RANGES = (function(roster){
  const mk = (arr) => ({ min: Math.min(...arr), max: Math.max(...arr) });
  return {
    rating:  mk(roster.map(r => r.rating_ave)),
    contrib: mk(roster.map(r => r.games_played ? (r.goals + r.assists) / r.games_played : 0)),
    motm:    mk(roster.map(r => r.games_played ? r.man_of_the_match / r.games_played : 0)),
    win:     mk(roster.map(r => r.win_rate)),
    tech:    mk(roster.map(r => (r.pass_success_rate + r.tackle_success_rate + r.shot_success_rate) / 3)),
    disc:    mk(roster.map(r => r.games_played ? r.red_cards / r.games_played : 0)),
  };
})(DATA.roster);

function normWith(v, range){
  if(range.max === range.min) return 0.5;
  return Math.max(0, Math.min(1, (v - range.min) / (range.max - range.min)));
}

// Punteggio calcolato SOLO sulle ultime N partite, con gli stessi pesi dello storico.
function computeFormScores(windowSize){
  const matches = [...(DATA.matches || [])];
  const scoped = windowSize > 0 ? matches.slice(0, windowSize) : matches;
  const winByMatch = new Map(scoped.map(m => [m.match_id, m.win ? 1 : 0]));
  const agg = new Map();

  scoped.forEach(m => {
    (DATA.matchPlayers[m.match_id] || []).forEach(p => {
      if(!agg.has(p.player_name)){
        agg.set(p.player_name, { games:0, rating:0, goals:0, assists:0, mom:0, win:0,
          passesMade:0, passAtt:0, tacklesMade:0, tackleAtt:0, shots:0, red:0 });
      }
      const a = agg.get(p.player_name);
      a.games++;
      a.rating      += p.rating || 0;
      a.goals       += p.goals || 0;
      a.assists     += p.assists || 0;
      a.mom         += p.mom || 0;
      a.win         += winByMatch.get(m.match_id) || 0;
      a.passesMade  += p.passes_made || 0;
      a.passAtt     += p.pass_attempts || 0;
      a.tacklesMade += p.tackles_made || 0;
      a.tackleAtt   += p.tackle_attempts || 0;
      a.shots       += p.shots || 0;
      a.red         += p.red_cards || 0;
    });
  });

  const pool = [...agg.entries()]
    .filter(([, a]) => a.games >= FORM_MIN_APPS)
    .map(([name, a]) => {
      const pass   = a.passAtt   > 0 ? (a.passesMade  / a.passAtt)   * 100 : 0;
      const tackle = a.tackleAtt > 0 ? (a.tacklesMade / a.tackleAtt) * 100 : 0;
      const shot   = a.shots     > 0 ? (a.goals       / a.shots)     * 100 : 0;
      return {
        name, games: a.games,
        ratingAve: a.rating / a.games,
        contrib:   (a.goals + a.assists) / a.games,
        motmRate:  a.mom / a.games,
        winRate:   (a.win / a.games) * 100,
        techEff:   (pass + tackle + shot) / 3,
        redRate:   a.red / a.games,
      };
    });

  if(pool.length === 0) return new Map();

  return new Map(pool.map(p => [p.name, {
    ...p,
    score: Math.max(0, Math.min(100, 100 * (
      0.40 * normWith(p.ratingAve, POWER_RANGES.rating) +
      0.20 * normWith(p.contrib,   POWER_RANGES.contrib) +
      0.15 * normWith(p.motmRate,  POWER_RANGES.motm) +
      0.10 * normWith(p.winRate,   POWER_RANGES.win) +
      0.10 * normWith(p.techEff,   POWER_RANGES.tech) -
      0.05 * normWith(p.redRate,   POWER_RANGES.disc)
    ))),
  }]));
}

// Fonde storico e forma. Chi non ha abbastanza partite recenti resta al 100% storico
// (segnalato con `formAvailable: false`), invece di essere penalizzato per assenza di dati.
function computeBlendedScores(windowSize, weight){
  const form = computeFormScores(windowSize);
  const punteggi = POWER_SCORES.map(s => {
    const f = form.get(s.r.player_name);
    const hasForm = !!f;
    // La forma vale in proporzione a quante partite la sostengono: quattro presenze non
    // possono spostare il giudizio quanto trenta. Il peso non speso torna allo storico.
    const cred = hasForm ? credibilita(f.games) : 0;
    const pesoForma = weight * cred;
    const blended = hasForm ? (1 - pesoForma) * s.score + pesoForma * f.score : s.score;
    return {
      ...s,
      historicScore: s.score,
      formScore: hasForm ? f.score : null,
      formGames: hasForm ? f.games : 0,
      formAvailable: hasForm,
      pesoFormaEffettivo: pesoForma,
      blendedScore: blended,
      delta: blended - s.score,
    };
  });

  // Chi non ha partite archiviate non viene valutato sulla forma: teneva il punteggio
  // storico PIENO e continuava a competere nella stessa classifica. A "100% forma"
  // eredes risultava terzo senza una sola partita in archivio (segnalato il 24/08/2026).
  //
  // Non e' che rendesse male: e' che la domanda "come sta adesso" per lui non ha
  // risposta. Metterlo terzo e' falso, metterlo ultimo lo sarebbe altrettanto. Viene
  // quindi tenuto fuori dall'ordinamento e mostrato a parte, dichiarando il perche'.
  const conForma = punteggi.filter(p => p.formAvailable);
  const senzaForma = punteggi.filter(p => !p.formAvailable);
  conForma.sort((a, b) => b.blendedScore - a.blendedScore);
  senzaForma.sort((a, b) => b.historicScore - a.historicScore);
  if(weight === 0) return [...punteggi].sort((a, b) => b.blendedScore - a.blendedScore);
  return [...conForma, ...senzaForma.map(p => ({ ...p, fuoriClassifica: true }))];
}

// ---- Cards ----
(function renderCards(){
  const l = DATA.latest || {};
  const gp = l.games_played || 0;
  const wins = l.wins || 0;
  const winPct = gp ? Math.round((wins/gp)*100) : 0;
  const cards = [
    ["Partite giocate", gp, ""],
    ["Bilancio", `${l.wins ?? 0}V ${l.ties ?? 0}P ${l.losses ?? 0}S`, ""],
    ["Win rate", winPct + "%", winPct >= 50 ? "win" : "loss"],
    ["Gol fatti/subiti", `${l.goals ?? 0} / ${l.goals_against ?? 0}`, ""],
    ["Skill rating", l.skill_rating ?? "-", ""],
    ["Promozioni/Retrocessioni", `${l.promotions ?? 0} / ${l.relegations ?? 0}`, ""],
    ["Serie in corso", (l.wstreak ?? 0) > 0 ? `${l.wstreak}V consecutive` : `${l.unbeatenstreak ?? 0} imbattuta`, ""],
    ["Partite playoff", l.games_played_playoff ?? 0, ""],
  ];
  const el = document.getElementById("cards");
  el.innerHTML = cards.map(([label, value, cls]) =>
    `<div class="card"><div class="label">${label}</div><div class="value ${cls}">${value}</div></div>`
  ).join("");
})();

// ---- Form strip ----
(function renderFormStrip(){
  const el = document.getElementById("formStrip");
  const matches = [...(DATA.matches || [])].reverse(); // cronologico
  if(matches.length === 0){
    el.innerHTML = '<span class="empty">Nessuna partita nel database ancora.</span>';
    return;
  }
  const chips = matches.map(m => {
    const outcome = m.win ? "W" : (m.tie ? "T" : "L");
    const title = `${fmtDate(m.played_at)} vs ${m.opponent_name || "?"} (${m.goals_for}-${m.goals_against})`;
    return `<div class="form-chip ${outcome}" title="${title}">${outcome}</div>`;
  }).join("");
  el.innerHTML = chips + `<span class="form-chip-info">${matches.length} partite tracciate, dalla più vecchia (sinistra) alla più recente (destra)</span>`;
})();

// ---- History chart ----
// I punti dello storico non sono equidistanti: ne viene salvato uno solo quando i dati
// cambiano davvero, quindi una notte di gioco produce un punto ogni venti minuti e una
// settimana di pausa nessuno. Su un asse temporale lineare le serate schiacciavano tutto
// il resto; le etichette restano percio' categoriche, un punto per rilevazione, e il
// filtro serve proprio a scegliere quanta storia guardare insieme.
(function renderHistoryChart(){
  const ctx = document.getElementById("chartHistory");
  const barraEl = document.getElementById("historyRange");
  const riepilogoEl = document.getElementById("historyRiepilogo");
  const hist = DATA.history || [];
  if(hist.length === 0){
    ctx.parentElement.innerHTML = '<div class="empty">Ancora nessuno storico: servono più aggiornamenti nel tempo per vedere il grafico.</div>';
    if(barraEl) barraEl.remove();
    return;
  }

  const PERIODI = [
    { id: "24h",  label: "24 ore",     ore: 24 },
    { id: "7g",   label: "7 giorni",   ore: 24 * 7 },
    { id: "30g",  label: "30 giorni",  ore: 24 * 30 },
    { id: "tutto",label: "Tutto",      ore: null },
  ];

  const ora = Date.now();
  const conTempo = hist.map(h => ({ ...h, t: new Date(h.fetched_at).getTime() }))
                       .filter(h => !isNaN(h.t));

  function puntiDi(periodo){
    if(periodo.ore === null) return conTempo;
    const da = ora - periodo.ore * 3600 * 1000;
    return conTempo.filter(h => h.t >= da);
  }

  // Un periodo con meno di due punti non disegna una linea: il bottone resta visibile ma
  // spento, cosi' si capisce che quel periodo esiste e semplicemente non ha ancora dati,
  // invece di sembrare un grafico rotto.
  const disponibili = PERIODI.filter(p => puntiDi(p).length >= 2);
  let scelto = disponibili.find(p => p.id === "30g") || disponibili[disponibili.length - 1]
            || PERIODI[PERIODI.length - 1];

  let grafico = null;

  function disegna(){
    const punti = puntiDi(scelto);
    if(grafico) grafico.destroy();
    grafico = new Chart(ctx, {
      type: "line",
      data: {
        labels: punti.map(h => fmtDate(h.fetched_at)),
        datasets: [{
          label: "Skill rating",
          data: punti.map(h => h.skill_rating),
          borderColor: "#d5203a",
          backgroundColor: "rgba(213,32,58,.18)",
          tension: 0.25,
          fill: true,
          pointRadius: punti.length > 40 ? 0 : 3,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#b99aa0", maxTicksLimit: 8 }, grid: { color: "#4a232a" } },
          y: { ticks: { color: "#b99aa0" }, grid: { color: "#4a232a" } },
        }
      }
    });

    const valori = punti.map(h => h.skill_rating).filter(v => v != null);
    if(valori.length === 0){ riepilogoEl.textContent = ""; return; }
    const primo = valori[0], ultimo = valori[valori.length - 1];
    const delta = ultimo - primo;
    const segno = delta > 0 ? "+" : "";
    const colore = delta > 0 ? "var(--ok,#4ade80)" : (delta < 0 ? "var(--accent)" : "var(--muted)");
    riepilogoEl.innerHTML =
      `Nel periodo selezionato: da <strong style="color:var(--text);">${primo}</strong> a ` +
      `<strong style="color:var(--text);">${ultimo}</strong>, ` +
      `<strong style="color:${colore};">${segno}${delta}</strong>. ` +
      `Minimo ${Math.min(...valori)}, massimo ${Math.max(...valori)}, su ${valori.length} rilevazioni.`;
  }

  function disegnaBarra(){
    barraEl.innerHTML = PERIODI.map(p => {
      const attivo = p.id === scelto.id;
      const vuoto = !disponibili.some(d => d.id === p.id);
      return `<span class="filter-btn ${attivo ? "active" : ""}" data-id="${p.id}"
                    ${vuoto ? 'style="opacity:.35; cursor:default;"' : ""}
                    title="${vuoto ? "Non ci sono ancora abbastanza rilevazioni in questo periodo" : ""}">${p.label}</span>`;
    }).join("");
    barraEl.querySelectorAll(".filter-btn").forEach(b => {
      b.addEventListener("click", () => {
        const p = PERIODI.find(x => x.id === b.dataset.id);
        if(!p || !disponibili.some(d => d.id === p.id)) return;
        scelto = p;
        disegnaBarra();
        disegna();
      });
    });
  }

  disegnaBarra();
  disegna();
})();

// ---- Finishes per division chart ----
(function renderFinishesChart(){
  const ctx = document.getElementById("chartFinishes");
  const l = DATA.latest || {};
  const labels = ["Div 1","Div 2","Div 3","Div 4","Div 5","Div 6"];
  const values = [
    l.finishes_div1_group1, l.finishes_div2_group1, l.finishes_div3_group1,
    l.finishes_div4_group1, l.finishes_div5_group1, l.finishes_div6_group1,
  ].map(v => v || 0);
  if(values.every(v => v === 0)){
    ctx.parentElement.innerHTML = '<div class="empty">Nessun piazzamento registrato ancora per questo club.</div>';
    return;
  }
  new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Primi posti", data: values, backgroundColor: "#d5203a", borderRadius: 4 }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#b99aa0" }, grid: { display: false } },
        y: { ticks: { color: "#b99aa0", precision: 0 }, grid: { color: "#4a232a" } },
      }
    }
  });
})();

function sparkline(trend){
  if(!trend || trend.length === 0) return "-";
  const max = Math.max(...trend, 1);
  return `<div class="sparkline">${trend.map(v =>
    `<div class="bar ${v===0?"zero":""}" style="height:${Math.max(2, Math.round((v/max)*20))}px" title="${v} gol"></div>`
  ).join("")}</div>`;
}

// ---- Roster table ----
let rosterSort = { key: "goals", dir: -1 };
function renderRoster(){
  const filterVal = document.getElementById("rosterFilter").value.toLowerCase();
  let rows = (DATA.roster || []).filter(r =>
    (r.player_name||"").toLowerCase().includes(filterVal) ||
    (r.pro_name||"").toLowerCase().includes(filterVal)
  );
  rows.sort((a,b) => {
    const av = a[rosterSort.key], bv = b[rosterSort.key];
    if (typeof av === "string") return av.localeCompare(bv) * rosterSort.dir;
    return ((av||0) - (bv||0)) * rosterSort.dir;
  });
  const tbody = document.querySelector("#rosterTable tbody");
  if(rows.length === 0){
    tbody.innerHTML = `<tr><td colspan="11" class="empty">Nessun giocatore trovato</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td data-label="Giocatore"><span class="player-link" data-player="${r.player_name}">${r.player_name}</span>${r.pro_name && r.pro_name !== r.player_name ? ` <span class="pos-badge">(${r.pro_name})</span>` : ""}</td>
      <td data-label="Ruolo">${gruppoBadge(r.gruppo, r.gruppo_da_assegnare)}</td>
      <td data-label="OVR">${r.pro_overall || "-"}</td>
      <td data-label="PG">${r.games_played}</td>
      <td data-label="Win%">${r.win_rate}%</td>
      <td data-label="Gol">${r.goals}</td>
      <td data-label="Assist">${r.assists}</td>
      <td data-label="Media">${r.rating_ave}</td>
      <td data-label="MOTM">${r.man_of_the_match}</td>
      <td data-label="Rossi">${r.red_cards}</td>
      <td data-label="Forma">${sparkline((r.prev_goals_trend||[]).slice().reverse())}</td>
    </tr>
  `).join("");
  updateQuickFilterHighlight();
}
function updateQuickFilterHighlight(){
  document.querySelectorAll('#rosterQuickFilters .filter-btn').forEach(btn => {
    btn.classList.toggle("active", btn.dataset.key === rosterSort.key);
  });
}
document.getElementById("rosterFilter").addEventListener("input", renderRoster);
document.querySelectorAll('#rosterTable th').forEach(th => {
  th.addEventListener("click", () => {
    const key = th.dataset.key;
    if(!key) return;
    rosterSort.dir = (rosterSort.key === key) ? -rosterSort.dir : -1;
    rosterSort.key = key;
    renderRoster();
  });
});
document.querySelectorAll('#rosterQuickFilters .filter-btn').forEach(btn => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.key;
    rosterSort.dir = (rosterSort.key === key) ? -rosterSort.dir : -1;
    rosterSort.key = key;
    renderRoster();
  });
});
renderRoster();

// ---- Top scorers chart ----
(function renderScorersChart(){
  const ctx = document.getElementById("chartScorers");
  const top = [...(DATA.roster || [])].sort((a,b) => b.goals - a.goals).slice(0, 8);
  if(top.length === 0){
    ctx.parentElement.innerHTML = '<div class="empty">Nessun dato disponibile</div>';
    return;
  }
  new Chart(ctx, {
    type: "bar",
    data: {
      labels: top.map(p => p.player_name),
      datasets: [{
        label: "Gol",
        data: top.map(p => p.goals),
        backgroundColor: "#f0b90b",
        borderRadius: 4,
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#b99aa0" }, grid: { color: "#4a232a" } },
        y: { ticks: { color: "#b99aa0" }, grid: { display: false } },
      }
    }
  });
})();

// ---- Definizione di tutte le statistiche disponibili (usata da Premi e da Classifiche) ----
const MIN_GAMES_RATE = LEADERBOARD_MIN_GAMES;
const STAT_DEFS = [
  { key: "goals", label: "Gol fatti", icon: "⚽", unit: "gol", minGames: 0, awardTitle: "Capocannoniere" },
  { key: "assists", label: "Assist fatti", icon: "🎯", unit: "assist", minGames: 0, awardTitle: "Miglior assistman" },
  { key: "goals_plus_assists", label: "Gol + assist", icon: "🔥", unit: "g+a", minGames: 0, awardTitle: "Miglior contributo offensivo", compute: r => r.goals + r.assists },
  { key: "contribution_pg", label: "Gol+assist a partita", icon: "🎒", unit: "a partita", minGames: MIN_GAMES_RATE, awardTitle: "Il carry della squadra", compute: r => r.games_played ? (r.goals + r.assists) / r.games_played : 0, decimals: 2 },
  { key: "games_played", label: "Presenze", icon: "🧤", unit: "partite", minGames: 0, awardTitle: "Più presenze" },
  { key: "win_rate", label: "% Vittorie", icon: "🏆", unit: "%", minGames: MIN_GAMES_RATE, awardTitle: "Miglior % vittorie" },
  { key: "rating_ave", label: "Media voto", icon: "⭐", unit: "", minGames: MIN_GAMES_RATE, awardTitle: "Media voto migliore", decimals: 2 },
  { key: "man_of_the_match", label: "Uomo delle partite (MOTM)", icon: "🏅", unit: "MOTM", minGames: 0, awardTitle: "Uomo delle partite" },
  { key: "red_cards", label: "Cartellini rossi", icon: "🟥", unit: "rossi", minGames: 0, awardTitle: "Re dei cartellini" },
  { key: "pass_success_rate", label: "% Passaggi riusciti", icon: "📡", unit: "%", minGames: MIN_GAMES_RATE, awardTitle: "Miglior % passaggi" },
  { key: "passes_made", label: "Passaggi totali", icon: "🔁", unit: "passaggi", minGames: 0, awardTitle: "Più passaggi effettuati" },
  { key: "tackle_success_rate", label: "% Contrasti vinti", icon: "🛡️", unit: "%", minGames: MIN_GAMES_RATE, awardTitle: "Miglior % contrasti" },
  { key: "tackles_made", label: "Contrasti totali", icon: "⚔️", unit: "contrasti", minGames: 0, awardTitle: "Più contrasti vinti" },
  { key: "shot_success_rate", label: "% Precisione tiro", icon: "🎯", unit: "%", minGames: MIN_GAMES_RATE, awardTitle: "Miglior % precisione tiro" },
  { key: "clean_sheets_def", label: "Clean sheet (difensore)", icon: "🧱", unit: "clean sheet", minGames: 0, awardTitle: "Miglior muro difensivo" },
  { key: "clean_sheets_gk", label: "Clean sheet (portiere)", icon: "🥅", unit: "clean sheet", minGames: 0, awardTitle: "Miglior portiere" },
  { key: "pro_overall", label: "Overall (OVR)", icon: "💪", unit: "OVR", minGames: 0, awardTitle: "Overall più alto" },
];
function statValue(def, r){
  return def.compute ? def.compute(r) : (r[def.key] ?? 0);
}
function fmtStatValue(def, v){
  if(def.decimals != null) return v.toFixed(def.decimals);
  return Math.round(v * 100) / 100;
}

// I premi della rosa e le stats divertenti sono stati rimossi il 23/08/2026: erano
// intrattenimento, e il progetto ha preso la direzione opposta - descrivere come si
// gioca invece di premiare chi sta davanti. Le sezioni analitiche che le sostituiscono
// sono "Vittorie e sconfitte" e "Scheda osservatore".

// ---- Novita: differenza tra gli ultimi due snapshot ----
// Ogni run del task salva uno snapshot dei totali di carriera. La differenza
// tra gli ultimi due dice esattamente cosa e' successo nel frattempo, senza
// dipendere dall'archivio parziale delle singole partite.
(function renderNews(){
  const el = document.getElementById("newsBody");
  const hist = DATA.history || [];
  if(hist.length < 2){
    el.innerHTML = '<div class="panel"><div class="empty">Serve almeno un secondo aggiornamento per confrontare i dati. Torna domani.</div></div>';
    return;
  }
  const cur = hist[hist.length - 1], prev = hist[hist.length - 2];
  const d = (k) => (Number(cur[k]) || 0) - (Number(prev[k]) || 0);

  const dGames = d("games_played"), dSr = d("skill_rating");
  const dW = d("wins"), dL = d("losses"), dT = d("ties");
  const dGf = d("goals"), dGa = d("goals_against");

  if(dGames === 0){
    el.innerHTML = `<div class="panel"><div class="empty">
      Nessuna partita nuova tra il ${fmtDate(prev.fetched_at)} e il ${fmtDate(cur.fetched_at)}.
    </div></div>`;
    return;
  }

  const sign = (n) => (n > 0 ? "+" + n : String(n));
  const cls  = (n) => (n > 0 ? "up" : n < 0 ? "down" : "flat");
  const cards = [
    { k: "Partite giocate", v: sign(dGames), c: "flat", s: `${dW}V · ${dT}N · ${dL}P` },
    { k: "Skill rating",    v: sign(dSr),    c: cls(dSr), s: `ora ${cur.skill_rating}` },
    { k: "Gol fatti",       v: sign(dGf),    c: "up",   s: dGames ? `${(dGf/dGames).toFixed(1)} a partita` : "" },
    { k: "Gol subiti",      v: sign(dGa),    c: "down", s: dGames ? `${(dGa/dGames).toFixed(1)} a partita` : "" },
  ];

  // Chi si e' mosso di piu': differenza sui totali per giocatore.
  const mh = DATA.memberHistory || [];
  const snaps = [...new Set(mh.map(r => r.fetched_at))].sort();
  let moversHtml = "";
  if(snaps.length >= 2){
    const last = snaps[snaps.length - 1], before = snaps[snaps.length - 2];
    const mapOf = (snap) => new Map(mh.filter(r => r.fetched_at === snap).map(r => [r.player_name, r]));
    const a = mapOf(before), b = mapOf(last);
    const movers = [];
    b.forEach((now, name) => {
      const was = a.get(name);
      if(!was) return;
      const dg = (now.games_played||0) - (was.games_played||0);
      if(dg <= 0) return;
      movers.push({
        name, games: dg,
        goals:   (now.goals||0)   - (was.goals||0),
        assists: (now.assists||0) - (was.assists||0),
        mom:     (now.man_of_the_match||0) - (was.man_of_the_match||0),
      });
    });
    movers.sort((x,y) => (y.goals + y.assists) - (x.goals + x.assists) || y.games - x.games);
    if(movers.length){
      moversHtml = `
        <div class="news-movers">${movers.slice(0, 8).map(m => `
          <div class="mover"><b>${m.name}</b> — ${m.games} pt
            ${m.goals   ? ` · <span class="mv">${m.goals} gol</span>` : ""}
            ${m.assists ? ` · <span class="mv">${m.assists} assist</span>` : ""}
            ${m.mom     ? ` · ⭐${m.mom}` : ""}
          </div>`).join("")}</div>`;
    }
  }

  el.innerHTML = `
    <div class="news-grid">
      ${cards.map(c => `
        <div class="news-card">
          <div class="nk">${c.k}</div>
          <div class="nv ${c.c}">${c.v}</div>
          <div class="ns">${c.s}</div>
        </div>`).join("")}
    </div>
    ${moversHtml}
    <div class="empty" style="text-align:left; padding:10px 0 0;">
      Confronto tra ${fmtDate(prev.fetched_at)} e ${fmtDate(cur.fetched_at)}.
    </div>`;
})();

// ---- Crescita nel tempo: serie storiche per giocatore ----
const GROWTH_STATS = [
  { key: "goals",               label: "Gol",              color: "#d5203a" },
  { key: "assists",             label: "Assist",           color: "#f0b90b" },
  { key: "games_played",        label: "Partite giocate",  color: "#33c17a" },
  { key: "man_of_the_match",    label: "MOTM",             color: "#ffd966" },
  { key: "rating_ave",          label: "Media voto",       color: "#e5566d", noDelta: true },
  { key: "win_rate",            label: "Win %",            color: "#7ec8e3", noDelta: true },
  { key: "pass_success_rate",   label: "% Passaggi",       color: "#b39ddb", noDelta: true },
  { key: "shot_success_rate",   label: "% Tiro",           color: "#ffab91", noDelta: true },
];
let growthChart = null;

(function initGrowth(){
  const wrap    = document.getElementById("growthWrap");
  const selP    = document.getElementById("growthPlayer");
  const selS    = document.getElementById("growthStat");
  const modeBtn = document.getElementById("growthMode");
  const summary = document.getElementById("growthSummary");
  const mh = DATA.memberHistory || [];
  const snaps = [...new Set(mh.map(r => r.fetched_at))].sort();

  if(snaps.length < 2){
    wrap.innerHTML = '<div class="empty">Serve almeno un secondo aggiornamento per disegnare una curva. Il grafico si arricchisce da solo ogni giorno.</div>';
    selP.style.display = selS.style.display = modeBtn.style.display = "none";
    return;
  }

  // Solo giocatori presenti nel roster filtrato, ordinati alfabeticamente.
  const valid = new Set((DATA.roster || []).map(r => r.player_name));
  const players = [...new Set(mh.map(r => r.player_name))]
    .filter(n => valid.has(n)).sort((a,b) => a.localeCompare(b));
  if(players.length === 0){
    wrap.innerHTML = '<div class="empty">Nessun giocatore con abbastanza partite da tracciare.</div>';
    return;
  }

  selP.innerHTML = players.map(n => `<option value="${n}">${n}</option>`).join("");
  selS.innerHTML = GROWTH_STATS.map(s => `<option value="${s.key}">${s.label}</option>`).join("");

  // Preselezione: chi e' cresciuto di piu' in gol nel periodo tracciato, cosi'
  // la curva mostrata all'apertura non e' una riga piatta.
  const growthByPlayer = players.map(n => {
    const rows = mh.filter(r => r.player_name === n).sort((a,b) => a.fetched_at.localeCompare(b.fetched_at));
    if(rows.length < 2) return { n, g: 0 };
    return { n, g: (rows[rows.length-1].goals || 0) - (rows[0].goals || 0) };
  }).sort((a,b) => b.g - a.g);
  if(growthByPlayer.length && growthByPlayer[0].g > 0) selP.value = growthByPlayer[0].n;

  function draw(){
    const name = selP.value, statKey = selS.value;
    const stat = GROWTH_STATS.find(s => s.key === statKey);
    const delta = modeBtn.dataset.mode === "delta" && !stat.noDelta;
    const rows = mh.filter(r => r.player_name === name).sort((a,b) => a.fetched_at.localeCompare(b.fetched_at));

    let labels = rows.map(r => fmtDate(r.fetched_at));
    let values = rows.map(r => Number(r[statKey]) || 0);
    if(delta){
      labels = labels.slice(1);
      values = values.slice(1).map((v,i) => v - (Number(rows[i][statKey]) || 0));
    }

    if(growthChart) growthChart.destroy();
    growthChart = new Chart(document.getElementById("growthChart"), {
      type: delta ? "bar" : "line",
      data: { labels, datasets: [{
        label: stat.label,
        data: values,
        borderColor: stat.color,
        backgroundColor: delta ? stat.color : stat.color + "2e",
        borderRadius: delta ? 4 : 0,
        tension: 0.25,
        fill: !delta,
      }]},
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#b99aa0" }, grid: { color: "#4a232a" } },
          y: { beginAtZero: delta, ticks: { color: "#b99aa0" }, grid: { color: "#4a232a" } },
        }
      }
    });

    const first = Number(rows[0][statKey]) || 0;
    const last  = Number(rows[rows.length - 1][statKey]) || 0;
    const diff  = last - first;
    const diffStr = stat.noDelta ? diff.toFixed(2) : String(Math.round(diff));
    const arrow = diff > 0 ? '<span class="trend-up">▲</span>' : diff < 0 ? '<span class="trend-down">▼</span>' : "—";
    summary.innerHTML = `<div class="empty" style="text-align:left; padding:0;">
      <strong>${name}</strong> — ${stat.label}: da ${stat.noDelta ? first.toFixed(2) : first} a
      ${stat.noDelta ? last.toFixed(2) : last} ${arrow} ${diff > 0 ? "+" : ""}${diffStr}
      su ${rows.length} aggiornamenti (dal ${fmtDate(rows[0].fetched_at)}).
    </div>`;
  }

  selP.addEventListener("change", draw);
  selS.addEventListener("change", () => {
    const stat = GROWTH_STATS.find(s => s.key === selS.value);
    // Le percentuali e le medie non hanno senso come "guadagno per aggiornamento".
    if(stat.noDelta && modeBtn.dataset.mode === "delta"){
      modeBtn.dataset.mode = "total";
      modeBtn.textContent = "Vista: totali";
    }
    modeBtn.style.opacity = stat.noDelta ? ".4" : "1";
    modeBtn.style.pointerEvents = stat.noDelta ? "none" : "auto";
    draw();
  });
  modeBtn.addEventListener("click", () => {
    const delta = modeBtn.dataset.mode === "delta";
    modeBtn.dataset.mode = delta ? "total" : "delta";
    modeBtn.textContent = delta ? "Vista: totali" : "Vista: guadagno per aggiornamento";
    draw();
  });

  draw();
})();

// ---- Share card: immagine PNG generata su canvas, senza librerie esterne ----
(function initShare(){
  const canvas = document.getElementById("shareCanvas");
  if(!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const club = DATA.club || {};
  const l = DATA.latest || {};
  const clubName = (club.name || "Club").toUpperCase();

  function roundRect(x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCard(){
    // sfondo
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#1d0c10"); g.addColorStop(1, "#3a1119");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#f0b90b"; ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, W - 8, H - 8);

    // intestazione
    ctx.textAlign = "center";
    ctx.fillStyle = "#f5ece4";
    ctx.font = "bold 76px -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText(clubName, W/2, 120);
    ctx.fillStyle = "#b99aa0";
    ctx.font = "30px -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText(`Divisione ${l.best_division || "-"} · ${(club.platform || "").toUpperCase()}`, W/2, 168);

    // skill rating in evidenza
    ctx.fillStyle = "rgba(240,185,11,.10)";
    roundRect(70, 210, W - 140, 190, 20); ctx.fill();
    ctx.strokeStyle = "rgba(240,185,11,.45)"; ctx.lineWidth = 2;
    roundRect(70, 210, W - 140, 190, 20); ctx.stroke();
    ctx.fillStyle = "#f0b90b";
    ctx.font = "bold 110px -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText(String(l.skill_rating || "-"), W/2, 335);
    ctx.fillStyle = "#b99aa0";
    ctx.font = "26px -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText("SKILL RATING", W/2, 378);

    // record W/N/P
    const stats = [
      ["VITTORIE", l.wins,   "#33c17a"],
      ["PAREGGI",  l.ties,   "#e0b23f"],
      ["SCONFITTE",l.losses, "#e5566d"],
    ];
    stats.forEach(([k, v, col], i) => {
      const x = 70 + i * ((W - 140) / 3) + ((W - 140) / 6);
      ctx.fillStyle = col;
      ctx.font = "bold 62px -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillText(String(v ?? "-"), x, 480);
      ctx.fillStyle = "#b99aa0";
      ctx.font = "22px -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillText(k, x, 515);
    });

    // forma recente: ultime 5 partite dal database
    const recent = [...(DATA.matches || [])].slice(0, 5).reverse();
    if(recent.length){
      ctx.fillStyle = "#b99aa0";
      ctx.font = "24px -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillText("FORMA RECENTE", W/2, 585);
      const bw = 90, gap = 18;
      const totalW = recent.length * bw + (recent.length - 1) * gap;
      recent.forEach((m, i) => {
        const x = (W - totalW)/2 + i * (bw + gap);
        const isW = m.win, isT = m.tie;
        ctx.fillStyle = isW ? "rgba(51,193,122,.22)" : isT ? "rgba(224,178,63,.22)" : "rgba(229,86,109,.22)";
        roundRect(x, 610, bw, 78, 12); ctx.fill();
        ctx.fillStyle = isW ? "#33c17a" : isT ? "#e0b23f" : "#e5566d";
        ctx.font = "bold 34px -apple-system, Segoe UI, Roboto, sans-serif";
        ctx.fillText(`${m.goals_for}-${m.goals_against}`, x + bw/2, 658);
      });
    }

    // top 3 marcatori di sempre
    const top = [...(DATA.roster || [])].sort((a,b) => (b.goals||0) - (a.goals||0)).slice(0, 3);
    if(top.length){
      ctx.fillStyle = "#b99aa0";
      ctx.font = "24px -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillText("TOP MARCATORI", W/2, 750);
      const medals = ["🥇","🥈","🥉"];
      top.forEach((p, i) => {
        const y = 800 + i * 52;
        ctx.textAlign = "left";
        ctx.fillStyle = "#f5ece4";
        ctx.font = "bold 34px -apple-system, Segoe UI, Roboto, sans-serif";
        ctx.fillText(`${medals[i]}  ${p.player_name}`, 150, y);
        ctx.textAlign = "right";
        ctx.fillStyle = "#f0b90b";
        ctx.fillText(`${p.goals} gol`, W - 150, y);
        ctx.textAlign = "center";
      });
    }

    // piede
    ctx.fillStyle = "#8a6c72";
    ctx.font = "22px -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText(location.host + location.pathname, W/2, H - 40);
  }

  drawCard();

  const msg = document.getElementById("shareMsg");
  const flash = (t) => { msg.textContent = t; setTimeout(() => { msg.textContent = ""; }, 3000); };
  const fileName = `${(club.name || "club").toLowerCase().replace(/\s+/g,"-")}-${new Date().toISOString().slice(0,10)}.png`;

  document.getElementById("shareDownloadBtn").addEventListener("click", () => {
    canvas.toBlob(blob => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      flash("Immagine scaricata.");
    }, "image/png");
  });

  // Condivisione nativa (WhatsApp, Telegram...): solo su browser che la supportano.
  const nativeBtn = document.getElementById("shareNativeBtn");
  if(navigator.canShare && navigator.canShare({ files: [new File([""], "t.png", {type:"image/png"})] })){
    nativeBtn.style.display = "";
    nativeBtn.addEventListener("click", () => {
      canvas.toBlob(async blob => {
        const file = new File([blob], fileName, { type: "image/png" });
        try{ await navigator.share({ files: [file], title: clubName, text: `${clubName} — skill rating ${l.skill_rating}` }); }
        catch(e){ /* condivisione annullata dall'utente */ }
      }, "image/png");
    });
  }

  document.getElementById("shareCopyBtn").addEventListener("click", async () => {
    const url = location.origin + location.pathname;
    try{ await navigator.clipboard.writeText(url); flash("Link copiato: " + url); }
    catch(e){ flash("Copia non riuscita, il link è " + url); }
  });
})();

// ---- Classifiche complete (navigabili, tutte le statistiche) ----
(function renderLeaderboard(){
  const selStat = document.getElementById("lbStat");
  const dirBtn = document.getElementById("lbDirToggle");
  const tbody = document.querySelector("#lbTable tbody");
  const roster = DATA.roster || [];
  if(roster.length === 0){
    selStat.parentElement.parentElement.innerHTML = `<div class="empty">Nessun giocatore con almeno ${LEADERBOARD_MIN_GAMES} partite ancora.</div>`;
    return;
  }
  selStat.innerHTML = STAT_DEFS.map(def => `<option value="${def.key}">${def.icon} ${def.label}</option>`).join("");

  function draw(){
    const def = STAT_DEFS.find(d => d.key === selStat.value) || STAT_DEFS[0];
    const dir = +dirBtn.dataset.dir;
    dirBtn.textContent = "Ordine: " + (dir === -1 ? "dal più alto" : "dal più basso");
    const rows = [...roster]
      .map(r => ({ r, v: statValue(def, r) }))
      .sort((a,b) => (b.v - a.v) * dir * -1);
    tbody.innerHTML = rows.map(({r, v}, i) => {
      const rankCls = i===0 ? "g1" : i===1 ? "g2" : i===2 ? "g3" : "";
      return `
        <tr>
          <td data-label="#"><span class="lb-rank ${rankCls}">#${i+1}</span></td>
          <td data-label="Giocatore"><span class="player-link" data-player="${r.player_name}">${r.player_name}</span></td>
          <td data-label="Ruolo">${gruppoBadge(r.gruppo, r.gruppo_da_assegnare)}</td>
          <td data-label="Valore" class="lb-value">${fmtStatValue(def, v)} ${def.unit}</td>
          <td data-label="Partite">${r.games_played}</td>
        </tr>
      `;
    }).join("");
  }
  selStat.addEventListener("change", draw);
  dirBtn.addEventListener("click", () => {
    dirBtn.dataset.dir = (+dirBtn.dataset.dir) * -1;
    draw();
  });
  draw();
})();

// ---- Indice di Forza (power ranking) ----
(function renderPowerRanking(){
  const podiumEl = document.getElementById("powerPodium");
  const roleFiltersEl = document.getElementById("powerRoleFilters");
  const tbody = document.querySelector("#powerTable tbody");
  const roster = DATA.roster || [];
  if(roster.length === 0){
    podiumEl.innerHTML = "";
    tbody.innerHTML = `<tr><td colspan="11" class="empty">Nessun giocatore con almeno ${LEADERBOARD_MIN_GAMES} partite ancora.</td></tr>`;
    return;
  }

  const winEl    = document.getElementById("formWindowFilters");
  const weightEl = document.getElementById("formWeightFilters");
  const covEl    = document.getElementById("formCoverage");
  let activeRole = "Tutti";
  let scored = [];

  const WEIGHT_OPTS = [
    { v: 0,   label: "100% storico" },
    { v: 0.5, label: "50/50" },
    { v: 1,   label: "100% forma" },
  ];
  const winLabel = (w) => (w === 0 ? "Tutte" : "Ultime " + w);

  function topFactor(s){
    const labels = { rating: "media voto alta", contrib: "tanti gol+assist a partita", motm: "spesso migliore in campo", win: "grande % vittorie", tech: "solidissimo tecnicamente" };
    const best = Object.entries(s.breakdown).sort((a,b) => b[1]-a[1])[0][0];
    return labels[best];
  }

  function deltaCell(s){
    if(!s.formAvailable) return '<span class="trend-flat" title="Poche partite recenti">solo storico</span>';
    const d = s.delta;
    if(Math.abs(d) < 0.05) return '<span class="trend-flat">—</span>';
    return d > 0
      ? `<span class="trend-up">▲ +${d.toFixed(1)}</span>`
      : `<span class="trend-down">▼ ${d.toFixed(1)}</span>`;
  }

  function renderControls(){
    winEl.innerHTML = FORM_WINDOWS.map(w =>
      `<span class="filter-btn ${w === formWindow ? "active" : ""}" data-win="${w}">${winLabel(w)}</span>`).join("");
    weightEl.innerHTML = WEIGHT_OPTS.map(o =>
      `<span class="filter-btn ${o.v === formWeight ? "active" : ""}" data-w="${o.v}">${o.label}</span>`).join("");
    winEl.querySelectorAll(".filter-btn").forEach(b => b.addEventListener("click", () => {
      formWindow = Number(b.dataset.win); recompute();
    }));
    weightEl.querySelectorAll(".filter-btn").forEach(b => b.addEventListener("click", () => {
      formWeight = Number(b.dataset.w); recompute();
    }));
  }

  function renderPodium(){
    podiumEl.innerHTML = scored.slice(0, 3).map((s, i) => `
      <div class="power-card rank${i+1}">
        <div class="medal">${i===0?"🥇":i===1?"🥈":"🥉"}</div>
        <div class="pname player-link" data-player="${s.r.player_name}">${s.r.player_name}</div>
        <div class="pscore">${s.blendedScore.toFixed(1)}</div>
        <div class="power-bar-track"><div class="power-bar-fill" style="width:${s.blendedScore}%"></div></div>
        <div class="pwhy">${GROUP_LABELS[s.r.gruppo] || "-"} · ${topFactor(s)}</div>
      </div>
    `).join("");
  }

  function renderCoverage(){
    const total = (DATA.matches || []).length;
    const used = formWindow > 0 ? Math.min(formWindow, total) : total;
    const withForm = scored.filter(s => s.formAvailable).length;
    covEl.innerHTML = formWeight === 0
      ? `Vista storica pura: la forma recente non incide sul punteggio.`
      : `Forma calcolata su <strong>${used} partite</strong> archiviate (${withForm} giocatori con almeno ${FORM_MIN_APPS} presenze).
         Peso applicato: ${Math.round((1-formWeight)*100)}% storico + ${Math.round(formWeight*100)}% forma.`;
  }

  function renderRoleFilters(){
    const presenti = new Set(roster.map(r => r.gruppo).filter(Boolean));
    const roles = ["Tutti", ...GROUP_ORDER.filter(g => presenti.has(g))];
    roleFiltersEl.innerHTML = roles.map(role =>
      `<span class="filter-btn ${role===activeRole?"active":""}" data-role="${role}">${GROUP_LABELS[role] || role}</span>`).join("");
    roleFiltersEl.querySelectorAll(".filter-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        activeRole = btn.dataset.role;
        roleFiltersEl.querySelectorAll(".filter-btn").forEach(b => b.classList.toggle("active", b === btn));
        draw();
      });
    });
  }

  function draw(){
    const rows = scored.filter(s => activeRole === "Tutti" || s.r.gruppo === activeRole);
    if(rows.length === 0){
      tbody.innerHTML = `<tr><td colspan="11" class="empty">Nessun giocatore per questo ruolo.</td></tr>`;
      return;
    }
    // Chi non ha dati recenti sta sotto la classifica, non dentro: senza posizione e con
    // il motivo scritto. Numerarlo lo farebbe sembrare piu' forte o piu' debole di altri
    // quando in realta' non e' stato misurato.
    let posizione = 0;
    tbody.innerHTML = rows.map((s) => {
      if(s.fuoriClassifica){
        return `
        <tr style="opacity:.6;">
          <td data-label="#"><span class="opp-tag" title="Nessuna partita archiviata nella finestra scelta">—</span></td>
          <td data-label="Giocatore"><span class="player-link" data-player="${s.r.player_name}">${s.r.player_name}</span></td>
          <td data-label="Ruolo">${gruppoBadge(s.r.gruppo, s.r.gruppo_da_assegnare)}</td>
          <td data-label="Indice" class="lb-value" colspan="2" style="font-size:12px; color:var(--muted);">
            non valutabile sulla forma: nessuna partita archiviata</td>
          <td data-label="Storico" class="career-cell">${s.historicScore.toFixed(1)}</td>
          <td data-label="Forma" class="career-cell">-</td>
          <td data-label="Media">${s.r.rating_ave}</td>
          <td data-label="G+A/partita">${s.contrib.toFixed(2)}</td>
          <td data-label="MOTM%">${s.motmRate.toFixed(0)}%</td>
          <td data-label="Win%">${s.r.win_rate}%</td>
        </tr>`;
      }
      const i = posizione++;
      const rankCls = i===0 ? "g1" : i===1 ? "g2" : i===2 ? "g3" : "";
      return `
        <tr>
          <td data-label="#"><span class="lb-rank ${rankCls}">#${i+1}</span></td>
          <td data-label="Giocatore"><span class="player-link" data-player="${s.r.player_name}">${s.r.player_name}</span></td>
          <td data-label="Ruolo">${gruppoBadge(s.r.gruppo, s.r.gruppo_da_assegnare)}</td>
          <td data-label="Indice" class="lb-value">${s.blendedScore.toFixed(1)}</td>
          <td data-label="Δ">${deltaCell(s)}</td>
          <td data-label="Storico" class="career-cell">${s.historicScore.toFixed(1)}</td>
          <td data-label="Forma" class="career-cell">${s.formAvailable ? `${s.formScore.toFixed(1)} <span class="opp-tag">(${s.formGames} pt)</span>` : "-"}</td>
          <td data-label="Media">${s.r.rating_ave}</td>
          <td data-label="G+A/partita">${s.contrib.toFixed(2)}</td>
          <td data-label="MOTM%">${s.motmRate.toFixed(0)}%</td>
          <td data-label="Win%">${s.r.win_rate}%</td>
        </tr>
      `;
    }).join("");
  }

  function recompute(){
    scored = computeBlendedScores(formWindow, formWeight);
    renderControls();
    renderPodium();
    renderCoverage();
    draw();
  }

  renderRoleFilters();
  recompute();
})();

// Serate i cui ruoli nessuno ha ancora confermato. Un fuori ruolo non lascia traccia nei
// dati, quindi finche' non c'e' una conferma la classificazione e' un'ipotesi: meglio
// scriverlo che lasciare che i numeri sembrino piu' solidi di quanto siano.
(function renderDaConfermare(){
  const el = document.getElementById("daConfermare");
  if(!el) return;
  const aperte = DATA.serateAperte || [];
  if(!aperte.length) return;
  const partite = aperte.reduce((s, x) => s + x.partite, 0);
  const giorni = aperte.slice(-4).map(x => x.giorno).join(", ");
  el.innerHTML = `<div class="panel" style="margin-bottom:12px; border-left:3px solid var(--warn,#e0a800);">
    <div style="font-size:12px; color:var(--muted); line-height:1.5;">
      <strong style="color:var(--text);">${partite} partite in attesa di conferma</strong>
      su ${aperte.length} ${aperte.length === 1 ? "serata" : "serate"} (${giorni}${aperte.length > 4 ? " e altre" : ""}).
      EA non distingue un COC da un CC da un esterno: per queste partite il reparto è
      quello abituale di ciascuno, che è l'ipotesi più probabile ma resta un'ipotesi
      finché non la conferma chi ha giocato.
    </div>
  </div>`;
})();

(function renderRoleBoards(){
  const boardsEl = document.getElementById("roleBoards");
  const filtersEl = document.getElementById("roleMinFilters");
  const coverageEl = document.getElementById("roleCoverage");
  if(!boardsEl) return;

  const ALL = computeGroupScores();
  // Presenze minime nel reparto per entrare in classifica. Sotto questa soglia il
  // giocatore resta in tabella con tutte le sue cifre, ma senza posizione.
  // Scelta dal club il 24/08/2026: con 3 partite il valore conta ancora solo per il 38%
  // di se stesso, ma la riduzione verso la media impedisce comunque che un episodio
  // finisca in cima, quindi la soglia serve solo a escludere l'aneddoto puro.
  const MIN_PER_CLASSIFICA = 3;
  const MIN_OPTIONS = [1, 3, 5, 10];
  let minMatches = 1;   // default: mostra tutti, anche chi ha una sola presenza nel ruolo

  const MEDALS = ["🥇", "🥈", "🥉"];

  function renderFilters(){
    filtersEl.innerHTML = MIN_OPTIONS.map(n =>
      `<span class="filter-btn ${n === minMatches ? "active" : ""}" data-min="${n}">${n}</span>`).join("");
    filtersEl.querySelectorAll(".filter-btn").forEach(b => {
      b.addEventListener("click", () => { minMatches = Number(b.dataset.min); renderFilters(); draw(); });
    });
  }

  function groupTable(group, ranked){
    const label = GROUP_LABELS[group] || group;
    const icon = GROUP_ICONS[group] || "•";
    if(ranked.length === 0){
      return `<div class="panel" style="margin-bottom:16px;">
        <h3 style="margin:0 0 8px; font-size:15px;">${icon} ${label}</h3>
        <div class="empty">Nessun giocatore con almeno ${minMatches} ${minMatches === 1 ? "partita" : "partite"} in questo ruolo.</div>
      </div>`;
    }
    // Con un solo giocatore nel reparto non c'e' nessuno con cui normalizzare: ogni componente
    // varrebbe 0.5 e il punteggio uscirebbe sempre 45.0, un numero privo di significato.
    // Meglio dichiararlo apertamente che mostrare una cifra che sembra un giudizio.
    const rankable = ranked.length > 1;
    // Chi ha giocato pochissimo nel reparto resta visibile - le sue cifre sono vere e
    // vanno viste - ma non prende una posizione. Ridurre verso la media non bastava: con
    // una partita sola il punteggio finiva esattamente a meta' classifica, e meta'
    // classifica e' comunque sopra chi in quel ruolo ci gioca da quaranta partite ed e'
    // semplicemente sotto la media. Una partita non e' un rendimento: non si ordina.
    // Prima i classificati in ordine di punteggio, poi i fuori classifica in ordine di
    // presenze: lasciarli sparsi in mezzo faceva leggere "1, 2, fuori, fuori, 3" e
    // sembrava un errore di ordinamento invece di una scelta.
    const ordinati = [
      ...ranked.filter(a => a.games >= MIN_PER_CLASSIFICA),
      ...ranked.filter(a => a.games < MIN_PER_CLASSIFICA).sort((x, y) => y.games - x.games),
    ];
    let posto = 0;
    const rows = ordinati.map((a) => {
      const inClassifica = rankable && a.games >= MIN_PER_CLASSIFICA;
      const i = inClassifica ? posto++ : -1;
      return `
      <tr${inClassifica ? "" : ' style="opacity:.62;"'}>
        <td data-label="#">${!rankable ? "–"
            : inClassifica ? (MEDALS[i] || (i + 1))
            : `<span class="opp-tag" title="Servono almeno ${MIN_PER_CLASSIFICA} partite nel reparto per entrare in classifica">fuori</span>`}</td>
        <td data-label="Giocatore"><span class="player-link" data-player="${a.player_name}">${a.player_name}</span>${a.unassigned ? ` <span class="pos-badge" title="Non presente in roles.json: gruppo dedotto dall'etichetta EA">da assegnare</span>` : ""}</td>
        <td data-label="Indice">${!rankable ? `<span style="color:var(--muted);" title="Serve almeno un altro giocatore nello stesso reparto per calcolare un punteggio relativo">n/d</span>`
            : inClassifica ? `<strong>${a.score.toFixed(1)}</strong>`
            : `<span style="color:var(--muted); font-size:12px;">poche partite qui</span>`}</td>
        <td data-label="Partite nel ruolo">${a.games}</td>
        <td data-label="Gol">${a.sumGoals}</td>
        <td data-label="Assist">${a.sumAssists}</td>
        <td data-label="Media">${a.ratingAve.toFixed(2)}</td>
        <td data-label="G+A/partita">${a.contrib.toFixed(2)}</td>
        <td data-label="MOTM%">${a.motmRate.toFixed(0)}%</td>
        <td data-label="Win%">${a.winRate.toFixed(0)}%</td>
      </tr>`;
    }).join("");
    const ignorate = (ranked[0] && ranked[0].metricheIgnorate) || [];
    const ETICHETTE = { rating:"media voto", contrib:"gol+assist", motm:"MOTM", win:"% vittorie", tech:"efficienza tecnica" };
    const notaIgnorate = ignorate.length
      ? `<div style="font-size:12px; color:var(--muted); margin-bottom:10px;">In questo reparto
         ${ignorate.map(k => ETICHETTE[k] || k).join(", ")} ${ignorate.length > 1 ? "non distinguono" : "non distingue"}
         nessuno (tutti allo stesso valore): ${ignorate.length > 1 ? "sono state escluse" : "è stata esclusa"}
         dal calcolo e il ${ignorate.length > 1 ? "loro peso è stato ridistribuito" : "suo peso è stato ridistribuito"}
         sulle altre metriche.</div>`
      : "";
    const soloNote = rankable ? "" :
      `<div style="font-size:12px; color:var(--muted); margin-bottom:10px;">Un solo giocatore in questo reparto: l'indice è relativo ai pari ruolo, quindi non è calcolabile. Le statistiche qui sotto restano reali.</div>`;
    return `<div class="panel" style="margin-bottom:16px;">
      <h3 style="margin:0 0 10px; font-size:15px;">${icon} ${label} <span class="h2-sub">— ${ranked.length} ${ranked.length === 1 ? "giocatore" : "giocatori"}</span></h3>
      ${notaIgnorate}${soloNote}
      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>#</th><th>Giocatore</th><th>Indice</th><th>Partite nel ruolo</th><th>Gol</th><th>Assist</th><th>Media</th><th>G+A/partita</th><th>MOTM%</th><th>Win%</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }

  function draw(){
    const used = GROUP_ORDER.filter(g => ALL.some(a => a.group === g));
    boardsEl.innerHTML = used.length === 0
      ? `<div class="panel"><div class="empty">Nessuna partita archiviata con un ruolo riconosciuto.</div></div>`
      : used.map(g => groupTable(g, rankGroup(ALL.filter(a => a.group === g && a.games >= minMatches)))).join("");

    const rosterNames = (DATA.roster || []).map(r => r.player_name);
    const withMatches = new Set(ALL.map(a => a.player_name));
    const missing = rosterNames.filter(n => !withMatches.has(n));
    const emptyGroups = GROUP_ORDER.filter(g => !ALL.some(a => a.group === g));
    const parts = [];
    // Copertura: senza questo numero i totali qui sotto sembrano sbagliati. EA espone il
    // dettaglio per giocatore solo delle ultime partite, quindi l'archivio e' una frazione
    // della carriera del club e nessuno avra' mai qui i numeri che ha nella sezione Rosa.
    const archived = (DATA.matches || []).length;
    const clubGames = (DATA.latest && DATA.latest.games_played) || 0;
    const pct = clubGames ? Math.round((archived / clubGames) * 100) : 0;
    const dates = (DATA.matches || []).map(m => m.played_at).filter(Boolean).sort();
    const shortDate = (iso) => new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
    const span = dates.length ? `, dal ${shortDate(dates[0])} al ${shortDate(dates[dates.length - 1])}` : "";
    parts.push(`<strong style="color:var(--text);">${archived} partite archiviate</strong>`
      + (clubGames ? ` su ${clubGames} giocate dal club (${pct}%)` : "")
      + `${span}. Gol, assist e presenze qui sotto contano solo queste: le statistiche di carriera complete sono nelle altre sezioni.`);
    if(missing.length){
      parts.push(`Fuori classifica per mancanza di partite archiviate: ${missing.join(", ")} — compariranno appena giocheranno una partita tracciata.`);
    }
    if(emptyGroups.length){
      parts.push(`Reparti ancora vuoti: ${emptyGroups.map(g => GROUP_LABELS[g] || g).join(", ")}.`);
    }
    coverageEl.innerHTML = parts.join("<br>");
  }

  renderFilters();
  draw();
})();

// ---- Livello degli avversari ----
// Il dato della partita dice contro chi si e' giocato ma non quanto valesse: senza
// questo, "perso 1-3" non distingue una sconfitta contro una corazzata da una contro
// una squadra alla nostra portata. Lo skill rating dei club affrontati viene raccolto
// a parte da avversari.py e confrontato col nostro attuale.
const SOGLIA_LIVELLO = 50;  // sotto questa differenza consideriamo l'avversario alla pari

(function renderLivelloAvversari(){
  const el = document.getElementById("livelloAvversari");
  if(!el) return;
  const avversari = DATA.avversari || {};
  const nostro = Number((DATA.latest || {}).skill_rating) || null;
  const conDati = (DATA.matches || []).filter(m =>
    m.opponent_club_id && avversari[String(m.opponent_club_id)] &&
    avversari[String(m.opponent_club_id)].skill_rating);

  if(!nostro || conDati.length === 0){
    el.innerHTML = `<div style="font-size:13px; color:var(--muted);">
      Il livello degli avversari non è ancora disponibile: viene raccolto un club alla volta
      dagli aggiornamenti automatici e comparirà qui man mano.</div>`;
    return;
  }

  const fasce = [
    { chiave:"forti",  etichetta:"Più forti di noi",  test:d => d >  SOGLIA_LIVELLO, colore:"var(--accent)" },
    { chiave:"pari",   etichetta:"Al nostro livello", test:d => Math.abs(d) <= SOGLIA_LIVELLO, colore:"#facc15" },
    { chiave:"deboli", etichetta:"Più deboli di noi", test:d => d < -SOGLIA_LIVELLO, colore:"var(--ok,#4ade80)" },
  ];
  const agg = {};
  fasce.forEach(f => agg[f.chiave] = { n:0, v:0, p:0, s:0, gf:0, ga:0, pt:0 });
  conDati.forEach(m => {
    const d = Number(avversari[String(m.opponent_club_id)].skill_rating) - nostro;
    const f = fasce.find(x => x.test(d));
    if(!f) return;
    const a = agg[f.chiave];
    a.n++; a.gf += m.goals_for || 0; a.ga += m.goals_against || 0;
    if(m.goals_for > m.goals_against){ a.v++; a.pt += 3; }
    else if(m.goals_for === m.goals_against){ a.p++; a.pt += 1; }
    else a.s++;
  });

  const righe = fasce.filter(f => agg[f.chiave].n > 0).map(f => {
    const a = agg[f.chiave];
    return `<tr>
      <td data-label="Fascia"><span style="color:${f.colore};">●</span> ${f.etichetta}</td>
      <td data-label="Partite">${a.n}</td>
      <td data-label="Bilancio">${a.v}V ${a.p}P ${a.s}S</td>
      <td data-label="Gol">${a.gf}-${a.ga}</td>
      <td data-label="Punti a partita"><strong>${(a.pt / a.n).toFixed(2)}</strong></td>
    </tr>`;
  }).join("");

  const senzaDati = (DATA.matches || []).length - conDati.length;
  el.innerHTML = `
    <div style="font-size:12px; color:var(--muted); line-height:1.5; margin-bottom:10px;">
      Ogni partita è classificata confrontando lo skill rating dell'avversario col nostro attuale
      (<strong style="color:var(--text);">${nostro}</strong>). Scarti entro ${SOGLIA_LIVELLO} punti contano come
      "al nostro livello". Il rating degli avversari è quello di oggi, non quello del giorno della
      partita: per gli incontri più vecchi è un'approssimazione.
    </div>
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>Fascia</th><th>Partite</th><th>Bilancio</th><th>Gol</th><th>Punti a partita</th></tr></thead>
        <tbody>${righe}</tbody>
      </table>
    </div>
    ${senzaDati > 0 ? `<div style="font-size:12px; color:var(--muted); margin-top:10px;">
      ${senzaDati} ${senzaDati === 1 ? "partita è esclusa" : "partite sono escluse"} perché il livello di
      quell'avversario non è ancora stato raccolto.</div>` : ""}`;
})();

// ---- Salute dell'archivio ----
// EA fornisce il dettaglio per giocatore solo delle ultime 10 partite, ma tiene un
// contatore cumulativo di quelle giocate. La differenza tra i due dice quante partite
// non siamo riusciti ad archiviare: e' l'unico modo di accorgersi di un buco, perche'
// una partita persa non lascia altre tracce.
(function renderSalute(){
  const el = document.getElementById("salutePanel");
  const sa = DATA.saluteArchivio;
  if(!el) return;
  if(!sa || sa.attese === null || sa.attese === undefined){
    el.innerHTML = `<div style="font-size:13px; color:var(--muted);">
      <strong style="color:var(--text);">${(DATA.matches || []).length} partite archiviate.</strong>
      Servono almeno due aggiornamenti per stimare quante ne siano sfuggite.</div>`;
    return;
  }
  const perc = sa.attese > 0 ? Math.round((sa.archiviateDaPrimoSnapshot / sa.attese) * 100) : 100;
  const colore = perc >= 90 ? "var(--ok,#4ade80)" : (perc >= 60 ? "#facc15" : "var(--accent)");
  const recente = sa.divarioRecente;
  el.innerHTML = `
    <div style="font-size:13px; line-height:1.6;">
      <strong style="color:var(--text);">${sa.archiviate} partite archiviate</strong> in totale,
      su ${sa.giocateEA} giocate dal club secondo EA.
      <br>
      Dal ${new Date(sa.daQuando).toLocaleDateString("it-IT", { day:"2-digit", month:"long" })},
      da quando l'archivio è attivo, il club ha giocato <strong style="color:var(--text);">${sa.attese}</strong> partite
      e ne abbiamo salvate <strong style="color:${colore};">${sa.archiviateDaPrimoSnapshot}</strong> (${perc}%).
      ${sa.divario > 0 ? `Le altre <strong>${sa.divario}</strong> sono andate perse prima che
        l'aggiornamento automatico diventasse abbastanza frequente: EA non le espone più.` : ``}
      <div style="background:var(--panel-2,rgba(255,255,255,.06)); border-radius:4px; height:8px; margin:10px 0;">
        <div style="width:${Math.min(100, perc)}%; height:8px; border-radius:4px; background:${colore};"></div>
      </div>
      ${recente
        ? `<span style="color:var(--accent);"><strong>${recente} partite delle ultime 48 ore non sono ancora in archivio.</strong></span>
           EA pubblica i risultati con qualche ora di ritardo, quindi può essere normale: se il numero
           non scende entro il prossimo aggiornamento, quelle partite sono perse.`
        : `<span style="color:var(--ok,#4ade80);">Nessuna partita mancante nelle ultime 48 ore.</span>`}
    </div>`;
})();

// ---- Formazione tipo: modulo fisso 3-4-1-2, portiere sempre libero ----
// Ogni ruolo di movimento (3 difensori, 4 centrocampisti, 1 trequartista, 2 attaccanti)
// viene SEMPRE riempito con un giocatore reale: prima si usano i dati di partita specifici
// per quel ruolo (stesso algoritmo pesato dell'Indice di Forza, calcolato solo sulle partite
// giocate lì), poi — solo se non bastano candidati con dati specifici — si completa con i
// migliori rimasti secondo l'Indice di Forza generale (segnati come "stima" in tabella).
const OUTFIELD_ROLES = ["defender", "midfielder", "forward"];
const FORMATION_SLOTS = { defender: 3, midfielder: 4, trequartista: 1, forward: 2 }; // portiere volutamente escluso

function computeRoleAggregates(){
  const winByMatch = new Map((DATA.matches || []).map(m => [m.match_id, m.win]));
  const agg = {};
  (DATA.matches || []).forEach(m => {
    const players = DATA.matchPlayers[m.match_id] || [];
    const win = winByMatch.get(m.match_id) ? 1 : 0;
    players.forEach(p => {
      if(!OUTFIELD_ROLES.includes(p.pos)) return;
      const key = p.player_name + "|" + p.pos;
      if(!agg[key]){
        agg[key] = {
          player_name: p.player_name, role: p.pos, games: 0,
          sumRating: 0, sumGoals: 0, sumAssists: 0, sumMom: 0, sumWin: 0,
          sumPassesMade: 0, sumPassAttempts: 0, sumTacklesMade: 0, sumTackleAttempts: 0,
          sumShots: 0, sumRedCards: 0,
        };
      }
      const a = agg[key];
      a.games++;
      a.sumRating += p.rating || 0;
      a.sumGoals += p.goals || 0;
      a.sumAssists += p.assists || 0;
      a.sumMom += p.mom || 0;
      a.sumWin += win;
      a.sumPassesMade += p.passes_made || 0;
      a.sumPassAttempts += p.pass_attempts || 0;
      a.sumTacklesMade += p.tackles_made || 0;
      a.sumTackleAttempts += p.tackle_attempts || 0;
      a.sumShots += p.shots || 0;
      a.sumRedCards += p.red_cards || 0;
    });
  });
  return Object.values(agg).map(a => {
    const passSuccess = a.sumPassAttempts > 0 ? (a.sumPassesMade / a.sumPassAttempts) * 100 : 0;
    const tackleSuccess = a.sumTackleAttempts > 0 ? (a.sumTacklesMade / a.sumTackleAttempts) * 100 : 0;
    const shotSuccess = a.sumShots > 0 ? (a.sumGoals / a.sumShots) * 100 : 0;
    return {
      ...a,
      ratingAve: a.sumRating / a.games,
      contrib: (a.sumGoals + a.sumAssists) / a.games,
      motmRate: a.sumMom / a.games,
      winRate: (a.sumWin / a.games) * 100,
      techEff: (passSuccess + tackleSuccess + shotSuccess) / 3,
      redRate: a.sumRedCards / a.games,
      fallback: false,
    };
  });
}

function computeRoleScores(){
  const all = computeRoleAggregates();
  function normalize(values){
    const min = Math.min(...values), max = Math.max(...values);
    if(max === min) return values.map(() => 0.5);
    return values.map(v => (v - min) / (max - min));
  }
  const byRole = {};
  OUTFIELD_ROLES.forEach(role => {
    const pool = all.filter(a => a.role === role);
    if(pool.length === 0){ byRole[role] = []; return; }
    const nRating = normalize(pool.map(a => a.ratingAve));
    const nContrib = normalize(pool.map(a => a.contrib));
    const nMotm = normalize(pool.map(a => a.motmRate));
    const nWin = normalize(pool.map(a => a.winRate));
    const nTech = normalize(pool.map(a => a.techEff));
    const nDisc = normalize(pool.map(a => a.redRate));
    byRole[role] = pool.map((a, i) => ({
      ...a,
      score: Math.max(0, Math.min(100, 100 * (
        0.40 * nRating[i] + 0.20 * nContrib[i] + 0.15 * nMotm[i] + 0.10 * nWin[i] + 0.10 * nTech[i] - 0.05 * nDisc[i]
      ))),
    })).sort((x, y) => y.score - x.score);
  });
  return byRole;
}

// Giocatori che non fanno più parte del club: esclusi da tutti i suggerimenti di formazione
// (ma restano visibili nelle altre sezioni della dashboard, es. Indice di Forza, che sono storiche).

function computeOutfieldLineup(){
  // Gli ex giocatori sono gia' fuori da DATA.roster: qui non serve rifiltrarli.
  const roster = DATA.roster || [];
  const goalkeeperNames = new Set(roster
    .filter(r => r.gruppo === "PORTIERI" || r.role_effective === "goalkeeper")
    .map(r => r.player_name));
  // I punteggi di ruolo nascono dalle partite archiviate, che includono anche chi non raggiunge
  // la soglia minima di presenze: qui li scartiamo, per restare coerenti con il resto della dashboard.
  const rosterNames = new Set(roster.map(r => r.player_name));
  const byRole = computeRoleScores();
  const assigned = new Set();
  const lineup = { defender: [], midfielder: [], forward: [], trequartista: null };

  const genericRanked = [...POWER_SCORES]
    .filter(s => !goalkeeperNames.has(s.r.player_name))
    .sort((a, b) => b.score - a.score);

  function fillRole(role, count){
    const pool = (byRole[role] || []).filter(c => rosterNames.has(c.player_name) && !goalkeeperNames.has(c.player_name) && !assigned.has(c.player_name));
    const picked = [];
    for(const c of pool){
      if(picked.length >= count) break;
      picked.push(c);
      assigned.add(c.player_name);
    }
    if(picked.length < count){
      for(const s of genericRanked){
        if(picked.length >= count) break;
        if(assigned.has(s.r.player_name)) continue;
        picked.push({
          player_name: s.r.player_name, role, score: s.score, games: 0,
          ratingAve: s.r.rating_ave, contrib: s.contrib, fallback: true,
        });
        assigned.add(s.r.player_name);
      }
    }
    return picked;
  }

  lineup.defender = fillRole("defender", FORMATION_SLOTS.defender);
  lineup.forward = fillRole("forward", FORMATION_SLOTS.forward);
  const midPool = fillRole("midfielder", FORMATION_SLOTS.midfielder + FORMATION_SLOTS.trequartista);
  const sortedByAttack = [...midPool].sort((a, b) => (b.contrib || 0) - (a.contrib || 0));
  lineup.trequartista = sortedByAttack[0] || null;
  lineup.midfielder = midPool.filter(p => p !== lineup.trequartista);

  return lineup;
}

(function renderFormation(){
  const lineup = computeOutfieldLineup();
  const pitchEl = document.getElementById("pitchField");

  function slotHtml(role, entry, cssRole){
    if(!entry){
      return `<div class="pitch-player"><div class="dot empty">?</div><div class="pname">—</div></div>`;
    }
    const estBadge = entry.fallback ? `<div class="pscore est">stima</div>` : `<div class="pscore">${entry.games}p · ${entry.ratingAve.toFixed(2)}</div>`;
    return `
      <div class="pitch-player player-link" data-player="${entry.player_name}">
        <div class="dot ${cssRole}">${entry.score.toFixed(0)}</div>
        <div class="pname">${entry.player_name}</div>
        ${estBadge}
      </div>`;
  }

  const rows = [];
  rows.push(`<div class="pitch-row">${lineup.forward.map(e => slotHtml("forward", e, "forward")).join("")}</div>`);
  rows.push(`<div class="pitch-row">${slotHtml("trequartista", lineup.trequartista, "trequartista")}</div>`);
  rows.push(`<div class="pitch-row">${lineup.midfielder.map(e => slotHtml("midfielder", e, "midfielder")).join("")}</div>`);
  rows.push(`<div class="pitch-row">${lineup.defender.map(e => slotHtml("defender", e, "defender")).join("")}</div>`);
  rows.push(`<div class="pitch-row"><div class="pitch-player"><div class="dot empty">GK</div><div class="pname">Libero</div><div class="pscore">a rotazione</div></div></div>`);
  pitchEl.innerHTML = rows.join("");

  const tbody = document.querySelector("#formationTable tbody");
  const allSlots = [
    ...lineup.forward.map(e => ({ ...e, roleLabel: "Attacco" })),
    lineup.trequartista ? { ...lineup.trequartista, roleLabel: "Trequartista" } : null,
    ...lineup.midfielder.map(e => ({ ...e, roleLabel: "Centrocampo" })),
    ...lineup.defender.map(e => ({ ...e, roleLabel: "Difesa" })),
  ].filter(Boolean);

  tbody.innerHTML = allSlots.map(e => `
    <tr>
      <td data-label="Ruolo">${e.roleLabel}</td>
      <td data-label="Giocatore"><span class="player-link" data-player="${e.player_name}">${e.player_name}</span></td>
      <td data-label="Indice" class="lb-value">${e.score.toFixed(1)}</td>
      <td data-label="Partite nel ruolo">${e.games}</td>
      <td data-label="Media voto">${e.ratingAve.toFixed(2)}</td>
      <td data-label="Fonte">${e.fallback ? "stima (Indice di Forza generale)" : "dati di ruolo reali"}</td>
    </tr>
  `).join("");
})();

(function renderH2H(){
  const roster = [...(DATA.roster || [])].sort((a,b)=> a.player_name.localeCompare(b.player_name));
  const selA = document.getElementById("h2hA");
  const selB = document.getElementById("h2hB");
  if(roster.length < 2){
    document.getElementById("chartH2H").parentElement.innerHTML = '<div class="empty">Servono almeno due giocatori con statistiche.</div>';
    return;
  }
  const options = roster.map((r,i) => `<option value="${i}">${r.player_name}</option>`).join("");
  selA.innerHTML = options;
  selB.innerHTML = options;
  selA.selectedIndex = 0;
  selB.selectedIndex = Math.min(1, roster.length - 1);

  let chart = null;
  function draw(){
    const a = roster[selA.value], b = roster[selB.value];
    const labels = ["Gol", "Assist", "Media x10", "Win %", "Pass %", "Contrasti %"];
    const dataA = [a.goals, a.assists, +(a.rating_ave*10).toFixed(1), a.win_rate, a.pass_success_rate, a.tackle_success_rate];
    const dataB = [b.goals, b.assists, +(b.rating_ave*10).toFixed(1), b.win_rate, b.pass_success_rate, b.tackle_success_rate];
    if(chart) chart.destroy();
    chart = new Chart(document.getElementById("chartH2H"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: a.player_name, data: dataA, backgroundColor: "#d5203a", borderRadius: 4 },
          { label: b.player_name, data: dataB, backgroundColor: "#f0b90b", borderRadius: 4 },
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: "#f5ece4" } } },
        scales: {
          x: { ticks: { color: "#b99aa0" }, grid: { display:false } },
          y: { ticks: { color: "#b99aa0" }, grid: { color: "#4a232a" } },
        }
      }
    });
  }
  selA.addEventListener("change", draw);
  selB.addEventListener("change", draw);
  draw();
})();

// ---- Riepilogo periodo (wrapped) ----
(function renderWrapped(){
  const el = document.getElementById("wrappedGrid");
  const matches = DATA.matches || [];
  if(matches.length === 0){
    el.innerHTML = '<div class="empty">Nessuna partita tracciata ancora.</div>';
    return;
  }
  const totalGoalsFor = matches.reduce((s,m)=>s+m.goals_for,0);
  const totalGoalsAgainst = matches.reduce((s,m)=>s+m.goals_against,0);
  const wins = matches.filter(m=>m.win).length;
  const ties = matches.filter(m=>m.tie).length;
  const losses = matches.filter(m=>!m.win && !m.tie).length;
  const bestWin = [...matches].filter(m=>m.win).sort((a,b)=> (b.goals_for-b.goals_against)-(a.goals_for-a.goals_against))[0];
  const worstLoss = [...matches].filter(m=>!m.win && !m.tie).sort((a,b)=> (a.goals_for-a.goals_against)-(b.goals_for-b.goals_against))[0];

  // capocannoniere e MVP nel periodo tracciato (solo partite con dettaglio giocatori)
  const perPlayer = {};
  matches.forEach(m => {
    (DATA.matchPlayers[m.match_id] || []).forEach(p => {
      if(!p.player_name) return;
      if(!perPlayer[p.player_name]) perPlayer[p.player_name] = { goals:0, assists:0, mom:0 };
      perPlayer[p.player_name].goals += p.goals;
      perPlayer[p.player_name].assists += p.assists;
      perPlayer[p.player_name].mom += p.mom ? 1 : 0;
    });
  });
  const topScorerPeriod = Object.entries(perPlayer).sort((a,b)=> b[1].goals - a[1].goals)[0];
  const mvpPeriod = Object.entries(perPlayer).sort((a,b)=> b[1].mom - a[1].mom)[0];

  // Strisce e porta inviolata. Si calcolano scorrendo le partite in ordine di gioco: il
  // record e' il piu' lungo mai raggiunto, la striscia in corso quella che sta durando
  // adesso. Le due cose coincidono solo finche' il record e' quello attuale.
  const inOrdine = matches.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  let recordV = 0, recordI = 0, correnteV = 0, correnteI = 0;
  inOrdine.forEach(m => {
    correnteV = m.win ? correnteV + 1 : 0;
    correnteI = m.loss ? 0 : correnteI + 1;
    recordV = Math.max(recordV, correnteV);
    recordI = Math.max(recordI, correnteI);
  });
  const inviolate = inOrdine.filter(m => (m.goals_against || 0) === 0).length;
  const ultima = inOrdine[inOrdine.length - 1];
  const strisciaOra = !ultima ? "—"
    : correnteV >= 2 ? `${correnteV} vittorie di fila`
    : correnteI >= 2 ? `${correnteI} risultati utili`
    : ultima.win ? "1 vittoria" : (ultima.loss ? "nessuna, ultima persa" : "1 pareggio");

  const cards = [
    ["Partite tracciate", matches.length],
    ["Bilancio nel periodo", `${wins}V ${ties}P ${losses}S`],
    ["Gol fatti / subiti", `${totalGoalsFor} / ${totalGoalsAgainst}`],
    ["Striscia di vittorie (record)", recordV > 0 ? `${recordV} di fila` : "-"],
    ["Imbattibilità (record)", recordI > 0 ? `${recordI} partite` : "-"],
    ["Striscia in corso", strisciaOra],
    ["Porta inviolata", matches.length ? `${inviolate} partite · ${Math.round(100 * inviolate / matches.length)}%` : "-"],
    ["Miglior vittoria", bestWin ? `${bestWin.goals_for}-${bestWin.goals_against} vs ${bestWin.opponent_name||"?"}` : "-"],
    ["Peggior sconfitta", worstLoss ? `${worstLoss.goals_for}-${worstLoss.goals_against} vs ${worstLoss.opponent_name||"?"}` : "-"],
    ["Capocannoniere del periodo", topScorerPeriod && topScorerPeriod[1].goals > 0 ? `${topScorerPeriod[0]} (${topScorerPeriod[1].goals} gol)` : "-"],
    ["MVP del periodo (MOTM)", mvpPeriod && mvpPeriod[1].mom > 0 ? `${mvpPeriod[0]} (${mvpPeriod[1].mom})` : "-"],
  ];
  el.innerHTML = cards.map(([label, value]) => `
    <div class="wrapped-card"><div class="label">${label}</div><div class="value">${value}</div></div>
  `).join("");
})();

// ---- Distribuzione risultati per margine di gol ----
(function renderResultsDistribution(){
  const ctx = document.getElementById("chartResultsDist");
  const matches = DATA.matches || [];
  if(matches.length === 0){
    ctx.parentElement.innerHTML = '<div class="empty">Nessuna partita nel database ancora.</div>';
    return;
  }

  const buckets = [
    { label: "Sconfitta pesante (-3 o più)", test: d => d <= -3, color: "#8a1424" },
    { label: "Sconfitta netta (-2)", test: d => d === -2, color: "#b23347" },
    { label: "Sconfitta di misura (-1)", test: d => d === -1, color: "#e5566d" },
    { label: "Pareggio (0)", test: d => d === 0, color: "#e0b23f" },
    { label: "Vittoria di misura (+1)", test: d => d === 1, color: "#6fc99a" },
    { label: "Vittoria netta (+2)", test: d => d === 2, color: "#33c17a" },
    { label: "Vittoria schiacciante (+3 o più)", test: d => d >= 3, color: "#1f8f56" },
  ];
  const counts = buckets.map(b => matches.filter(m => b.test(m.goals_for - m.goals_against)).length);

  new Chart(ctx, {
    type: "bar",
    data: {
      labels: buckets.map(b => b.label),
      datasets: [{ data: counts, backgroundColor: buckets.map(b => b.color), borderRadius: 4 }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#b99aa0", autoSkip: false, maxRotation: 40, minRotation: 0 }, grid: { display: false } },
        y: { ticks: { color: "#b99aa0", precision: 0 }, grid: { color: "#4a232a" } },
      }
    }
  });
})();

// ---- Avversari: bilancio contro ogni club affrontato ----
(function renderOpponents(){
  const matches = DATA.matches || [];
  const cardsEl = document.getElementById("opponentCards");
  const tbody = document.querySelector("#opponentsTable tbody");
  const filterInput = document.getElementById("opponentFilter");

  if(matches.length === 0){
    cardsEl.innerHTML = "";
    tbody.innerHTML = `<tr><td colspan="9" class="empty">Nessuna partita nel database ancora.</td></tr>`;
    return;
  }

  const groups = {};
  matches.forEach(m => {
    const key = m.opponent_name || "Sconosciuto";
    if(!groups[key]){
      groups[key] = { name: key, games: 0, wins: 0, ties: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, lastTs: 0, lastPlayedAt: null };
    }
    const g = groups[key];
    g.games++;
    if(m.win) g.wins++;
    else if(m.tie) g.ties++;
    else g.losses++;
    g.goalsFor += m.goals_for;
    g.goalsAgainst += m.goals_against;
    if((m.ts || 0) > g.lastTs){
      g.lastTs = m.ts || 0;
      g.lastPlayedAt = m.played_at;
    }
  });

  const list = Object.values(groups).map(g => ({ ...g, goalDiff: g.goalsFor - g.goalsAgainst }));

  const mostPlayed = [...list].sort((a,b) => b.games - a.games)[0];
  const withAtLeast2 = list.filter(g => g.games >= 2);
  const nemesis = [...withAtLeast2].sort((a,b) => (a.wins - a.losses) - (b.wins - b.losses) || a.wins - b.wins)[0];
  const victim = [...withAtLeast2].sort((a,b) => (b.wins - b.losses) - (a.wins - a.losses) || b.wins - a.wins)[0];

  const cards = [
    ["Avversari diversi affrontati", list.length, ""],
    ["Più affrontato", mostPlayed ? `${mostPlayed.name} (${mostPlayed.games}x)` : "-", ""],
    ["Bestia nera", nemesis ? `${nemesis.name} (${nemesis.wins}V ${nemesis.ties}P ${nemesis.losses}S)` : "-", nemesis && nemesis.losses > nemesis.wins ? "loss" : ""],
    ["Vittima preferita", victim ? `${victim.name} (${victim.wins}V ${victim.ties}P ${victim.losses}S)` : "-", victim && victim.wins > victim.losses ? "win" : ""],
  ];
  cardsEl.innerHTML = cards.map(([label, value, cls]) =>
    `<div class="card"><div class="label">${label}</div><div class="value ${cls}">${value}</div></div>`
  ).join("");

  let sort = { key: "games", dir: -1 };
  function draw(){
    const q = (filterInput.value || "").toLowerCase();
    let rows = list.filter(g => g.name.toLowerCase().includes(q));
    rows.sort((a,b) => {
      const av = a[sort.key], bv = b[sort.key];
      if(typeof av === "string") return av.localeCompare(bv) * sort.dir;
      return ((av||0) - (bv||0)) * sort.dir;
    });
    if(rows.length === 0){
      tbody.innerHTML = `<tr><td colspan="9" class="empty">Nessun avversario trovato</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(g => `
      <tr>
        <td data-label="Avversario">${g.name}</td>
        <td data-label="Partite">${g.games}</td>
        <td data-label="V">${g.wins}</td>
        <td data-label="P">${g.ties}</td>
        <td data-label="S">${g.losses}</td>
        <td data-label="GF">${g.goalsFor}</td>
        <td data-label="GS">${g.goalsAgainst}</td>
        <td data-label="DR">${g.goalDiff > 0 ? "+" : ""}${g.goalDiff}</td>
        <td data-label="Ultima">${fmtDate(g.lastPlayedAt)}</td>
      </tr>
    `).join("");
  }
  document.querySelectorAll("#opponentsTable th").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if(!key) return;
      sort.dir = (sort.key === key) ? -sort.dir : -1;
      sort.key = key;
      draw();
    });
  });
  filterInput.addEventListener("input", draw);
  draw();
})();

// ---- Matches table ----
// ---- Vittorie e sconfitte: cosa cambia ----
// Misurato il 23/08/2026 sull'archivio: tiri, passaggi e precisione sono quasi identici
// nelle vittorie e nelle sconfitte. Cambiano solo la conversione dei tiri e i gol subiti.
// La sezione esiste per rendere visibile questo tipo di cosa, non per assegnare colpe.
(function renderDiagnosi(){
  const tbody = document.querySelector("#diagnosiTabella tbody");
  const letturaEl = document.getElementById("diagnosiLettura");
  if(!tbody) return;

  const esiti = { vittoria: [], pareggio: [], sconfitta: [] };
  (DATA.matches || []).forEach(m => {
    const e = m.win ? "vittoria" : (m.tie ? "pareggio" : "sconfitta");
    esiti[e].push(m);
  });

  function medie(partite){
    if(partite.length === 0) return null;
    let gf = 0, gs = 0, tiri = 0, gol = 0, pm = 0, pt = 0, tm = 0, tt = 0, voto = 0, righe = 0;
    partite.forEach(m => {
      gf += m.goals_for || 0; gs += m.goals_against || 0;
      (DATA.matchPlayers[m.match_id] || []).forEach(p => {
        righe++; tiri += p.shots || 0; gol += p.goals || 0;
        pm += p.passes_made || 0; pt += p.pass_attempts || 0;
        tm += p.tackles_made || 0; tt += p.tackle_attempts || 0;
        voto += p.rating || 0;
      });
    });
    const n = partite.length;
    return {
      n, golFatti: gf / n, golSubiti: gs / n, tiri: tiri / n,
      conversione: tiri ? 100 * gol / tiri : 0,
      passaggi: pm / n, precisione: pt ? 100 * pm / pt : 0,
      contrasti: tt / n, riuscita: tt ? 100 * tm / tt : 0,
      voto: righe ? voto / righe : 0,
      scarto: (gf - gs) / n,
      inviolata: 100 * partite.filter(m => (m.goals_against || 0) === 0).length / n,
      crollo: 100 * partite.filter(m => (m.goals_against || 0) >= 4).length / n,
      corte: 100 * partite.filter(m => Math.abs((m.goals_for || 0) - (m.goals_against || 0)) <= 1).length / n,
    };
  }

  const V = medie(esiti.vittoria), P = medie(esiti.pareggio), S = medie(esiti.sconfitta);
  if(!V || !S){
    letturaEl.innerHTML = '<div class="empty">Servono partite vinte e perse per il confronto.</div>';
    return;
  }

  const VOCI = [
    { k: "n",           lab: "Partite",                  f: x => x, quanto: null },
    { k: "golFatti",    lab: "Gol fatti",                f: x => x.toFixed(1) },
    { k: "golSubiti",   lab: "Gol subiti",               f: x => x.toFixed(1) },
    { k: "tiri",        lab: "Tiri",                     f: x => x.toFixed(1) },
    { k: "conversione", lab: "Gol per tiro",             f: x => Math.round(x) + "%", perc: true },
    { k: "passaggi",    lab: "Passaggi riusciti",        f: x => Math.round(x) },
    { k: "precisione",  lab: "Precisione passaggi",      f: x => Math.round(x) + "%", perc: true },
    { k: "contrasti",   lab: "Contrasti tentati",        f: x => x.toFixed(1) },
    { k: "riuscita",    lab: "Contrasti riusciti",       f: x => Math.round(x) + "%", perc: true },
    { k: "voto",        lab: "Voto medio",               f: x => x.toFixed(2) },
    // Lo scarto reti attraversa lo zero: una variazione percentuale su un valore che passa
    // da +2.7 a -2.8 produce un -202% che non significa niente. Si confronta in gol.
    { k: "scarto",      lab: "Scarto reti medio",        f: x => (x > 0 ? "+" : "") + x.toFixed(1), gol: true, fDiff: x => x.toFixed(1) },
    { k: "inviolata",   lab: "Porta inviolata",          f: x => Math.round(x) + "%", perc: true },
    { k: "crollo",      lab: "Almeno 4 gol subiti",      f: x => Math.round(x) + "%", perc: true },
    { k: "corte",       lab: "Decise da un gol o pari",  f: x => Math.round(x) + "%", perc: true },
  ];

  tbody.innerHTML = VOCI.map(v => {
    const a = V[v.k], b = P ? P[v.k] : null, c = S[v.k];
    let diff = "";
    if(v.quanto !== null){
      let testo = null, rilevante = false;
      if(v.gol){
        const d = c - a;
        testo = `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} gol`;
        rilevante = Math.abs(d) >= 0.5;
      } else if(v.perc){
        const d = Math.round(c - a);
        testo = d === 0 ? "uguale"
              : `${d > 0 ? "+" : "−"}${Math.abs(d)} ${Math.abs(d) === 1 ? "punto" : "punti"}`;
        rilevante = Math.abs(d) >= 5;
      } else {
        // Come nella scheda osservatore: differenza assoluta, stessa unita' della riga.
        // "+3.5 gol subiti" invece di "+287%", che sembrava un refuso.
        const diff = c - a;
        const scritto = v.f(Math.abs(diff));
        testo = scritto === v.f(0) ? "uguale" : `${diff > 0 ? "+" : "−"}${scritto}`;
        rilevante = a ? Math.abs(100 * diff / Math.abs(a)) >= 8 : diff !== 0;
      }
      if(testo !== null){
        diff = rilevante
          ? `<span style="color:var(--accent);">${testo}</span>`
          : `<span style="color:var(--muted);">quasi uguale</span>`;
      }
    }
    return `<tr>
      <td data-label="Indicatore">${v.lab}</td>
      <td data-label="Vittoria" class="lb-value">${v.f(a)}</td>
      <td data-label="Pareggio">${b == null ? "—" : v.f(b)}</td>
      <td data-label="Sconfitta">${v.f(c)}</td>
      <td data-label="Differenza" style="font-size:12px;">${diff}</td>
    </tr>`;
  }).join("");

  // La lettura si costruisce dai numeri, non e' scritta a mano: se un giorno cambiassero
  // - per esempio se cominciaste a tirare molto meno nelle sconfitte - cambierebbe anche
  // la frase, invece di restare una diagnosi vecchia travestita da conclusione.
  const CONFRONTABILI = ["golFatti", "golSubiti", "tiri", "conversione", "passaggi",
                         "precisione", "contrasti", "riuscita"];
  const uguali = [], diversi = [];
  VOCI.filter(v => CONFRONTABILI.includes(v.k)).forEach(v => {
    const punti = v.perc;
    const d = punti ? S[v.k] - V[v.k] : 100 * (S[v.k] - V[v.k]) / Math.abs(V[v.k] || 1);
    const soglia = punti ? 5 : 8;
    const assoluta = S[v.k] - V[v.k];
    const testo = punti
      ? `${d > 0 ? "+" : "−"}${Math.abs(Math.round(d))} ${Math.abs(Math.round(d)) === 1 ? "punto" : "punti"}`
      : `${assoluta > 0 ? "+" : assoluta < 0 ? "−" : ""}${v.f(Math.abs(assoluta))}`;
    (Math.abs(d) < soglia ? uguali : diversi).push({ lab: v.lab.toLowerCase(), d, testo, k: v.k });
  });
  diversi.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const elenco = a => a.map(x => x.lab).join(", ");
  const num = x => `${x > 0 ? "+" : ""}${Math.round(x)}%`;

  // Il commento si compone a pezzi, ognuno acceso dai numeri che lo giustificano: se un
  // domani la difesa reggesse e il problema diventasse il gioco, sparirebbero le frasi
  // sulla difesa e comparirebbero le altre. Una diagnosi scritta a mano invecchia in
  // silenzio e resta li' a sembrare ancora valida.
  const pezzi = [];

  if(uguali.length){
    pezzi.push(`<strong>Quello che non cambia.</strong> Nelle sconfitte restano praticamente
      identici ${elenco(uguali)}. La squadra arriva a costruire come sempre: il problema non
      nasce dalla manovra.`);
  }
  if(diversi.length){
    pezzi.push(`<strong>Quello che cambia.</strong> ${diversi.map(x =>
      `${x.lab} <span style="color:var(--muted);">(${x.testo})</span>`).join(", ")}.`);
  }

  // Attacco: si tira uguale ma si segna meno, oppure si tira proprio meno?
  const tiriUguali = Math.abs(100 * (S.tiri - V.tiri) / (V.tiri || 1)) < 12;
  const convGiu = S.conversione < V.conversione - 5;
  if(tiriUguali && convGiu){
    pezzi.push(`<strong>Davanti.</strong> Il numero di tiri è lo stesso
      (${V.tiri.toFixed(1)} contro ${S.tiri.toFixed(1)}), ma ne entra il
      <strong>${Math.round(S.conversione)}%</strong> invece del
      <strong>${Math.round(V.conversione)}%</strong>. Non è che si creino meno occasioni:
      si concretizza meno. Servono circa ${(100 / Math.max(S.conversione, 1)).toFixed(1)} tiri
      per un gol nelle sconfitte, contro ${(100 / Math.max(V.conversione, 1)).toFixed(1)} nelle vittorie.`);
  } else if(!tiriUguali){
    pezzi.push(`<strong>Davanti.</strong> Nelle sconfitte si tira ${S.tiri < V.tiri ? "meno" : "di più"}:
      ${S.tiri.toFixed(1)} contro ${V.tiri.toFixed(1)} a partita.`);
  }

  // Difesa: la parte che di solito pesa di piu' e che i totali medi nascondono.
  if(S.golSubiti > V.golSubiti * 1.5){
    pezzi.push(`<strong>Dietro.</strong> I gol subiti passano da <strong>${V.golSubiti.toFixed(1)}</strong>
      a <strong>${S.golSubiti.toFixed(1)}</strong> a partita. La porta resta inviolata nel
      ${Math.round(V.inviolata)}% delle vittorie e nel ${Math.round(S.inviolata)}% delle sconfitte,
      e si incassano quattro o più gol nel <strong>${Math.round(S.crollo)}%</strong> delle partite perse
      contro il ${Math.round(V.crollo)}% di quelle vinte. È qui che le partite si perdono davvero.`);
  }

  // Quante partite si giocano sul filo: dice se il margine di miglioramento e' vicino.
  if(P){
    pezzi.push(`<strong>Quanto sono in bilico.</strong> Il ${Math.round(S.corte)}% delle sconfitte
      si decide entro un gol di scarto, contro il ${Math.round(V.corte)}% delle vittorie.
      ${S.corte >= 40
        ? "Buona parte delle sconfitte è quindi a portata: non sono partite dominate dall'avversario."
        : "Le sconfitte tendono a essere nette, non episodi sfortunati."}`);
  }

  pezzi.push(`<span style="color:var(--muted);">Su ${V.n} vittorie, ${P ? P.n : 0} pareggi e
    ${S.n} sconfitte. Sono medie: dicono cosa succede di solito, non cosa è successo in una
    partita precisa. E confrontano la squadra con sé stessa, senza tenere conto di quanto
    fosse forte l'avversario.</span>`);

  letturaEl.innerHTML = `<div class="panel" style="margin-bottom:12px;">
    ${pezzi.map(p => `<div style="font-size:13px; line-height:1.65; margin-bottom:10px;">${p}</div>`).join("")}
  </div>`;
})();

// ---- Scheda osservatore ----
// Descrive come gioca una persona, non quanto vale. Tre metri di confronto, scelti da chi
// guarda: il proprio reparto, tutta la rosa, oppure se stesso nelle ultime partite.
(function renderOsservatore(){
  const metroEl = document.getElementById("ossMetro");
  const listaEl = document.getElementById("ossGiocatori");
  const curiositaEl = document.getElementById("ossCuriosita");
  const confrontoEl = document.getElementById("ossConfronto");
  if(!metroEl) return;

  const inRosa = new Set((DATA.roster || []).map(r => r.player_name));
  const raccolta = {};
  const ordinate = (DATA.matches || []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  ordinate.forEach(m => {
    (DATA.matchPlayers[m.match_id] || []).forEach(p => {
      if(!inRosa.has(p.player_name)) return;
      const a = raccolta[p.player_name] = raccolta[p.player_name] || { nome: p.player_name, righe: [] };
      // match_id va aggiunto a mano: le righe di matchPlayers sono indicizzate per partita
      // e non se lo portano dentro. Senza, ogni voce che deve risalire alla partita -
      // avversario, esito, posizione nella serata - falliva restituendo nulla, e la scheda
      // si limitava a mostrare meno cose invece di segnalare l'errore.
      a.righe.push({ ...p, ts: m.ts, match_id: m.match_id,
        gruppo: ROLE_EXCEPTIONS[m.match_id + "|" + p.player_name] || groupForMatch(p.player_name, p.pos) });
    });
  });

  function sintesi(righe){
    const n = righe.length;
    if(n === 0) return null;
    const s = (f) => righe.reduce((t, r) => t + (f(r) || 0), 0);
    const voti = righe.map(r => r.rating || 0);
    const media = voti.reduce((a, b) => a + b, 0) / n;
    const varianza = voti.reduce((t, v) => t + (v - media) ** 2, 0) / n;
    const tiri = s(r => r.shots), pt = s(r => r.pass_attempts), tt = s(r => r.tackle_attempts);
    return {
      n, voto: media, oscillazione: Math.sqrt(varianza),
      tiri: tiri / n, conversione: tiri ? 100 * s(r => r.goals) / tiri : 0,
      assist: s(r => r.assists) / n, passaggi: s(r => r.passes_made) / n,
      precisione: pt ? 100 * s(r => r.passes_made) / pt : 0,
      contrasti: tt / n, riuscita: tt ? 100 * s(r => r.tackles_made) / tt : 0,
      motm: 100 * s(r => r.mom) / n,
      // I denominatori servono a sapere quanto fidarsi delle percentuali: una riuscita
      // nei contrasti calcolata su otto tentativi non e' un dato, e' un caso.
      tiriTot: tiri, passTot: pt, contrTot: tt,
    };
  }

  // Le percentuali si confrontano in PUNTI, non in variazione relativa. Passare dal 7% al
  // 20% e' "+186%" ma sono tredici punti: espresso cosi' dominava ogni sintesi e faceva
  // sembrare straordinario chiunque avesse pochi contrasti tentati e due riusciti.
  const DIM = [
    { k: "voto",         lab: "Voto medio",           f: x => x.toFixed(2) },
    { k: "oscillazione", lab: "Oscillazione del voto",f: x => x.toFixed(2), neutra: true },
    { k: "tiri",         lab: "Tiri a partita",       f: x => x.toFixed(1) },
    { k: "conversione",  lab: "Gol per tiro",         f: x => Math.round(x) + "%", perc: true, minimo: s => s.tiriTot >= 15 },
    { k: "assist",       lab: "Assist a partita",     f: x => x.toFixed(2) },
    { k: "passaggi",     lab: "Passaggi a partita",   f: x => Math.round(x) },
    { k: "precisione",   lab: "Precisione passaggi",  f: x => Math.round(x) + "%", perc: true, minimo: s => s.passTot >= 100 },
    { k: "contrasti",    lab: "Contrasti tentati",    f: x => x.toFixed(1) },
    { k: "riuscita",     lab: "Contrasti riusciti",   f: x => Math.round(x) + "%", perc: true, minimo: s => s.contrTot >= 25 },
    { k: "motm",         lab: "Migliore in campo",    f: x => Math.round(x) + "%", perc: true },
  ];

  const METRI = [
    { id: "reparto", lab: "vs il proprio reparto" },
    { id: "rosa",    lab: "vs tutta la rosa" },
    { id: "tempo",   lab: "vs sé stesso nel tempo" },
  ];
  const MIN_RIGHE = 5;
  // Presenze minime in un reparto alternativo perche' il confronto con il ruolo abituale
  // significhi qualcosa. Sotto, la voce lo dichiara invece di tacere.
  const MIN_CONFRONTO_REPARTO = 3;
  // Per le percentuali calcolate sulle partite - vittorie con e senza un giocatore - la
  // riduzione verso la media deve essere piu' forte che per le medie voto: un esito e'
  // binario e oscilla molto di piu'. Con 6 partite il valore conta per un terzo.
  const CREDIBILITA_PARTITE = 12;
  const FINESTRA = 10;   // quante partite recenti guarda il metro "nel tempo"

  const giocatori = Object.values(raccolta).filter(a => a.righe.length >= MIN_RIGHE)
    .map(a => ({ ...a, s: sintesi(a.righe),
      gruppo: (() => {
        const c = {}; a.righe.forEach(r => { if(r.gruppo) c[r.gruppo] = (c[r.gruppo] || 0) + 1; });
        return Object.entries(c).sort((x, y) => y[1] - x[1])[0]?.[0];
      })() }))
    .sort((a, b) => b.s.n - a.s.n);

  if(giocatori.length === 0){
    curiositaEl.innerHTML = `<div class="empty">Servono almeno ${MIN_RIGHE} partite archiviate per giocatore.</div>`;
    metroEl.remove(); listaEl.remove();
    return;
  }

  let metro = "reparto";
  let scelto = giocatori[0].nome;

  function riferimento(g){
    if(metro === "tempo"){
      if(g.righe.length < MIN_RIGHE * 2) return null;
      const recenti = g.righe.slice(-FINESTRA);
      const prima = g.righe.slice(0, g.righe.length - recenti.length);
      if(prima.length < MIN_RIGHE) return null;
      return { s: sintesi(prima), etichetta: `le sue prime ${prima.length} partite`,
               attuale: sintesi(recenti), etichettaAttuale: `ultime ${recenti.length}` };
    }
    const pool = metro === "reparto"
      ? giocatori.filter(x => x.gruppo === g.gruppo && x.nome !== g.nome)
      : giocatori.filter(x => x.nome !== g.nome);
    if(pool.length === 0) return null;
    const tutte = pool.flatMap(x => x.righe);
    return { s: sintesi(tutte),
             etichetta: metro === "reparto"
               ? `gli altri ${GROUP_LABELS[g.gruppo] ? GROUP_LABELS[g.gruppo].toLowerCase() : "del reparto"} (${pool.length})`
               : `il resto della rosa (${pool.length})`,
             attuale: g.s, etichettaAttuale: "lui" };
  }

  // Quanto e' distante un giocatore dal riferimento, in una misura confrontabile tra
  // indicatori diversi: lo scarto diviso per quanto quell'indicatore varia normalmente
  // nella rosa. Senza, +186% su una percentuale e +40% su un volume finivano nella stessa
  // classifica come se volessero dire la stessa cosa.
  const dispersione = {};
  DIM.forEach(d => {
    const v = giocatori.map(g => g.s[d.k]).filter(x => isFinite(x));
    const m = v.reduce((a, b) => a + b, 0) / Math.max(v.length, 1);
    dispersione[d.k] = Math.sqrt(v.reduce((t, x) => t + (x - m) ** 2, 0) / Math.max(v.length, 1)) || 1;
  });

  // Oltre il raddoppio la variazione percentuale smette di comunicare: "+206%" sembra un
  // errore di calcolo, mentre 9.7 contro 3.2 e' semplicemente il triplo. Sopra il 100% si
  // scrive quindi come moltiplicatore. Le percentuali vere (precisione, conversione) non
  // c'entrano: quelle si confrontano in punti e non superano mai i cento.
  function scartoDi(d, suo, base){
    if(d.perc){
      const p = Math.round(suo - base);
      const segno = p > 0 ? "+" : p < 0 ? "−" : "";
      return { valore: suo - base,
               testo: p === 0 ? "uguale"
                    : `${segno}${Math.abs(p)} ${Math.abs(p) === 1 ? "punto" : "punti"}` };
    }
    // Differenza assoluta, nella stessa unita' e con gli stessi decimali del valore
    // mostrato accanto. 9.7 contro 3.2 diventa "+6.5 contrasti": si legge senza doverlo
    // interpretare, e resta leggibile qualunque sia il rapporto. La variazione
    // percentuale su questi numeri produceva "+206%", che sembra un errore di calcolo.
    const diff = suo - base;
    // "Uguale" non vuol dire identico al decimale: vuol dire che la differenza sparisce
    // ai decimali che stiamo mostrando. Scrivere "+0.00" accanto a due 7.33 e' peggio che
    // dire uguale, perche' fa cercare una differenza che nessuno puo' vedere.
    const scritto = d.f(Math.abs(diff));
    return { valore: diff,
             testo: scritto === d.f(0) ? "uguale" : `${diff > 0 ? "+" : "−"}${scritto}` };
  }

  function frase(g, rif){
    if(!rif) return "";
    const scarti = DIM.filter(d => !d.neutra && d.k !== "voto")
      .filter(d => !d.minimo || d.minimo(rif.attuale))
      .map(d => {
        const suo = rif.attuale[d.k], base = rif.s[d.k];
        return { d, s: scartoDi(d, suo, base), forza: (suo - base) / dispersione[d.k] };
      }).sort((a, b) => b.forza - a.forza);
    const forti = scarti.filter(x => x.forza > 0.7).slice(0, 2);
    const deboli = scarti.filter(x => x.forza < -0.7).slice(-2).reverse();
    const dice = a => a.map(x => `<strong>${x.d.lab.toLowerCase()}</strong> (${x.s.testo})`).join(" e ");
    const parti = [];
    if(forti.length) parti.push(`Si distingue per ${dice(forti)}`);
    if(deboli.length) parti.push(`resta indietro su ${dice(deboli)}`);
    if(parti.length === 0) return `Nessuno scarto rilevante rispetto a ${rif.etichetta}: un profilo in linea.`;
    return parti.join(", ") + ".";
  }

  // ---- Le domande che gli indicatori da soli non rispondono ----
  // Ognuna esce solo se il campione la regge: meglio una scheda con tre voci vere che
  // con otto, di cui cinque calcolate su due partite. La soglia e' scritta accanto a
  // ciascuna, e i numeri piccoli restano visibili ma dichiarati.
  const partitaDi = {};
  (DATA.matches || []).forEach(m => partitaDi[m.match_id] = m);
  const forzaAvversario = id => (DATA.avversari || {})[String(id)]?.skill_rating || 0;
  const nostroLivello = (DATA.latest || {}).skill_rating || 1800;

  function media(v){ return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }

  function curiosita(g){
    const righe = g.righe;
    const voci = [];
    const scheda = (titolo, testo, nota) => voci.push(
      `<div style="padding:10px 0; border-bottom:1px solid var(--panel-2,rgba(255,255,255,.06));">
         <div style="font-size:12px; color:var(--muted); margin-bottom:2px;">${titolo}</div>
         <div style="font-size:13.5px; line-height:1.5;">${testo}</div>
         ${nota ? `<div style="font-size:11px; color:var(--muted); margin-top:2px;">${nota}</div>` : ""}
       </div>`);
    const seg = (n) => n === 1 ? "1 partita" : `${n} partite`;

    // Dove rende di piu'. Il confronto e' ANCORATO al ruolo abituale, cioe' quello con
    // piu' presenze: prima prendeva il migliore contro il peggiore fra tutti i reparti
    // con almeno tre partite, e per chi ha 32 presenze da attaccante finiva a confrontare
    // nove partite a centrocampo con tre da esterno - un paragone tra due eccezioni, che
    // del giocatore non dice niente (segnalato il 24/08/2026).
    const perReparto = {};
    righe.forEach(r => { if(r.gruppo) (perReparto[r.gruppo] = perReparto[r.gruppo] || []).push(r.rating); });
    const reparti = Object.entries(perReparto)
      .map(([k, v]) => ({ k, n: v.length, m: media(v) })).sort((a, b) => b.n - a.n);
    const etichettaReparto = k => (GROUP_LABELS[k] || k);
    if(reparti.length){
      const casa = reparti[0];
      const alternativi = reparti.slice(1).filter(r => r.n >= MIN_CONFRONTO_REPARTO);
      if(alternativi.length){
        // Tra le alternative vince quella con PIU' PARTITE, non quella con lo scarto piu'
        // vistoso. Scegliere lo scarto maggiore riportava il difetto da cui siamo partiti:
        // per Pesix_97 preferiva tre partite da esterno a nove da centrocampista, perche'
        // la differenza era piu' grande - cioe' premiava proprio il campione piu' fragile.
        const alt = alternativi[0];
        const d = alt.m - casa.m;
        scheda("Dove rende di più",
          Math.abs(d) < 0.15
            ? `Rende uguale ovunque: <strong>${casa.m.toFixed(2)}</strong> nel suo ruolo abituale
               (${etichettaReparto(casa.k).toLowerCase()}), <strong>${alt.m.toFixed(2)}</strong> da ${etichettaReparto(alt.k).toLowerCase()}.`
            : `${d > 0 ? "Rende meglio" : "Rende meno"} da <strong>${etichettaReparto(alt.k).toLowerCase()}</strong>
               (${alt.m.toFixed(2)}) che nel suo ruolo abituale di ${etichettaReparto(casa.k).toLowerCase()}
               (${casa.m.toFixed(2)}): <strong>${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(2)}</strong>.`,
          reparti.map(r => `${etichettaReparto(r.k).toLowerCase()} ${seg(r.n)}`).join(" · ") +
          (alt.n < 5 ? ` — attenzione, ${seg(alt.n)} da ${etichettaReparto(alt.k).toLowerCase()} sono poche per un confronto solido` : ""));
      } else {
        // Nessun secondo reparto con abbastanza partite: dirlo e' comunque un fatto utile.
        const altrove = reparti.slice(1).reduce((t, r) => t + r.n, 0);
        scheda("Dove rende di più",
          `Gioca quasi solo da <strong>${etichettaReparto(casa.k).toLowerCase()}</strong>:
           ${seg(casa.n)} lì${altrove ? `, ${seg(altrove)} altrove` : ""}, media
           <strong>${casa.m.toFixed(2)}</strong>. Non c'è un altro reparto con abbastanza
           partite per un confronto.`,
          reparti.length > 1
            ? reparti.map(r => `${etichettaReparto(r.k).toLowerCase()} ${seg(r.n)}`).join(" · ") : null);
      }
    }

    // Se cresce quando la squadra vince o se la tiene su quando perde.
    const inV = righe.filter(r => partitaDi[r.match_id]?.win).map(r => r.rating);
    const inS = righe.filter(r => partitaDi[r.match_id]?.loss).map(r => r.rating);
    if(inV.length >= 5 && inS.length >= 5){
      const d = media(inV) - media(inS);
      scheda("Vittorie e sconfitte",
        d > 0.8 ? `Segue molto l'andamento della squadra: <strong>${media(inV).toFixed(2)}</strong> nelle vittorie
                   contro <strong>${media(inS).toFixed(2)}</strong> nelle sconfitte, ${d.toFixed(2)} di scarto.`
        : d < 0.25 ? `Tiene lo stesso rendimento comunque vada: <strong>${media(inV).toFixed(2)}</strong> nelle
                      vittorie, <strong>${media(inS).toFixed(2)}</strong> nelle sconfitte.`
        : `<strong>${media(inV).toFixed(2)}</strong> nelle vittorie, <strong>${media(inS).toFixed(2)}</strong>
           nelle sconfitte: ${d.toFixed(2)} di scarto.`,
        `${seg(inV.length)} vinte, ${seg(inS.length)} perse`);
    }

    // Contro chi rende. La soglia e' il livello del club, non un numero fisso.
    const forti = righe.filter(r => forzaAvversario(partitaDi[r.match_id]?.opponent_club_id) >= nostroLivello).map(r => r.rating);
    const deboli = righe.filter(r => { const f = forzaAvversario(partitaDi[r.match_id]?.opponent_club_id); return f > 0 && f < nostroLivello; }).map(r => r.rating);
    if(forti.length >= 5 && deboli.length >= 5){
      const d = media(forti) - media(deboli);
      scheda("Contro avversari più forti",
        Math.abs(d) < 0.2
          ? `Non cambia: <strong>${media(forti).toFixed(2)}</strong> contro chi è più forte del club,
             <strong>${media(deboli).toFixed(2)}</strong> contro chi è più debole.`
          : d > 0
            ? `Sale nelle partite difficili: <strong>${media(forti).toFixed(2)}</strong> contro i più forti,
               <strong>${media(deboli).toFixed(2)}</strong> contro i più deboli.`
            : `Rende meno quando l'avversario è forte: <strong>${media(forti).toFixed(2)}</strong> contro
               <strong>${media(deboli).toFixed(2)}</strong>, ${Math.abs(d).toFixed(2)} in meno.`,
        `${seg(forti.length)} contro squadre sopra ${nostroLivello} di skill rating, ${seg(deboli.length)} sotto`);
    }

    // QUI C'ERA "Come regge la serata": prime due partite contro dalla quinta in poi.
    // Tolta il 24/08/2026 perche' misurava rumore. Tre misure, in ordine di gravita':
    //
    //  1. il confronto era sbilanciato. La quinta partita esiste solo nelle serate lunghe
    //     (7 su 10), mentre "inizio serata" pescava da tutte e dieci: due popolazioni
    //     diverse. Calcolandolo DENTRO ogni serata, quattro giudizi su dieci cambiavano e
    //     due invertivano il segno;
    //  2. anche corretto non si confermava: prime cinque serate contro ultime cinque,
    //     affidabilita' +0.13 su sei giocatori. Uno passava da +0.92 a -0.20;
    //  3. non esiste nemmeno per la squadra: pendenza +0.013 voto per partita, e
    //     rimescolando le posizioni a caso il valore esce piu' estremo nel 70% dei casi.
    //
    // La scheda pero' una risposta la dava, con due decimali. Rifarla non serve finche'
    // l'archivio non raddoppia: la misura si rifa' con `python3 affidabilita.py --serata`.

    // Quanto la squadra dipende da lui. Serve un numero decente di partite senza.
    const suoi = new Set(righe.map(r => r.match_id));
    const con = (DATA.matches || []).filter(m => suoi.has(m.match_id));
    const senza = (DATA.matches || []).filter(m => !suoi.has(m.match_id));
    if(senza.length >= 5 && con.length >= 5){
      const vinteCon = con.filter(m => m.win).length;
      const vinteSenza = senza.filter(m => m.win).length;
      const pc = 100 * vinteCon / con.length;
      const ps = 100 * vinteSenza / senza.length;
      // Le percentuali mostrate sono quelle vere, con accanto i conteggi che ne rendono
      // evidente la solidita'. Il GIUDIZIO invece usa valori tirati verso la media della
      // squadra in proporzione alle partite: su sei assenze un 50% e' tre vittorie su
      // sei, cioe' un caso, e senza correzione diventava "la squadra va peggio senza".
      const tutte = DATA.matches || [];
      const mediaClub = tutte.length ? 100 * tutte.filter(m => m.win).length / tutte.length : 50;
      const verso = (perc, n) => {
        const c = n / (n + CREDIBILITA_PARTITE);
        return c * perc + (1 - c) * mediaClub;
      };
      const d = verso(pc, con.length) - verso(ps, senza.length);
      const conta = (v, n) => `${v} ${v === 1 ? "vittoria" : "vittorie"} su ${n}`;
      scheda("Con lui e senza di lui",
        Math.abs(d) < 5
          ? `Nessuna differenza rilevabile: <strong>${Math.round(pc)}%</strong> di vittorie quando c'è
             (${conta(vinteCon, con.length)}), <strong>${Math.round(ps)}%</strong> quando non c'è
             (${conta(vinteSenza, senza.length)}).`
          : `La squadra vince il <strong>${Math.round(pc)}%</strong> quando c'è
             (${conta(vinteCon, con.length)}) e il <strong>${Math.round(ps)}%</strong> quando non c'è
             (${conta(vinteSenza, senza.length)}): ${d > 0 ? "con lui va meglio" : "senza di lui va meglio"},
             di circa <strong>${Math.abs(Math.round(d))} punti</strong> una volta tenuto conto di
             quante partite reggono il confronto.`,
        senza.length < 12
          ? `Solo ${seg(senza.length)} senza di lui: il confronto è indicativo, non una conclusione.`
          : null);
    }

    // Quanta parte dei gol passa da lui.
    const contributi = righe.reduce((t, r) => t + (r.goals || 0) + (r.assists || 0), 0);
    const golSquadra = [...suoi].reduce((t, id) => t + (partitaDi[id]?.goals_for || 0), 0);
    if(golSquadra > 0){
      scheda("Quota nei gol",
        `Partecipa al <strong>${Math.round(100 * contributi / golSquadra)}%</strong> dei gol segnati dal club
         nelle partite che gioca: ${contributi} tra gol e assist su ${golSquadra}.`);
    }

    // Estremi: due partite concrete valgono piu' di una media.
    const migliore = righe.reduce((a, b) => (b.rating > a.rating ? b : a));
    const peggiore = righe.reduce((a, b) => (b.rating < a.rating ? b : a));
    const nome = id => partitaDi[id]?.opponent_name || "—";
    scheda("I due estremi",
      `Meglio: <strong>${migliore.rating.toFixed(1)}</strong> contro ${nome(migliore.match_id)}
       (${migliore.goals || 0} gol, ${migliore.assists || 0} assist). Peggio:
       <strong>${peggiore.rating.toFixed(1)}</strong> contro ${nome(peggiore.match_id)}.`);

    // Forma: le ultime cinque contro la sua media.
    if(righe.length >= 12){
      const ultime = righe.slice(-5).map(r => r.rating);
      const d = media(ultime) - g.s.voto;
      scheda("Come sta adesso",
        `Ultime cinque partite: <strong>${media(ultime).toFixed(2)}</strong> di media, ${d >= 0 ? "+" : ""}${d.toFixed(2)}
         rispetto alla sua media di sempre (${g.s.voto.toFixed(2)}).`);
    }

    if(voci.length === 0) return "";
    return `<div class="panel" style="margin-bottom:12px;">
      <h3 style="margin:0 0 4px; font-size:15px;">Cosa dicono i dati su ${g.nome}</h3>
      ${voci.join("")}
    </div>`;
  }

  function disegna(){
    metroEl.innerHTML = METRI.map(m =>
      `<span class="filter-btn ${m.id === metro ? "active" : ""}" data-m="${m.id}">${m.lab}</span>`).join("");
    metroEl.querySelectorAll(".filter-btn").forEach(b =>
      b.addEventListener("click", () => { metro = b.dataset.m; disegna(); }));

    listaEl.innerHTML = giocatori.map(g =>
      `<span class="filter-btn ${g.nome === scelto ? "active" : ""}" data-n="${g.nome}">${g.nome}
       <span style="opacity:.65;">${g.s.n}</span></span>`).join("");
    listaEl.querySelectorAll(".filter-btn").forEach(b =>
      b.addEventListener("click", () => { scelto = b.dataset.n; disegna(); }));

    const g = giocatori.find(x => x.nome === scelto) || giocatori[0];
    const rif = riferimento(g);

    // Le curiosita' non dipendono dal metro scelto: parlano del giocatore e basta. Stanno
    // percio' sopra, e i tre metri di confronto sotto, accanto alla tabella che governano.
    curiositaEl.innerHTML = curiosita(g);

    if(!rif){
      confrontoEl.innerHTML = `<div class="panel"><div class="empty">
        ${metro === "tempo"
          ? `Servono almeno ${MIN_RIGHE * 2} partite archiviate per confrontare ${g.nome} con sé stesso: ne ha ${g.s.n}.`
          : `Nessun altro giocatore nel reparto di ${g.nome} con cui confrontarlo.`}
      </div></div>`;
      return;
    }

    const righe = DIM.map(d => {
      const suo = rif.attuale[d.k], base = rif.s[d.k];
      const sc = scartoDi(d, suo, base);
      const forza = (suo - base) / dispersione[d.k];
      const scarso = d.minimo && !d.minimo(rif.attuale);
      const col = d.neutra || Math.abs(forza) < 0.4 ? "var(--muted)"
                : forza > 0 ? "var(--ok,#4ade80)" : "var(--accent)";
      const larghezza = Math.min(100, Math.abs(forza) * 45);
      return `<tr>
        <td data-label="Indicatore">${d.lab}${d.neutra ? ` <span style="color:var(--muted); font-size:11px;">(né bene né male)</span>` : ""}</td>
        <td data-label="${rif.etichettaAttuale}" class="lb-value">${d.f(suo)}${scarso ? ` <span style="color:var(--muted); font-size:11px;" title="Troppi pochi tentativi perché la percentuale significhi qualcosa">·  pochi dati</span>` : ""}</td>
        <td data-label="Riferimento" style="color:var(--muted);">${d.f(base)}</td>
        <td data-label="Scarto">
          <span style="color:${col}; font-size:12px;">${sc.testo}</span>
          <div style="height:4px; border-radius:2px; background:${col}; opacity:.5; width:${larghezza}%; margin-top:3px;"></div>
        </td>
      </tr>`;
    }).join("");

    confrontoEl.innerHTML = `<div class="panel">
      <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:baseline; margin-bottom:6px;">
        <strong style="font-size:17px;">${g.nome}</strong>
        <span style="font-size:12px; color:var(--muted);">${GROUP_LABELS[g.gruppo] || "—"} · ${g.s.n} partite in archivio</span>
      </div>
      <div style="font-size:13px; line-height:1.6; margin-bottom:14px;">${frase(g, rif)}</div>
      <div style="font-size:12px; color:var(--muted); margin-bottom:10px;">
        Confronto con ${rif.etichetta}.${g.s.n < 15 ? ` Campione ridotto: con ${g.s.n} partite qualche scarto può essere casuale.` : ""}
      </div>
      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Indicatore</th><th>${rif.etichettaAttuale}</th><th>Riferimento</th><th>Scarto</th></tr></thead>
          <tbody>${righe}</tbody>
        </table>
      </div>
    </div>`;
  }
  disegna();
})();

// ---- Serate ----
// Le serate arrivano gia' raggruppate da Python (stessa regola di serata.py); qui si
// ricostruisce il resto dai dati che la pagina ha comunque, senza duplicare niente.
(function renderSerate(){
  const filtriEl = document.getElementById("serateFiltri");
  const detEl = document.getElementById("serataDettaglio");
  if(!filtriEl || !detEl) return;
  const serate = DATA.serate || [];
  if(serate.length === 0){
    detEl.innerHTML = '<div class="empty">Nessuna serata in archivio.</div>';
    filtriEl.remove();
    return;
  }

  const matchById = new Map((DATA.matches || []).map(m => [m.match_id, m]));
  const storico = (DATA.history || [])
    .map(h => ({ t: new Date(h.fetched_at).getTime(), v: h.skill_rating }))
    .filter(h => !isNaN(h.t) && h.v != null)
    .sort((a, b) => a.t - b.t);

  const soloOra = iso => new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

  // Una sessione che scavalca la mezzanotte porta la data del giorno in cui e' cominciata,
  // ma finisce il giorno dopo. Senza dirlo, due schede dello stesso giorno sembravano
  // separate da pochi minuti quando in mezzo c'erano ventun ore: il 04/08/2026 una serata
  // finiva "alle 01:04" e l'altra cominciava "alle 01:11", su due notti diverse.
  // Una sessione cominciata dopo mezzanotte porta l'etichetta della sera precedente, ma
  // le partite sono state giocate il giorno dopo: la dicitura lo dice per esteso, cosi'
  // l'etichetta e gli orari non sembrano contraddirsi.
  const quando = s => s.notte
    ? `notte fra il ${s.giorno} e il ${s.giornoInizio}, dalle ${s.inizio} alle ${s.fine}`
    : (s.giornoFine && s.giornoFine !== s.giornoInizio
        ? `dalle ${s.inizio} alle ${s.fine} del ${s.giornoFine}`
        : `dalle ${s.inizio} alle ${s.fine}`);

  // Lo skill rating non viene rilevato a ogni partita ma a ogni giro riuscito. Per la
  // serata si prende l'ultimo valore noto PRIMA che cominciasse e l'ultimo prima che
  // cominci la serata successiva.
  //
  // Non il primo valore dopo l'ultima partita: EA pubblica in ritardo, quindi il rating
  // continua a muoversi anche dopo che avete spento. La sera del 23/08/2026 il rilevamento
  // subito dopo l'ultima partita diceva 1883, e cinque minuti dopo - registrata la settima
  // partita - 1892. Fermarsi al primo valore avrebbe attribuito alla serata nove punti in
  // meno di quelli che ha prodotto.
  function variazione(partite, limite){
    const t0 = new Date(partite[0].played_at).getTime();
    const t1 = new Date(partite[partite.length - 1].played_at).getTime();
    const prima = storico.filter(h => h.t <= t0).pop();
    const dopo = storico.filter(h => h.t >= t1 && h.t < limite).pop();
    if(!prima || !dopo) return null;
    return { da: prima.v, a: dopo.v, delta: dopo.v - prima.v };
  }

  function scheda(s, limite){
    const partite = s.matchIds.map(id => matchById.get(id)).filter(Boolean);
    if(partite.length === 0) return '<div class="empty">Partite non disponibili.</div>';
    let v = 0, n = 0, gf = 0, gs = 0;
    partite.forEach(m => {
      gf += m.goals_for || 0; gs += m.goals_against || 0;
      if(m.goals_for > m.goals_against) v++; else if(m.goals_for === m.goals_against) n++;
    });
    const p = partite.length - v - n;

    const agg = {};
    partite.forEach(m => {
      (DATA.matchPlayers[m.match_id] || []).forEach(x => {
        const a = agg[x.player_name] = agg[x.player_name] ||
          { nome: x.player_name, n: 0, somma: 0, gol: 0, ass: 0, mom: 0, gruppi: {} };
        a.n++; a.somma += x.rating || 0; a.gol += x.goals || 0;
        a.ass += x.assists || 0; a.mom += x.mom || 0;
        const g = ROLE_EXCEPTIONS[m.match_id + "|" + x.player_name]
               || groupForMatch(x.player_name, x.pos);
        if(g) a.gruppi[g] = (a.gruppi[g] || 0) + 1;
      });
    });
    const giocatori = Object.values(agg).map(a => ({ ...a, media: a.somma / a.n }))
      .sort((x, y) => y.media - x.media);

    const sr = variazione(partite, limite);
    const srHtml = sr
      ? `<span style="color:${sr.delta > 0 ? "var(--ok,#4ade80)" : sr.delta < 0 ? "var(--accent)" : "var(--muted)"};">
           ${sr.da} → ${sr.a} (${sr.delta > 0 ? "+" : ""}${sr.delta})</span>`
      : `<span style="color:var(--muted);">variazione non rilevata</span>`;

    const badge = s.daConfermare
      ? `<span style="font-size:11px; color:var(--muted); border:1px solid var(--border); border-radius:4px; padding:2px 7px; margin-left:8px;">ruoli da confermare</span>`
      : "";

    const esito = m => m.goals_for > m.goals_against ? ["V", "var(--ok,#4ade80)"]
                     : m.goals_for === m.goals_against ? ["P", "var(--muted)"]
                     : ["S", "var(--accent)"];

    return `
      <div class="panel" style="margin-bottom:12px;">
        <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:baseline; margin-bottom:10px;">
          <strong style="font-size:16px;">${s.giorno}</strong>
          <span style="font-size:12px; color:var(--muted);">${quando(s)}</span>
          ${badge}
        </div>
        ${s.inizioIncerto ? `<div style="font-size:12px; color:var(--muted); margin:-4px 0 12px; line-height:1.5;">
          È la prima serata dell'archivio, e quasi certamente non è intera: le partite giocate prima
          non sono mai state catturate, perché EA ne espone solo dieci alla volta e la raccolta è
          cominciata dopo.</div>` : ""}
        <div style="display:flex; flex-wrap:wrap; gap:18px; font-size:13px; margin-bottom:14px;">
          <span><strong>${partite.length}</strong> partite</span>
          <span><strong>${v}</strong>V <strong>${n}</strong>P <strong>${p}</strong>S</span>
          <span>${gf} gol fatti, ${gs} subiti</span>
          <span>Skill rating: ${srHtml}</span>
        </div>
        <div class="table-wrap" style="margin-bottom:14px;">
          <table class="responsive-table">
            <thead><tr><th>Ora</th><th>Avversario</th><th>Risultato</th><th>Esito</th></tr></thead>
            <tbody>${partite.map(m => {
              const [e, c] = esito(m);
              return `<tr>
                <td data-label="Ora">${soloOra(m.played_at)}</td>
                <td data-label="Avversario">${m.opponent_name || "—"}</td>
                <td data-label="Risultato" class="lb-value">${m.goals_for}-${m.goals_against}</td>
                <td data-label="Esito"><span style="color:${c}; font-weight:600;">${e}</span></td>
              </tr>`;
            }).join("")}</tbody>
          </table>
        </div>
        <div class="table-wrap">
          <table class="responsive-table">
            <thead><tr>
              <th>Giocatore</th><th>Reparto</th><th>Presenze</th><th>Media voto</th>
              <th>Gol</th><th>Assist</th><th>MOTM</th>
            </tr></thead>
            <tbody>${giocatori.map(a => {
              const rep = Object.entries(a.gruppi).sort((x, y) => y[1] - x[1])
                .map(([g, q]) => (GROUP_LABELS[g] || g) + (Object.keys(a.gruppi).length > 1 ? ` ${q}` : ""))
                .join(", ");
              return `<tr>
                <td data-label="Giocatore"><span class="player-link" data-player="${a.nome}">${a.nome}</span></td>
                <td data-label="Reparto" style="color:var(--muted); font-size:12px;">${rep || "—"}</td>
                <td data-label="Presenze">${a.n}</td>
                <td data-label="Media voto" class="lb-value">${a.media.toFixed(2)}</td>
                <td data-label="Gol">${a.gol}</td>
                <td data-label="Assist">${a.ass}</td>
                <td data-label="MOTM">${a.mom || "—"}</td>
              </tr>`;
            }).join("")}</tbody>
          </table>
        </div>
      </div>`;
  }

  // Un bottone per GIORNO, non per sessione. Capita di giocare il pomeriggio e poi la
  // sera - il 18/08/2026 e' successo - e quelle restano due serate distinte nei conti,
  // ma due bottoni con la stessa data addosso sono solo fastidiosi da guardare. Il
  // giorno con due sessioni mostra semplicemente due schede, che si distinguono da sole
  // perche' ognuna dichiara i propri orari.
  const giorni = [];
  serate.forEach(s => {
    const g = giorni.find(x => x.giorno === s.giorno);
    if(g) g.sessioni.push(s);
    else giorni.push({ giorno: s.giorno, sessioni: [s] });
  });

  const limiteDi = s => {
    const i = serate.findIndex(x => x.chiave === s.chiave);
    const prossima = serate[i - 1];   // l'elenco e' dal piu' recente: la successiva e' prima
    return prossima
      ? new Date(matchById.get(prossima.matchIds[0]).played_at).getTime()
      : Infinity;
  };

  let scelto = giorni[0].giorno;
  function disegna(){
    filtriEl.innerHTML = giorni.map(g => {
      const partite = g.sessioni.reduce((n, s) => n + s.matchIds.length, 0);
      const doppia = g.sessioni.length > 1
        ? `<span style="opacity:.65;"> · ${g.sessioni.length} sessioni</span>` : "";
      return `<span class="filter-btn ${g.giorno === scelto ? "active" : ""}" data-g="${g.giorno}">${g.giorno}
        <span style="opacity:.65;">${partite}</span>${doppia}</span>`;
    }).join("");
    filtriEl.querySelectorAll(".filter-btn").forEach(b =>
      b.addEventListener("click", () => { scelto = b.dataset.g; disegna(); }));
    const g = giorni.find(x => x.giorno === scelto) || giorni[0];
    detEl.innerHTML = g.sessioni.map(s => scheda(s, limiteDi(s))).join("");
  }
  disegna();
})();

(function renderMatches(){
  const tbody = document.querySelector("#matchesTable tbody");
  const matches = DATA.matches || [];
  if(matches.length === 0){
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Nessuna partita nel database</td></tr>`;
    return;
  }
  const rowsHtml = [];
  matches.forEach((m, i) => {
    const outcome = m.win ? "W" : (m.tie ? "T" : "L");
    const outcomeLabel = m.win ? "Vittoria" : (m.tie ? "Pareggio" : "Sconfitta");
    rowsHtml.push(`
      <tr class="match-row" data-idx="${i}">
        <td data-label="Data">${fmtDate(m.played_at)}</td>
        <td data-label="Tipo" class="pos-badge">${m.match_type}</td>
        <td data-label="Avversario">${m.opponent_name || "-"}</td>
        <td data-label="Risultato">${m.goals_for} - ${m.goals_against}</td>
        <td data-label="Esito"><span class="badge ${outcome}">${outcomeLabel}</span></td>
      </tr>
      <tr class="match-detail" id="detail-${i}">
        <td colspan="5"><div class="inner"></div></td>
      </tr>
    `);
  });
  tbody.innerHTML = rowsHtml.join("");

  document.querySelectorAll(".match-row").forEach(row => {
    row.addEventListener("click", () => {
      const idx = row.dataset.idx;
      const detailRow = document.getElementById(`detail-${idx}`);
      const isOpen = detailRow.classList.contains("open");
      document.querySelectorAll(".match-detail").forEach(d => d.classList.remove("open"));
      if(!isOpen){
        const match = matches[idx];
        const players = DATA.matchPlayers[match.match_id] || [];
        const inner = detailRow.querySelector(".inner");
        if(players.length === 0){
          inner.innerHTML = '<span class="empty">Nessun dettaglio giocatori disponibile</span>';
        } else {
          inner.innerHTML = `
            <table>
              <thead><tr><th>Giocatore</th><th>Ruolo</th><th>Gol</th><th>Assist</th><th>Rating</th><th>Tiri</th><th>Passaggi</th><th>Contrasti</th><th>Parate</th><th>Minuti</th></tr></thead>
              <tbody>
                ${players.map(p => `
                  <tr>
                    <td>${p.player_name}${p.mom ? " ⭐" : ""}</td>
                    <td class="pos-badge">${p.pos}</td>
                    <td>${p.goals}</td>
                    <td>${p.assists}</td>
                    <td>${p.rating}</td>
                    <td>${p.shots}</td>
                    <td>${p.passes_made}/${p.pass_attempts}</td>
                    <td>${p.tackles_made}/${p.tackle_attempts}</td>
                    <td>${p.saves || 0}</td>
                    <td>${p.seconds_played ? Math.round(p.seconds_played/60) + "'" : "-"}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          `;
        }
        detailRow.classList.add("open");
      }
    });
  });
})();

// ---- Traguardi/achievement: soglie assolute sulle statistiche di un giocatore ----
const ACHIEVEMENT_TIERS = [
  { key: "games_played", icon: "🏛️", suffix: "presenze", tiers: [[500,"Leggenda"],[300,"Veterano"],[100,"Habitué"]] },
  { key: "goals", icon: "💣", suffix: "gol", tiers: [[200,"Bomber"],[100,"Cecchino"],[50,"Marcatore"]] },
  { key: "assists", icon: "🎁", suffix: "assist", tiers: [[100,"Regista"],[50,"Rifinitore"]] },
  { key: "man_of_the_match", icon: "🌟", suffix: "MOTM", tiers: [[50,"Fenomeno"],[20,"Trascinatore"]] },
];
function getAchievements(r){
  const badges = [];
  ACHIEVEMENT_TIERS.forEach(({key, icon, suffix, tiers}) => {
    const v = r[key] || 0;
    const hit = tiers.find(([min]) => v >= min);
    if(hit) badges.push({ icon, label: `${hit[1]} (${hit[0]}+ ${suffix})` });
  });
  if(r.pass_success_rate >= 82) badges.push({ icon: "📡", label: `Metronomo (${r.pass_success_rate}% passaggi)` });
  if(r.tackle_success_rate >= 48) badges.push({ icon: "🛡️", label: `Muro (${r.tackle_success_rate}% contrasti)` });
  if(r.shot_success_rate >= 48) badges.push({ icon: "🏹", label: `Preciso (${r.shot_success_rate}% tiro)` });
  if(r.clean_sheets_gk >= 5) badges.push({ icon: "🧤", label: `Portiere insuperabile (${r.clean_sheets_gk} clean sheet)` });
  if(r.clean_sheets_def >= 5) badges.push({ icon: "🧱", label: `Baluardo difensivo (${r.clean_sheets_def} clean sheet)` });
  if(r.win_rate >= 60) badges.push({ icon: "🍀", label: `Portafortuna (${r.win_rate}% vittorie)` });
  if(r.red_cards >= 5) badges.push({ icon: "🟥", label: `Testa calda (${r.red_cards} rossi)` });
  return badges;
}

// ---- Card giocatore (modal con tutte le statistiche) ----
function closePlayerCard(){
  document.getElementById("playerModalOverlay").classList.remove("open");
}
function openPlayerCard(name){
  const r = (DATA.roster || []).find(p => p.player_name === name);
  if(!r) return;

  const powerEntry = POWER_SCORE_BY_NAME.get(name);
  const nationalityStr = r.pro_nationality ? `Nazionalità #${r.pro_nationality}` : null;
  const heightStr = r.pro_height ? `${r.pro_height} cm` : null;
  const subParts = [r.pro_name && r.pro_name !== r.player_name ? `"${r.pro_name}"` : null, heightStr, nationalityStr].filter(Boolean);

  const stats = [
    ["Partite", r.games_played], ["Win %", r.win_rate + "%"], ["Media voto", r.rating_ave],
    ["Gol", r.goals], ["Assist", r.assists], ["MOTM", r.man_of_the_match],
    ["Passaggi", r.passes_made], ["% Passaggi", r.pass_success_rate + "%"], ["% Contrasti", r.tackle_success_rate + "%"],
    ["Contrasti", r.tackles_made], ["% Tiro", r.shot_success_rate + "%"], ["Cartellini rossi", r.red_cards],
  ];
  if(r.clean_sheets_gk > 0) stats.push(["Clean sheet (POR)", r.clean_sheets_gk]);
  if(r.clean_sheets_def > 0) stats.push(["Clean sheet (DIF)", r.clean_sheets_def]);

  const achievements = getAchievements(r);

  // ultime partite di questo giocatore, dalle più recenti (DATA.matches è già ordinato ts DESC)
  const recentMatches = [];
  for(const m of (DATA.matches || [])){
    const players = DATA.matchPlayers[m.match_id] || [];
    const p = players.find(pl => pl.player_name === name);
    if(p){
      recentMatches.push({ match: m, p });
      if(recentMatches.length >= 5) break;
    }
  }

  const modal = document.getElementById("playerModal");
  modal.innerHTML = `
    <div class="pm-head">
      <div>
        <div class="pm-name">${r.player_name}</div>
        ${subParts.length ? `<div class="pm-sub">${subParts.join(" · ")}</div>` : ""}
        <div class="pm-badges">
          ${gruppoBadge(r.gruppo, r.gruppo_da_assegnare)}
          ${r.pro_overall ? `<span class="pm-ovr">OVR ${r.pro_overall}</span>` : ""}
          ${powerEntry ? `<span class="pm-ovr">💪 Indice ${powerEntry.score.toFixed(1)}</span>` : ""}
        </div>
        <div class="role-split">
          ${r.role_from_matches
            ? Object.entries(r.role_counts).sort((a,b) => b[1]-a[1]).map(([pos, n]) =>
                `<span class="rs"><b>${ROLE_LABELS[pos] || pos}</b> ${n} pt</span>`).join("")
              + (r.favorite_position && r.favorite_position !== r.role_effective
                  ? `<span class="rs">ruolo EA: ${ROLE_LABELS[r.favorite_position] || r.favorite_position}</span>` : "")
            : `<span class="rs">ruolo EA: ${ROLE_LABELS[r.favorite_position] || r.favorite_position || "-"} · nessuna partita archiviata</span>`}
        </div>
      </div>
      <button class="pm-close" id="pmCloseBtn" aria-label="Chiudi">✕</button>
    </div>
    <div class="pm-stats-grid">
      ${stats.map(([k,v]) => `<div class="pm-stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("")}
    </div>
    <div class="pm-section-title">Traguardi</div>
    <div class="pm-achievements">
      ${achievements.length === 0 ? '<div class="empty">Nessun traguardo raggiunto ancora.</div>' : achievements.map(a => `<span class="pm-badge">${a.icon} ${a.label}</span>`).join("")}
    </div>
    <div class="pm-section-title">Forma (gol ultime partite)</div>
    ${sparkline((r.prev_goals_trend||[]).slice().reverse())}
    <div class="pm-section-title">Ultime partite giocate</div>
    <div class="pm-matches">
      ${recentMatches.length === 0 ? '<div class="empty">Nessun dettaglio partita disponibile per questo giocatore.</div>' : recentMatches.map(({match, p}) => `
        <div class="pm-match-row">
          <span class="pm-opp">${fmtDate(match.played_at)} vs ${match.opponent_name || "?"}${p.mom ? " ⭐" : ""}</span>
          <span class="pm-stat-mini">${p.goals}g ${p.assists}a · ${p.rating}</span>
        </div>
      `).join("")}
    </div>
  `;
  modal.querySelector("#pmCloseBtn").addEventListener("click", closePlayerCard);
  document.getElementById("playerModalOverlay").classList.add("open");
}

document.addEventListener("click", (e) => {
  const link = e.target.closest(".player-link");
  if(link){
    openPlayerCard(link.dataset.player);
    return;
  }
  if(e.target.id === "playerModalOverlay"){
    closePlayerCard();
  }
});
document.addEventListener("keydown", (e) => {
  if(e.key === "Escape") closePlayerCard();
});

// ---- Crest header ----
(function renderCrest(){
  const el = document.getElementById("crestBadge");
  const club = DATA.club || {};
  const initials = (club.name || "?").slice(0, 2).toUpperCase();
  el.style.background = "linear-gradient(145deg, var(--accent), #8a1424)";
  el.textContent = initials;
})();

// ---- Nav: menu a comparsa da sinistra (drawer) + navigazione a pagine ----
// Ogni voce del menu mostra SOLO la propria pagina (le altre sezioni vengono
// nascoste), invece di scorrere una lunga pagina unica. La Home raggruppa
// le sezioni di riepilogo generale (overview, forma, andamento); tutte le
// altre sezioni corrispondono 1:1 a una pagina.
const PAGE_MAP = {
  overview: "home", novita: "home", forma: "home", andamento: "home", condividi: "home",
  rosa: "rosa", crescita: "crescita", classifiche: "classifiche",
  forza: "forza", formazione: "formazione", h2h: "h2h",
  riepilogo: "riepilogo", avversari: "avversari", diagnosi: "diagnosi",
  osservatore: "osservatore", serate: "serate", partite: "partite",
};
const PAGES = [
  { key: "home", icon: "🏠", label: "Home" },
  { key: "rosa", icon: "🧑‍🤝‍🧑", label: "Rosa" },
  { key: "crescita", icon: "📈", label: "Crescita" },
  { key: "classifiche", icon: "📋", label: "Classifiche" },
  { key: "forza", icon: "💪", label: "Indice di Forza" },
  { key: "formazione", icon: "⚽", label: "Formazione" },
  { key: "h2h", icon: "⚔️", label: "Testa a testa" },
  { key: "riepilogo", icon: "🎁", label: "Riepilogo" },
  { key: "avversari", icon: "🆚", label: "Avversari" },
  { key: "diagnosi", icon: "🔍", label: "Vittorie e sconfitte" },
  { key: "osservatore", icon: "🗒️", label: "Scheda osservatore" },
  { key: "serate", icon: "🌙", label: "Serate" },
  { key: "partite", icon: "📅", label: "Partite" },
].filter(p => Object.values(PAGE_MAP).includes(p.key));

function showPage(pageKey){
  if(!PAGES.some(p => p.key === pageKey)) pageKey = "home";
  Object.keys(PAGE_MAP).forEach(sectionId => {
    const el = document.getElementById(sectionId);
    if(!el) return;
    el.classList.toggle("page-hidden", PAGE_MAP[sectionId] !== pageKey);
  });
  document.querySelectorAll("#navLinks a").forEach(l => l.classList.toggle("active", l.dataset.page === pageKey));
  window.scrollTo(0, 0);
  if(location.hash.slice(1) !== pageKey) history.replaceState(null, "", "#" + pageKey);
}

function openDrawer(){
  document.getElementById("sideDrawer").classList.add("open");
  document.getElementById("drawerOverlay").classList.add("open");
}
function closeDrawer(){
  document.getElementById("sideDrawer").classList.remove("open");
  document.getElementById("drawerOverlay").classList.remove("open");
}

(function renderNav(){
  const el = document.getElementById("navLinks");
  el.innerHTML = PAGES.map(p => `<a href="#${p.key}" data-page="${p.key}">${p.icon} ${p.label}</a>`).join("");
  el.querySelectorAll("a").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      showPage(a.dataset.page);
      closeDrawer();
    });
  });

  document.getElementById("hamburgerBtn").addEventListener("click", openDrawer);
  document.getElementById("drawerClose").addEventListener("click", closeDrawer);
  document.getElementById("drawerOverlay").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if(e.key === "Escape") closeDrawer(); });

  window.addEventListener("hashchange", () => showPage(location.hash.slice(1)));
  const initial = location.hash.slice(1);
  showPage(PAGES.some(p => p.key === initial) ? initial : "home");
})();

// ---- Back to top ----
(function backToTop(){
  const btn = document.getElementById("backToTop") || (() => {
    const b = document.createElement("button");
    b.id = "backToTop";
    b.title = "Torna su";
    b.textContent = "↑";
    document.body.appendChild(b);
    return b;
  })();
  window.addEventListener("scroll", () => {
    btn.classList.toggle("show", window.scrollY > 500);
  });
  btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
})();

// ---- Ricerca globale ----
(function globalSearch(){
  const input = document.getElementById("navSearch");
  const results = document.getElementById("navSearchResults");

  function jumpToPlayer(name){
    closeDrawer();
    showPage("rosa");
    const filterInput = document.getElementById("rosterFilter");
    filterInput.value = name;
    filterInput.dispatchEvent(new Event("input"));
    results.classList.remove("open");
    input.value = "";
  }
  function jumpToMatch(idx){
    closeDrawer();
    showPage("partite");
    setTimeout(() => {
      const row = document.querySelector(`.match-row[data-idx="${idx}"]`);
      if(row){
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        if(!document.getElementById(`detail-${idx}`).classList.contains("open")) row.click();
      }
    }, 200);
    results.classList.remove("open");
    input.value = "";
  }

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if(q.length < 2){ results.classList.remove("open"); return; }

    const players = (DATA.roster || []).filter(r =>
      (r.player_name||"").toLowerCase().includes(q) || (r.pro_name||"").toLowerCase().includes(q)
    ).slice(0, 6);
    const matches = (DATA.matches || []).map((m, i) => ({m, i})).filter(({m}) =>
      (m.opponent_name||"").toLowerCase().includes(q)
    ).slice(0, 6);

    if(players.length === 0 && matches.length === 0){
      results.innerHTML = '<div class="res-empty">Nessun risultato</div>';
    } else {
      let html = "";
      if(players.length){
        html += '<div class="res-group-label">Giocatori</div>';
        html += players.map(r => `<div class="res-item" data-type="player" data-name="${r.player_name}"><span>${r.player_name}</span><span class="res-meta">${r.goals} gol · ${r.games_played} pg</span></div>`).join("");
      }
      if(matches.length){
        html += '<div class="res-group-label">Partite (avversario)</div>';
        html += matches.map(({m, i}) => `<div class="res-item" data-type="match" data-idx="${i}"><span>vs ${m.opponent_name}</span><span class="res-meta">${m.goals_for}-${m.goals_against}</span></div>`).join("");
      }
      results.innerHTML = html;
    }
    results.classList.add("open");
  });

  results.addEventListener("click", (e) => {
    const item = e.target.closest(".res-item");
    if(!item) return;
    if(item.dataset.type === "player") jumpToPlayer(item.dataset.name);
    else if(item.dataset.type === "match") jumpToMatch(item.dataset.idx);
  });

  document.addEventListener("click", (e) => {
    if(!e.target.closest("#navSearchWrap")) results.classList.remove("open");
  });
})();
