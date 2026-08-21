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
  ritaglia("const DATA = {", "// ---- Ruolo effettivo"),
  ritaglia("const ROLE_COUNTS_BY_NAME", "function fmtDate"),
].join("\n");

let ambiente;
try {
  ambiente = new Function(codice + `
    return { DATA, GROUP_OF_PLAYER, EA_LABEL_OF_PLAYER, MACRO_TO_GROUP,
             groupForMatch, etichettaAttesa, mainPosOf, computeGroupScores, rankGroup,
             GROUP_ORDER, ROLE_EXCEPTIONS };`)();
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
        computeGroupScores, rankGroup, GROUP_ORDER } = ambiente;

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

console.log(falliti === 0
  ? "\nTutti i controlli superati.\n"
  : `\n${falliti} controlli falliti.\n`);
process.exit(falliti === 0 ? 0 : 1);
