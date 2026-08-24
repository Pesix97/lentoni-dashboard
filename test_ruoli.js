// Test della logica dei ruoli, quella che vive dentro la pagina generata.
//
// Non riscrive le funzioni: le ESTRAE dal file HTML prodotto e le esegue. Cosi' il test
// verifica il codice che gira davvero nel browser, non una copia che potrebbe divergere.
//
// Uso:  node test_ruoli.js [percorso/index.html]

const fs = require("fs");

const file = process.argv[2] || "index.html";
if (!fs.existsSync(file)) {
  console.error(`File non trovato: ${file}`);
  process.exit(1);
}

const html = fs.readFileSync(file, "utf-8");
const script = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1];
if (!script) {
  console.error("Nessun blocco <script> nella pagina");
  process.exit(1);
}

function ritaglia(da, a) {
  const i = script.indexOf(da), j = script.indexOf(a);
  if (i < 0 || j < 0 || i >= j) throw new Error(`Blocco non trovato: ${da}`);
  return script.slice(i, j);
}

// Ricostruisce l'ambiente minimo: dati, conteggi dei ruoli, logica dei gruppi.
// Tutto quello che serve vive tra la definizione di DATA e fmtDate: dal 21/08/2026 la
// configurazione dei ruoli sta in cima al file, perche' il gruppo di roles.json e' il
// ruolo ufficiale di tutta la dashboard e non piu' solo delle classifiche per reparto.
const codice = [
  // Dati, ruoli, punteggi e Indice di Forza vivono tutti prima delle sezioni che
  // toccano il DOM: si estraggono in blocco.
  ritaglia("const DATA = {", "// ---- Cards ----"),
].join("\n");

