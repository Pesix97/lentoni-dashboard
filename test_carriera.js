// La sezione Carriera e il riquadro nella scheda: ogni numero stampato contro un ricalcolo
// fatto qui, dai dati di carriera della pagina.
//
// NATO IL 29/10/2026 insieme alla sezione. Che i dati di ogni titolo siano quelli giusti
// (la lettura con piu' partite, non l'ultima: l'azzeramento di EA del 18/09/2026) lo
// controlla test_pipeline.py, TestCarriera. Qui si controlla il resto: che ogni titolo sia
// stampato com'e', e che il totale sia fatto bene — i conteggi sommati, la media voto e la
// % vittorie pesate sulle partite, non mediate fra i titoli.
//
// Uso:  node test_carriera.js [percorso/index.html]

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
const DATA = JSON.parse(html.slice(ini, ini + html.slice(ini).search(/;\r?\n/)));
const C = DATA.carriera || { titoli: [], giocatori: {} };

// Il riferimento: per ogni giocatore le righe attese, una per titolo e il totale.
function attese(per) {
  const righe = C.titoli.filter(t => per[t]).map(t => ({ eti: t, ...per[t] }));
  if (!righe.length) return [];
  let pg = 0, g = 0, a = 0, motm = 0, voto = 0, vitt = 0;
  for (const r of righe) {
    pg += r.games_played; g += r.goals; a += r.assists; motm += r.man_of_the_match;
    voto += r.rating_ave * r.games_played; vitt += r.win_rate * r.games_played;
  }
  const tot = { eti: "Totale", games_played: pg, goals: g, assists: a, man_of_the_match: motm,
                rating_ave: voto / pg, win_rate: vitt / pg };
  return [tot, ...righe];
}
function testoAtteso(r) {
  return [r.eti, String(r.games_played), String(r.goals), String(r.assists),
    r.games_played ? ((r.goals + r.assists) / r.games_played).toFixed(2) : "—",
    r.rating_ave.toFixed(2), String(r.man_of_the_match), Math.round(r.win_rate) + "%"];
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
  },
});
const T = el => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

(async () => {
  await new Promise(r => setTimeout(r, 1500));
  const w = dom.window, d = w.document;

  // La tabella: una riga per giocatore, il Totale di tutti i titoli per default, un titolo alla
  // volta a scelta; ordinamento, filtro e colonne come in Giocatori.
  const nomi = Object.keys(C.giocatori).filter(n => attese(C.giocatori[n]).length);
  const clic = sel => { const el = d.querySelector(sel); if (el) el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); return !!el; };
  const leggi = () => [...d.querySelectorAll("#carrieraTable tbody tr[data-carriera]")].map(tr => {
    const c = {}; tr.querySelectorAll("td[data-label]").forEach(td => { c[td.dataset.label] = T(td); });
    return { nome: tr.dataset.carriera, c };
  });
  // Il valore atteso di un giocatore nel titolo scelto ("Totale" = attese()[0]).
  const valoreAtteso = (n, titolo) => {
    const a = attese(C.giocatori[n]);
    return titolo === "Totale" ? a[0] : a.find(r => r.eti === titolo) || null;
  };
  const err = { titoli: [], righe: [], celle: [], ordine: [], colonne: [], filtro: [] };
  const titoliStampati = [...d.querySelectorAll("#carrieraTitoli .filter-btn")].map(b => b.dataset.titolo);
  if (titoliStampati.join() !== ["Totale", ...C.titoli].join()) err.titoli.push(`titoli [${titoliStampati}], attesi [Totale,${C.titoli}]`);
  const attivo = d.querySelector("#carrieraTitoli .filter-btn.active");
  if (!attivo || attivo.dataset.titolo !== "Totale") err.titoli.push(`predefinito: ${attivo ? attivo.dataset.titolo : "nessuno"}, atteso Totale`);

  console.log("\nCarriera: la tabella, titolo per titolo e in totale");
  for (const titolo of ["Totale", ...C.titoli]) {
    clic(`#carrieraTitoli [data-titolo="${titolo}"]`);
    const righe = leggi();
    const attesi = nomi.filter(n => valoreAtteso(n, titolo));
    if (righe.map(r => r.nome).sort().join() !== attesi.sort().join()) err.righe.push(`${titolo}: giocatori [${righe.map(r => r.nome)}], attesi [${attesi}]`);
    for (const r of righe) {
      const v = valoreAtteso(r.nome, titolo); if (!v) continue;
      const atteso = { PG: String(v.games_played), Gol: String(v.goals), Assist: String(v.assists), Media: v.rating_ave.toFixed(2) };
      for (const k in atteso) if (r.c[k] !== atteso[k]) err.celle.push(`${titolo} ${r.nome} ${k}: stampato ${r.c[k]}, atteso ${atteso[k]}`);
    }
    // Predefinito: per gol, dal piu' alto.
    const gol = righe.map(r => Number(r.c.Gol));
    if (gol.some((g, i) => i && g > gol[i - 1])) err.ordine.push(`${titolo}: non ordinata per gol (${gol.join(",")})`);
  }
  verifica(`i titoli: Totale (predefinito) e ${C.titoli.join(", ")}`, err.titoli);
  verifica(`in ogni titolo ci sono esattamente i giocatori che l'hanno giocato (${nomi.length} in totale)`, err.righe);
  verifica("PG, gol, assist e media di ogni riga: titoli com'erano, totale sommato e media pesata", err.celle);
  verifica("all'apertura e' ordinata per gol, come Giocatori", err.ordine);

  console.log("\nCarriera: ordinare, aggiungere colonne, filtrare (come Giocatori)");
  clic('#carrieraTitoli [data-titolo="Totale"]');
  const errO = [];
  for (const [chiave, colonna] of [["games_played", "PG"], ["goals", "Gol"], ["assists", "Assist"], ["rating_ave", "Media"]]) {
    clic(`#carrieraQuickFilters [data-key="${chiave}"]`);
    let v = leggi().map(r => Number(r.c[colonna]));
    if (v.some((x, i) => i && x > v[i - 1])) errO.push(`"Ordina per" ${colonna}: non decrescente (${v.join(",")})`);
    clic(`#carrieraHead th[data-key="${chiave}"]`);   // secondo clic: si inverte
    v = leggi().map(r => Number(r.c[colonna]));
    if (v.some((x, i) => i && x < v[i - 1])) errO.push(`secondo clic su ${colonna}: non crescente (${v.join(",")})`);
  }
  verifica("ordina per partite, gol, assist, media; il secondo clic sull'intestazione inverte", errO);
  // Colonne aggiunte, sul Totale: conteggi sommati e percentuali rifatte dai riusciti e dai tentati.
  const stima = (fatti, perc) => (perc > 0 ? fatti / (perc / 100) : 0);
  const atteseExtra = {
    man_of_the_match: n => C.titoli.reduce((t, x) => t + ((C.giocatori[n][x] || {}).man_of_the_match || 0), 0),
    pass_success_rate: n => {
      const r = C.titoli.map(x => C.giocatori[n][x]).filter(Boolean);
      const tent = r.reduce((t, x) => t + stima(x.passes_made, x.pass_success_rate), 0);
      return tent ? r.reduce((t, x) => t + x.passes_made, 0) / tent * 100 : 0;
    },
  };
  for (const [col, f] of Object.entries(atteseExtra)) {
    if (!clic(`#carrieraColonne [data-col="${col}"]`)) { err.colonne.push(`manca il bottone per ${col}`); continue; }
    const th = d.querySelector(`#carrieraHead th[data-key="${col}"]`);
    if (!th) { err.colonne.push(`${col}: colonna non aggiunta`); continue; }
    const eti = [...d.querySelectorAll("#carrieraTable tbody tr[data-carriera]")][0].querySelectorAll("td")[[...th.parentNode.children].indexOf(th)];
    for (const tr of d.querySelectorAll("#carrieraTable tbody tr[data-carriera]")) {
      const testo = T(tr.querySelectorAll("td")[[...th.parentNode.children].indexOf(th)]);
      const att = f(tr.dataset.carriera);
      if (Math.abs(parseFloat(testo) - att) > 0.006) err.colonne.push(`${col} ${tr.dataset.carriera}: stampato ${testo}, atteso ${att.toFixed(2)}`);
    }
    clic(`#carrieraColonne [data-col="${col}"]`);   // e si toglie
    if (d.querySelector(`#carrieraHead th[data-key="${col}"]`)) err.colonne.push(`${col}: tolta, ma la colonna resta`);
  }
  verifica("colonne aggiunte sul Totale (MOTM sommati, % passaggi dai riusciti e dai tentati) e tolte", err.colonne);
  const filtro = d.getElementById("carrieraFilter");
  const scelto = nomi[0];
  filtro.value = scelto.slice(0, 4).toLowerCase(); filtro.dispatchEvent(new w.Event("input"));
  const dopo = leggi().map(r => r.nome);
  if (!dopo.includes(scelto) || dopo.some(n => !n.toLowerCase().includes(filtro.value))) err.filtro.push(`filtro "${filtro.value}": [${dopo}]`);
  filtro.value = ""; filtro.dispatchEvent(new w.Event("input"));
  verifica("il filtro per nome", err.filtro);

  console.log("\nCarriera: il riquadro nella scheda di ogni giocatore");
  const errS = [], errL = [];
  // La scheda si apre se su questa pagina il giocatore ha una rosa o almeno una partita: e il
  // nome deve essere cliccabile esattamente in quel caso, ne' piu' ne' meno.
  const rosa = new Set((DATA.roster || []).map(r => r.player_name));
  const soglia = html.match(/const LEADERBOARD_MIN_GAMES = (\d+);/);
  const inRosa = n => (DATA.roster || []).some(r => r.player_name === n && r.games_played >= Number(soglia ? soglia[1] : 0));
  const conPartite = n => Object.values(DATA.matchPlayers || {}).some(rr => rr.some(p => p.player_name === n));
  let aperte = 0;
  for (const n of nomi) {
    const link = d.querySelector(`#carrieraTable .player-link[data-player="${n}"]`);
    const apribile = inRosa(n) || conPartite(n);
    if (!!link !== apribile) { errL.push(`${n}: ${link ? "cliccabile" : "non cliccabile"}, ma la scheda ${apribile ? "si apre" : "non si apre"}`); }
    if (!link) continue;
    d.getElementById("playerModal").innerHTML = "";
    link.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    if (!T(d.getElementById("playerModal"))) { errS.push(`${n}: cliccato, la scheda non si apre`); continue; }
    aperte++;
    const trs = [...d.querySelectorAll("#playerModal .pm-carriera tbody tr")];
    const att = attese(C.giocatori[n]);
    if (trs.length !== att.length) { errS.push(`${n}: ${trs.length} righe nella scheda, attese ${att.length}`); continue; }
    att.forEach((r, i) => {
      const celle = [...trs[i].querySelectorAll("td")].map(T), atteso = testoAtteso(r);
      if (celle.join(" | ") !== atteso.join(" | ")) errS.push(`${n} ${r.eti}: [${celle.join(" | ")}], atteso [${atteso.join(" | ")}]`);
    });
  }
  verifica("il nome e' cliccabile esattamente quando la scheda si apre", errL);
  verifica(`stesse righe della tabella (${aperte} schede aperte)`, aperte ? errS : ["nessuna scheda aperta"]);

  console.log(falliti === 0 ? "\nLa carriera torna con il ricalcolo." : `\n${falliti} controlli falliti.`);
  process.exit(falliti === 0 ? 0 : 1);
})();