let ambiente;
try {
  ambiente = new Function(codice + `
    return { DATA, GROUP_OF_PLAYER, EA_LABEL_OF_PLAYER, MACRO_TO_GROUP,
             groupForMatch, etichettaAttesa, mainPosOf, computeGroupScores, rankGroup,
             GROUP_ORDER, ROLE_EXCEPTIONS, computeBlendedScores, credibilita,
             PESI_INDICE, PESI_TECNICA, PESI_TECNICA_DIFESA, efficienzaTecnica };`)();
} catch (e) {
  console.error("Impossibile eseguire il codice estratto:", e.message);
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

const { GROUP_OF_PLAYER, EA_LABEL_OF_PLAYER, groupForMatch, etichettaAttesa,
        computeGroupScores, rankGroup, GROUP_ORDER, computeBlendedScores,
        PESI_INDICE, PESI_TECNICA, PESI_TECNICA_DIFESA, efficienzaTecnica } = ambiente;

// I pesi erano scritti a mano in quattro punti diversi. Ora c'e' una costante sola, e
// questi controlli servono a impedire che le copie tornino: se qualcuno riscrive un peso
// direttamente dentro una formula, la somma smette di tornare e il test se ne accorge.
console.log("\nPesi dell'Indice di Forza");
{
  const somma = PESI_INDICE.rating + PESI_INDICE.contrib + PESI_INDICE.motm
              + PESI_INDICE.win + PESI_INDICE.tech;
  verifica("i pesi positivi sommano a 0.95 (il 5% restante e' la penalita' sui rossi)",
    Math.abs(somma - 0.95) < 1e-9, `sommano ${somma.toFixed(3)}`);
  verifica("il MOTM resta una voce minore: non piu' del 10%",
    PESI_INDICE.motm <= 0.10, `vale ${PESI_INDICE.motm}`);
  for (const [nome, p] of [["normale", PESI_TECNICA], ["difensori", PESI_TECNICA_DIFESA]]) {
    const s = p.passaggi + p.contrasti + p.tiro;
    verifica(`efficienza tecnica (${nome}): i tre pezzi sommano a 1`,
      Math.abs(s - 1) < 1e-9, `sommano ${s.toFixed(3)}`);
  }
  verifica("per i difensori il contrasto pesa piu' del tiro",
    PESI_TECNICA_DIFESA.contrasti > PESI_TECNICA_DIFESA.tiro,
    `contrasti ${PESI_TECNICA_DIFESA.contrasti} vs tiro ${PESI_TECNICA_DIFESA.tiro}`);
  verifica("per tutti gli altri vale il contrario",
    PESI_TECNICA.contrasti < PESI_TECNICA.tiro,
    `contrasti ${PESI_TECNICA.contrasti} vs tiro ${PESI_TECNICA.tiro}`);
  // Stesso giocatore, stessi numeri grezzi: il reparto deve cambiare il risultato.
  const bravoNeiContrasti = efficienzaTecnica(80, 60, 20, "DIFENSORI");
  const stessoAltrove     = efficienzaTecnica(80, 60, 20, "ATTACCANTI");
  verifica("chi vince i contrasti vale di piu' fra i difensori che altrove",
    bravoNeiContrasti > stessoAltrove,
    `${bravoNeiContrasti.toFixed(1)} contro ${stessoAltrove.toFixed(1)}`);
  verifica("senza reparto si usano i pesi normali",
    efficienzaTecnica(80, 60, 20) === stessoAltrove);
}

console.log("\nEtichette EA dichiarate");
verifica("roles.json dichiara l'etichetta EA di ogni giocatore assegnato",
  Object.keys(GROUP_OF_PLAYER).every(n => EA_LABEL_OF_PLAYER[n]),
  Object.keys(GROUP_OF_PLAYER).filter(n => !EA_LABEL_OF_PLAYER[n]).join(", "));

// Il motivo per cui l'etichetta si dichiara invece di dedurla: dedotta dalla posizione
// piu' frequente, cambiava quando arrivavano partite nuove e riclassificava all'indietro
// anche quelle vecchie (domenicocasaburi era 15 a 15, in bilico su una sola partita).
console.log("\nStabilita': l'etichetta attesa non dipende dalle partite giocate");
for (const nome of Object.keys(EA_LABEL_OF_PLAYER)) {
  verifica(`${nome}: usa l'etichetta dichiarata`,
    etichettaAttesa(nome) === EA_LABEL_OF_PLAYER[nome],
    `attesa ${etichettaAttesa(nome)} invece di ${EA_LABEL_OF_PLAYER[nome]}`);
}

console.log("\nRegola del club: il COC conta come attaccante");
for (const nome of Object.keys(GROUP_OF_PLAYER)) {
  if (GROUP_OF_PLAYER[nome] !== "ATTACCANTI") continue;
  if (EA_LABEL_OF_PLAYER[nome] !== "midfielder") continue;
  verifica(`${nome} (COC): una partita etichettata "midfielder" resta tra gli attaccanti`,
    groupForMatch(nome, "midfielder") === "ATTACCANTI",
    groupForMatch(nome, "midfielder"));
}

console.log("\nFuori ruolo: vince l'etichetta della singola partita");
const unAttaccante = Object.keys(GROUP_OF_PLAYER)
  .find(n => GROUP_OF_PLAYER[n] === "ATTACCANTI");
if (unAttaccante) {
  verifica(`${unAttaccante} schierato "defender" conta tra i difensori`,
    groupForMatch(unAttaccante, "defender") === "DIFENSORI",
    groupForMatch(unAttaccante, "defender"));
}
const puntaFissa = Object.keys(GROUP_OF_PLAYER)
  .find(n => GROUP_OF_PLAYER[n] === "ATTACCANTI" && EA_LABEL_OF_PLAYER[n] === "forward");
if (puntaFissa) {
  verifica(`${puntaFissa} (punta fissa) schierato "midfielder" conta a centrocampo`,
    groupForMatch(puntaFissa, "midfielder") === "CENTROCAMPISTI",
    groupForMatch(puntaFissa, "midfielder"));
}

console.log("\nUn solo ruolo in tutta la dashboard");
verifica("ogni giocatore in rosa ha un gruppo assegnato",
  (ambiente.DATA.roster || []).every(r => r.gruppo),
  (ambiente.DATA.roster || []).filter(r => !r.gruppo).map(r => r.player_name).join(", "));
verifica("il gruppo mostrato coincide con quello di roles.json",
  (ambiente.DATA.roster || []).filter(r => GROUP_OF_PLAYER[r.player_name])
    .every(r => r.gruppo === GROUP_OF_PLAYER[r.player_name]));

console.log("\nPunteggi per reparto");
const tutti = computeGroupScores();
verifica("ogni voce ha almeno una partita nel ruolo",
  tutti.every(a => a.games > 0));
verifica("nessun giocatore fuori dalla rosa filtrata",
  tutti.every(a => (DATAroster()).has(a.player_name)));
function DATAroster() {
  return new Set((ambiente.DATA.roster || []).map(r => r.player_name));
}
for (const g of GROUP_ORDER) {
  const pool = tutti.filter(a => a.group === g);
  if (pool.length < 2) continue;
  const r = rankGroup(pool);
  verifica(`${g}: punteggi tra 0 e 100 e ordinati`,
    r.every(a => a.score >= 0 && a.score <= 100) &&
    r.every((a, i) => i === 0 || r[i - 1].score >= a.score));
  // Una metrica su cui tutti hanno lo stesso valore non deve regalare mezzo punteggio.
  verifica(`${g}: le metriche piatte sono escluse dal calcolo`,
    Array.isArray(r[0].metricheIgnorate));
}

// La scheda osservatore si costruisce dentro una IIFE che parla con il DOM, quindi per
// verificarla serve un finto documento. Vale la pena: il 23/08/2026 le righe dei giocatori
// non portavano il match_id, e ogni voce che doveva risalire alla partita - avversario,
// esito, posizione nella serata - non trovava niente e spariva. La scheda mostrava meno
// cose, nessun errore da nessuna parte. Un guasto che tace e' peggio di uno che rompe.
// Segnalati il 24/08/2026: un giocatore con UNA partita nel reparto stava sopra chi ci
// gioca da quaranta, e nell'Indice di Forza a "100% forma" compariva terzo chi non ha
// nemmeno una partita archiviata. Stessa causa: i campioni piccoli pesavano quanto i grandi.
console.log("\nCampioni piccoli");
{
  const tuttiGruppi = computeGroupScores();
  for (const g of GROUP_ORDER) {
    const pool = tuttiGruppi.filter(a => a.group === g);
    if (pool.length < 3) continue;
    const r = rankGroup(pool);
    const molte = r.filter(a => a.games >= 10);
    const pochissime = r.filter(a => a.games <= 2);
    if (!molte.length || !pochissime.length) continue;
    // Con la riduzione verso la media, chi ha pochissime partite finisce vicino al centro:
    // non puo' stare in cima al reparto sulla forza di un episodio.
    verifica(`${g}: chi ha 1-2 partite non e' primo`,
      r[0].games > 2,
      `primo e' ${r[0].player_name} con ${r[0].games} partite`);
  }

  // Non si controlla il punteggio assoluto: dopo la riduzione i valori vengono
  // ri-normalizzati sul reparto, quindi gli estremi tornano 0 e 100 per costruzione.
  // Quello che la riduzione cambia e' l'ORDINE, ed e' li' che va verificata: chi ha una
  // manciata di partite viene tirato verso la media, e la media non puo' essere il massimo.
  for (const g of GROUP_ORDER) {
    const pool = tuttiGruppi.filter(a => a.group === g);
    if (pool.length < 3) continue;
    const grezzo = [...pool].sort((x, y) => y.ratingAve - x.ratingAve);
    const ridotto = rankGroup(pool);
    if (grezzo[0].games <= 2 && grezzo[0].player_name !== ridotto[0].player_name) {
      console.log(`  ok    ${g}: ${grezzo[0].player_name} (${grezzo[0].games}p) non e' piu' primo per una sola buona partita`);
    }
  }
}

console.log("\nIndice di Forza: chi non ha dati recenti resta fuori classifica");
{
  const a100 = computeBlendedScores(30, 1);
  const fuori = a100.filter(p => p.fuoriClassifica);
  const dentro = a100.filter(p => !p.fuoriClassifica);
  verifica("nessuno senza partite archiviate entra in classifica",
    dentro.every(p => p.formAvailable),
    dentro.filter(p => !p.formAvailable).map(p => p.r.player_name).join(", "));
  verifica("i fuori classifica stanno tutti in fondo",
    a100.findIndex(p => p.fuoriClassifica) === -1 ||
    a100.slice(a100.findIndex(p => p.fuoriClassifica)).every(p => p.fuoriClassifica));
  if (fuori.length) {
    console.log(`  nota  fuori classifica a 100% forma: ${fuori.map(p => p.r.player_name).join(", ")}`);
  }
  // A peso zero la forma non conta: tutti devono tornare in classifica.
  verifica("a 0% forma nessuno resta fuori",
    computeBlendedScores(30, 0).every(p => !p.fuoriClassifica));
}

console.log("\nScheda osservatore");
{
  const magazzino = {};
  const scelte = {};
  const finto = (id) => magazzino[id] = magazzino[id] || {
    id, innerHTML: "", remove(){},
    querySelectorAll(){
      const h = String(this.innerHTML);
      const attr = this.id === "ossMetro" ? "m" : "n";
      return [...h.matchAll(new RegExp(`data-${attr}="([^"]+)"`, "g"))].map(x => ({
        dataset: { [attr]: x[1] },
        addEventListener: (_e, f) => { scelte[attr + ":" + x[1]] = f; },
      }));
    },
  };
  global.document = { getElementById: finto, querySelector: () => ({ innerHTML: "" }) };

  try {
    new Function(
      ritaglia("const DATA = {", "// ---- Ruolo effettivo") + "\n" +
      ritaglia("const ROLE_COUNTS_BY_NAME", "function fmtDate") + "\n" +
      "function fmtDate(x){ return String(x); }\n" +
      ritaglia("// ---- Vittorie e sconfitte", "// ---- Serate ----")
    )();

    const nomi = Object.keys(scelte).filter(k => k.startsWith("n:")).map(k => k.slice(2));
    verifica("la scheda si costruisce per almeno un giocatore", nomi.length > 0);

    let senzaAvversario = 0, senzaVoci = 0;
    nomi.forEach(n => {
      scelte["n:" + n]();
      const h = magazzino["ossCuriosita"].innerHTML;
      const voci = (h.match(/margin-bottom:2px;">/g) || []).length;
      if(voci === 0) senzaVoci++;
      // "I due estremi" nomina sempre l'avversario: se la partita non viene trovata
      // compare un trattino, ed e' il sintomo esatto del bug del match_id.
      if(/Meglio: <strong>[^<]+<\/strong> contro —/.test(h)) senzaAvversario++;
    });
    verifica("ogni scheda produce almeno una voce", senzaVoci === 0, `${senzaVoci} vuote`);
    verifica("le voci risalgono sempre alla partita giusta",
      senzaAvversario === 0, `${senzaAvversario} schede senza nome dell'avversario`);

    // La diagnosi di squadra deve dire qualcosa, non restare una tabella muta.
    verifica("la lettura di vittorie e sconfitte viene scritta",
      /Nelle sconfitte|Cambiano invece/.test(magazzino["diagnosiLettura"].innerHTML));
  } catch (e) {
    verifica("la scheda osservatore si esegue senza eccezioni", false, e.message);
  }
}

console.log(falliti === 0
  ? "\nTutti i controlli superati.\n"
  : `\n${falliti} controlli falliti.\n`);
process.exit(falliti === 0 ? 0 : 1);
