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
             PESI_INDICE, PESI_TECNICA, PESI_TECNICA_DIFESA, efficienzaTecnica,
             SCALE_INDICE, SCALE_TECNICA, suScala, PESI_TECNICA_PER_REPARTO,
             dettaglioTecnica, suScalaTecnica, versoLaMediaTecnica,
             TENTATIVI_CREDIBILI, MEDIE_TECNICA };`)();
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
        PESI_INDICE, PESI_TECNICA, PESI_TECNICA_DIFESA, efficienzaTecnica,
        SCALE_INDICE, SCALE_TECNICA, suScala, PESI_TECNICA_PER_REPARTO,
        dettaglioTecnica, suScalaTecnica, versoLaMediaTecnica,
        TENTATIVI_CREDIBILI, MEDIE_TECNICA } = ambiente;

// I pesi erano scritti a mano in quattro punti diversi. Ora c'e' una costante sola, e
// questi controlli servono a impedire che le copie tornino: se qualcuno riscrive un peso
// direttamente dentro una formula, la somma smette di tornare e il test se ne accorge.
console.log("\nPesi dell'Indice di Forza");
{
  // Dal 29/08/2026 le voci positive sommano a 1.00 e la disciplina e' una PENALITA' a parte,
  // che sottrae fino a 5 punti invece di occupare una fetta dei cento. Prima sommavano a
  // 0.95 perche' i rossi erano trattati come una sesta voce.
  // Sommate leggendo le chiavi vere, non elencandole a mano: cosi' togliere o aggiungere
  // una voce non richiede di ricordarsi di aggiornare anche il test. La % vittorie e' stata
  // tolta il 29/08/2026 e con l'elenco scritto a mano il conto diventava NaN in silenzio.
  const somma = Object.entries(PESI_INDICE)
    .filter(([k]) => k !== "disc")
    .reduce((t, [, v]) => t + v, 0);
  verifica("i pesi positivi sommano a 1 (la disciplina e' una penalita' separata)",
    Math.abs(somma - 1) < 1e-9, `sommano ${somma.toFixed(3)}`);
  verifica("la disciplina resta una penalita' piccola: non oltre il 10%",
    PESI_INDICE.disc > 0 && PESI_INDICE.disc <= 0.10, `vale ${PESI_INDICE.disc}`);
  verifica("il MOTM resta una voce minore: non piu' del 10%",
    PESI_INDICE.motm <= 0.10, `vale ${PESI_INDICE.motm}`);
  // Nessuna voce deve tornare a dominare come faceva la media voto al 50%: con meta' del
  // peso su una sola metrica l'indice diventava una classifica di quella metrica.
  // Il pericolo era la media voto al 50%: con meta' del peso su una metrica sola l'indice
  // diventava una classifica di quella metrica. Il 40% e' il limite oltre il quale si
  // ricomincia ad andare in quella direzione.
  const piuPesante = Math.max(...Object.entries(PESI_INDICE)
    .filter(([k]) => k !== "disc").map(([, v]) => v));
  verifica("nessuna voce da sola vale piu' del 40% dell'indice",
    piuPesante <= 0.40, `la piu' pesante vale ${piuPesante}`);
  // La % vittorie e' uscita: e' un esito di squadra, non una qualita' del singolo. Misurata
  // il 29/08/2026, affidabilita' +0.008 su divisione cronologica contro +0.71 del rating,
  // perche' due giocatori condividono in media il 66% delle partite.
  verifica("la % vittorie non e' piu' una voce dell'indice",
    !("win" in PESI_INDICE), "e' tornata fra i pesi");
  // Le scale fisse sono il motivo per cui zero significa zero: se qualcuno tornasse a
  // ricavarle dalla rosa, il punteggio smetterebbe di essere confrontabile fra reparti.
  for (const [k, [min, max]] of Object.entries(SCALE_INDICE)) {
    verifica(`la scala di ${k} e' fissa e crescente (${min} - ${max})`,
      typeof min === "number" && typeof max === "number" && max > min, `${min} - ${max}`);
  }
  for (const [k, [min, max]] of Object.entries(SCALE_TECNICA)) {
    verifica(`la sottoscala di ${k} e' fissa e crescente (${min} - ${max})`,
      typeof min === "number" && typeof max === "number" && max > min, `${min} - ${max}`);
  }
  // Dal 29/08/2026 i pesi della tecnica sono QUATTRO, uno per reparto: prima erano due,
  // "difensori" e "tutti gli altri", e quel secondo gruppo metteva insieme un centrocampista
  // e un attaccante, che con la palla fanno mestieri diversi.
  for (const [reparto, p] of Object.entries(PESI_TECNICA_PER_REPARTO)) {
    const s = p.passaggi + p.contrasti + p.tiro;
    verifica(`efficienza tecnica (${reparto}): i tre pezzi sommano a 1`,
      Math.abs(s - 1) < 1e-9, `sommano ${s.toFixed(3)}`);
  }
  // La regola del club: i contrasti calano scendendo verso l'attacco, il tiro cresce.
  // Se qualcuno un giorno li riscrive a caso, questa monotonia si rompe e il test lo dice.
  const scala = ["DIFENSORI", "CENTROCAMPISTI", "ESTERNI", "ATTACCANTI"];
  const contr = scala.map(r => PESI_TECNICA_PER_REPARTO[r].contrasti);
  const tiri  = scala.map(r => PESI_TECNICA_PER_REPARTO[r].tiro);
  verifica("i contrasti calano dalla difesa all'attacco",
    contr.every((v, i) => i === 0 || v <= contr[i - 1]), contr.join(" > "));
  verifica("il tiro cresce dalla difesa all'attacco",
    tiri.every((v, i) => i === 0 || v >= tiri[i - 1]), tiri.join(" < "));
  verifica("solo gli attaccanti hanno il peso minimo sui contrasti",
    PESI_TECNICA_PER_REPARTO.ATTACCANTI.contrasti === Math.min(...contr) &&
    contr.filter(v => v === Math.min(...contr)).length === 1,
    `contrasti per reparto: ${contr.join(", ")}`);
  verifica("per i difensori il contrasto pesa piu' del tiro",
    PESI_TECNICA_PER_REPARTO.DIFENSORI.contrasti > PESI_TECNICA_PER_REPARTO.DIFENSORI.tiro);
  verifica("per gli attaccanti vale il contrario",
    PESI_TECNICA_PER_REPARTO.ATTACCANTI.contrasti < PESI_TECNICA_PER_REPARTO.ATTACCANTI.tiro);
  // Stesso giocatore, stessi numeri grezzi, quattro reparti: chi recupera palloni deve
  // valere di piu' man mano che si scende, chi tira deve valere di piu' salendo.
  const bravoAContrastare = scala.map(r => efficienzaTecnica(75, 60, 20, r));
  verifica("chi vince i contrasti vale sempre meno salendo verso l'attacco",
    bravoAContrastare.every((v, i) => i === 0 || v <= bravoAContrastare[i - 1]),
    bravoAContrastare.map(v => v.toFixed(1)).join(" > "));
  const bravoATirare = scala.map(r => efficienzaTecnica(75, 5, 45, r));
  verifica("chi segna vale sempre di piu' salendo verso l'attacco",
    bravoATirare.every((v, i) => i === 0 || v >= bravoATirare[i - 1]),
    bravoATirare.map(v => v.toFixed(1)).join(" < "));
  // Stesso giocatore, stessi numeri grezzi: il reparto deve cambiare il risultato.
  const bravoNeiContrasti = efficienzaTecnica(80, 60, 20, "DIFENSORI");
  const stessoAltrove     = efficienzaTecnica(80, 60, 20, "ATTACCANTI");
  verifica("chi vince i contrasti vale di piu' fra i difensori che altrove",
    bravoNeiContrasti > stessoAltrove,
    `${bravoNeiContrasti.toFixed(1)} contro ${stessoAltrove.toFixed(1)}`);
  verifica("senza reparto si usano i pesi normali",
    efficienzaTecnica(80, 60, 20) === stessoAltrove);
}

// Il dettaglio che si apre cliccando la colonna Tecnica promette una cosa precisa: i tre
// pezzi che mostra devono ricostruire il numero scritto in tabella. Se divergono, il
// dettaglio spiega un valore che non e' quello mostrato - il difetto peggiore, perche' e'
// invisibile finche' qualcuno non fa la somma a mano.
console.log("\nDettaglio dell'efficienza tecnica");
{
  const ALL = computeGroupScores();
  let controllate = 0, sbagliate = 0, peggiore = 0;
  for (const gruppo of GROUP_ORDER) {
    for (const a of ALL.filter(x => x.group === gruppo)) {
      const tent = { passaggi: a.sumPassAttempts, contrasti: a.sumTackleAttempts, tiro: a.sumShots };
      const html = dettaglioTecnica(a.passaggi, a.contrasti, a.tiro, gruppo, 10, tent);
      const punti = [...html.matchAll(/tecq-punti">([\d.]+)</g)].map(m => parseFloat(m[1]));
      if (punti.length !== 4) { sbagliate++; continue; }   // tre pezzi + totale
      const somma = punti[0] + punti[1] + punti[2];
      const scarto = Math.abs(somma - a.techEff);
      if (scarto > peggiore) peggiore = scarto;
      if (scarto > 0.15) sbagliate++;
      // e il totale stampato deve essere quello della tabella, non un terzo numero
      if (Math.abs(punti[3] - a.techEff) > 0.5) sbagliate++;
      controllate++;
    }
  }
  verifica(`i tre pezzi ricostruiscono l'efficienza tecnica (${controllate} righe)`,
    sbagliate === 0 && controllate > 0, `${sbagliate} fuori, scarto massimo ${peggiore.toFixed(3)}`);

  // Il dettaglio deve usare i pesi DEL REPARTO: stessi numeri grezzi, reparti diversi,
  // risultati diversi. Altrimenti mostrerebbe una spiegazione che non c'entra col punteggio.
  const totali = ["DIFENSORI", "CENTROCAMPISTI", "ESTERNI", "ATTACCANTI"].map(g => {
    const html = dettaglioTecnica(75, 40, 20, g, 10);
    return parseFloat([...html.matchAll(/tecq-punti">([\d.]+)</g)].pop()[1]);
  });
  verifica("il dettaglio usa i pesi del reparto, non sempre gli stessi",
    new Set(totali).size === 4, `totali ${totali.join(", ")}`);
  verifica("chi contrasta bene e tira male vale di piu' in difesa che in attacco",
    totali[0] > totali[3], `difesa ${totali[0]} contro attacco ${totali[3]}`);

  // ---- La smorzatura: una percentuale vale quanto il suo denominatore ----
  // Nata da una segnalazione: 97 di efficienza tecnica a un centrocampista con 10 tiri in
  // 14 partite. Sei gol su dieci e' vero come numero e non significa niente come misura.
  {
    const media = MEDIE_TECNICA.tiro;
    const pochi = versoLaMediaTecnica(100, 4, "tiro");
    const tanti = versoLaMediaTecnica(100, 2000, "tiro");
    verifica("con pochi tentativi il valore viene tirato verso la media del club",
      Math.abs(pochi - media) < Math.abs(100 - media) / 2,
      `100% su 4 tiri conta come ${pochi.toFixed(1)}%, media del club ${media.toFixed(1)}%`);
    verifica("con tanti tentativi il valore resta quasi intatto",
      Math.abs(tanti - 100) < 3, `100% su 2000 tiri conta come ${tanti.toFixed(1)}%`);
    verifica("la smorzatura non capovolge mai l'ordine: piu' prove, piu' vicino al vero",
      versoLaMediaTecnica(100, 10, "tiro") < versoLaMediaTecnica(100, 100, "tiro"));
    // Vale in entrambe le direzioni: chi ha lo 0% su due tiri non e' un incapace.
    verifica("anche uno zero su pochi tentativi viene alzato verso la media",
      versoLaMediaTecnica(0, 2, "tiro") > 0.5 * media,
      `0% su 2 tiri conta come ${versoLaMediaTecnica(0, 2, "tiro").toFixed(1)}%`);
    verifica("senza il numero di tentativi non si smorza nulla",
      versoLaMediaTecnica(100, undefined, "tiro") === 100);
    // E il caso vero che ha fatto nascere tutto.
    const prima = 100 * (0.40 * suScalaTecnica(87.6, "passaggi") + 0.30 * suScalaTecnica(57.7, "contrasti") + 0.30 * suScalaTecnica(60, "tiro"));
    const dopo = 100 * (0.40 * suScalaTecnica(versoLaMediaTecnica(87.6, 307, "passaggi"), "passaggi")
                      + 0.30 * suScalaTecnica(versoLaMediaTecnica(57.7, 26, "contrasti"), "contrasti")
                      + 0.30 * suScalaTecnica(versoLaMediaTecnica(60, 10, "tiro"), "tiro"));
    verifica("il caso reale del 97 scende sotto 85",
      prima > 90 && dopo < 85, `prima ${prima.toFixed(1)}, dopo ${dopo.toFixed(1)}`);
  }

  // Le barre non devono mai uscire dal contenitore: sono percentuali di larghezza.
  const estremo = dettaglioTecnica(200, 200, 200, "ATTACCANTI", 10);
  const larghezze = [...estremo.matchAll(/width:([\d.]+)%/g)].map(m => parseFloat(m[1]));
  verifica("le barre restano fra 0 e 100 anche con valori fuori scala",
    larghezze.every(w => w >= 0 && w <= 100), larghezze.join(", "));
}

// La classifica generale non deve piu' avere filtri per reparto: e' calcolata sulle
// carriere, dove il ruolo della singola partita non esiste. Chi filtrava "Centrocampisti"
// otteneva "chi fa il centrocampista di mestiere" e non se ne accorgeva - Maverik_44_, 4
// partite a centrocampo su 20 ma ruolo abituale esterno, spariva dall'elenco.
console.log("\nClassifica generale: nessun filtro per reparto");
{
  verifica("i bottoni dei reparti non ci sono piu' nella generale",
    !html.includes('id="powerRoleFilters"'));
  verifica("nessun residuo del filtro nel codice",
    !script.includes("activeRole") && !script.includes("renderRoleFilters"));
  // Il rimando alla sezione dove il ruolo si conosce davvero deve portarci davvero.
  const salto = (html.match(/data-vai="([\w-]+)"[^>]*>Reparto per reparto/) || [])[1];
  verifica("il rimando a Reparto per reparto punta a un elemento che esiste",
    !!salto && html.includes(`id="${salto}"`), salto ? `id ${salto} non trovato` : "nessun rimando");
  // E la generale deve elencare tutti, non un sottoinsieme.
  const inRosa = (ambiente.DATA.roster || []).length;
  const inClassifica = ambiente.computeBlendedScores(30, 0.5).length;
  verifica(`la generale elenca tutta la rosa (${inRosa})`,
    inClassifica === inRosa, `ne mostra ${inClassifica}`);
}

// La dashboard mostra UNA SEZIONE ALLA VOLTA in base all'ancora, e showPage() rimanda a
// home qualsiasi ancora che non sia una pagina. Un <a href="#sottotitolo"> fa quindi
// l'opposto di quel che promette: invece di portarti al punto indicato ti sbatte in home.
// Successo davvero il 25/08/2026 con il rimando a "Reparto per reparto".
console.log("\nCollegamenti interni");
{
  const chiavi = new Set(Object.values(
    new Function(script.match(/const PAGE_MAP = \{[\s\S]*?\};/)[0] + "return PAGE_MAP;")()));
  // Solo il markup vero: fuori dal JS, che contiene modelli di stringa, e fuori dal CSS,
  // dove un commento puo' nominare un href senza che sia un collegamento.
  const corpo = html.split("<script>")[0].replace(/<style>[\s\S]*?<\/style>/g, "");
  const rotti = [...new Set([...corpo.matchAll(/href="#([^"]+)"/g)].map(m => m[1]))]
    .filter(a => !chiavi.has(a));
  verifica("nessun collegamento punta a un'ancora che non e' una pagina",
    rotti.length === 0, rotti.map(a => "#" + a).join(", ") + " -> porterebbero a home");

  // I salti interni usano data-vai e devono trovare il loro bersaglio.
  const senzaBersaglio = [...new Set([...html.matchAll(/data-vai="([^"]+)"/g)].map(m => m[1]))]
    .filter(id => !html.includes(`id="${id}"`));
  verifica("ogni salto interno trova il suo bersaglio",
    senzaBersaglio.length === 0, senzaBersaglio.join(", "));

  // Le pagine tolte devono continuare a rispondere. Un indirizzo vive nei preferiti e nelle
  // chat molto piu' a lungo della sezione che lo ha generato: se un giorno #rosa finisse in
  // home, chi ci arriva penserebbe che la dashboard e' rotta.
  const traslocate = new Function(
    script.match(/const PAGINE_TRASLOCATE = \{[\s\S]*?\};/)[0] + "return PAGINE_TRASLOCATE;")();
  const orfane = Object.entries(traslocate).filter(([, dove]) => !chiavi.has(dove));
  verifica(`i vecchi indirizzi portano a una pagina che esiste (${Object.keys(traslocate).join(", ")})`,
    orfane.length === 0, orfane.map(([a, d]) => `#${a} -> ${d}`).join(", "));
  const doppie = Object.keys(traslocate).filter(a => chiavi.has(a));
  verifica("nessun indirizzo traslocato coincide con una pagina viva",
    doppie.length === 0, doppie.join(", "));
}

// La sezione Serate elenca chiunque abbia giocato quella sera, e quei nomi sono
// cliccabili. La rosa invece contiene solo chi ha almeno 30 partite di CARRIERA: per un
// giocatore nuovo il clic non apriva niente, in silenzio. Segnalato il 25/08/2026 su
// Bagherese_95, che aveva giocato cinque partite la sera prima.
console.log("\nScheda di chi non e' ancora in rosa");
{
  const chi = new Set((ambiente.DATA.roster || []).map(r => r.player_name));
  const fuori = new Set();
  (ambiente.DATA.matches || []).forEach(m =>
    (ambiente.DATA.matchPlayers[m.match_id] || []).forEach(p => {
      if (!chi.has(p.player_name)) fuori.add(p.player_name);
    }));

  const codice = ritaglia("// Chi ha giocato ma non e' ancora in rosa", 'document.addEventListener("click"');
  const magazzino = {};
  const finto = (id) => magazzino[id] = magazzino[id] || {
    id, innerHTML: "",
    classList: { add(){}, remove(){}, contains(){ return false; }, toggle(){} },
    addEventListener(){}, querySelector(){ return { addEventListener(){} }; },
    get parentElement(){ return finto("p:" + id); },
  };
  global.document = { getElementById: finto, querySelector: () => ({ innerHTML: "", addEventListener(){} }),
                      querySelectorAll: () => [], addEventListener(){} };

  try {
    const amb = new Function(
      ritaglia("const DATA = {", "// ---- Cards ----") + "\n" + codice +
      "\nfunction closePlayerCard(){}\nfunction getAchievements(){return [];}" +
      "\nreturn { openPlayerCard, schedaDaPartite };")();

    verifica(`ci sono giocatori che hanno giocato ma non sono in rosa (${fuori.size})`,
      fuori.size > 0, "nessuno: il controllo non sta provando niente");

    let muti = 0, senzaAvviso = 0, ruoloSbagliato = 0;
    for (const nome of fuori) {
      finto("playerModal").innerHTML = "";
      amb.openPlayerCard(nome);
      const h = String(finto("playerModal").innerHTML);
      if (!h) { muti++; continue; }
      // Deve dichiarare che i numeri sono parziali, altrimenti sembrano di carriera.
      if (!/Non è ancora in rosa/.test(h)) senzaAvviso++;
      // E non deve dire "nessuna partita archiviata" proprio a chi le ha.
      if (/nessuna partita archiviata/.test(h)) ruoloSbagliato++;
    }
    verifica("cliccando su di loro la scheda si apre", muti === 0, `${muti} non aprono niente`);
    verifica("la scheda dichiara che i numeri sono parziali",
      senzaAvviso === 0, `${senzaAvviso} senza avviso`);
    verifica("non dichiara zero partite archiviate a chi le ha",
      ruoloSbagliato === 0, `${ruoloSbagliato} schede sbagliate`);

    // Un nome inventato non deve aprire niente: e' il caso in cui il silenzio e' giusto.
    finto("playerModal").innerHTML = "";
    amb.openPlayerCard("QuestoNomeNonEsiste_000");
    verifica("un nome inesistente non apre nulla",
      String(finto("playerModal").innerHTML) === "");
  } catch (e) {
    verifica("la scheda parziale si costruisce senza eccezioni", false, e.message);
  }
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

// Il confronto testa a testa promette una cosa precisa: le voci sommano al distacco. Se
// smettesse di essere vero la sezione mentirebbe in silenzio, mostrando pezzi che non
// ricostruiscono il totale - ed e' proprio il genere di guasto che qui non da' errori.
console.log("\nConfronto testa a testa");
{
  const magazzino = {};
  let cambia = null;
  const finto = (id) => magazzino[id] = magazzino[id] || {
    id, innerHTML: "", value: "", options: [],
    set innerHTMLSetter(v){ this.innerHTML = v; },
    addEventListener: (_e, f) => { cambia = f; },
    get parentElement(){ return { innerHTML: "" }; },
  };
  global.document = { getElementById: finto, querySelector: () => ({ innerHTML: "" }) };

  try {
    const ambienteH2H = new Function(
      ritaglia("const DATA = {", "// ---- Cards ----") + "\n" +
      ritaglia("// Il testa a testa spiegava poco", "// ---- Riepilogo periodo") + "\n" +
      "return { PESI_INDICE, computeBlendedScores, DATA };"
    )();

    const rosa = [...ambienteH2H.DATA.roster].map(r => r.player_name).sort();
    verifica("la sezione si costruisce e riempie i menu a tendina",
      String(magazzino["h2hA"].innerHTML).includes("<option"), "nessuna opzione");

    // Ricalcolo la stessa promessa fuori dalla pagina: la somma delle voci deve
    // ricostruire il distacco fra i due punteggi mostrati in classifica.
    const punteggi = ambienteH2H.computeBlendedScores(30, 0.5);
    let peggiore = 0, coppie = 0;
    for (let i = 0; i < punteggi.length; i++) {
      for (let j = i + 1; j < punteggi.length; j++) {
        const a = punteggi[i], b = punteggi[j];
        if (!a.vociMescolate || !b.vociMescolate) continue;
        const somma = Object.keys(ambienteH2H.PESI_INDICE).reduce((t, k) =>
          t + 100 * ambienteH2H.PESI_INDICE[k] * (a.vociMescolate[k] - b.vociMescolate[k])
              * (k === "disc" ? -1 : 1), 0);
        const scarto = Math.abs(somma - (a.blendedScore - b.blendedScore));
        if (scarto > peggiore) peggiore = scarto;
        coppie++;
      }
    }
    verifica(`le voci ricostruiscono il distacco in tutte le ${coppie} coppie`,
      peggiore < 0.15, `errore massimo ${peggiore.toFixed(3)} punti`);

    const quanteAttese = Object.keys(ambienteH2H.PESI_INDICE).length;
    verifica(`ogni giocatore ha la scomposizione completa (${quanteAttese} voci)`,
      punteggi.every(s => s.vociMescolate && Object.keys(s.vociMescolate).length === quanteAttese),
      punteggi.filter(s => !s.vociMescolate || Object.keys(s.vociMescolate).length !== quanteAttese)
              .map(s => s.r.player_name).join(", "));

    // Il verdetto deve nominare qualcuno e dare un numero, non restare una scatola vuota.
    const testo = String(magazzino["h2hVerdetto"].innerHTML);
    verifica("il verdetto dice di quanto sta sopra o sotto",
      /sta[\s\S]*punti[\s\S]*(sopra|sotto)/.test(testo) && rosa.some(n => testo.includes(n)), testo.slice(0, 80));
    verifica("le voci vengono elencate con i valori grezzi",
      /nella rosa da/.test(String(magazzino["h2hVoci"].innerHTML)));

    verifica("ogni pezzo dichiara su cosa e' calcolato",
      /sui passaggi tentati/.test(String(magazzino["h2hVoci"].innerHTML))
      && /gol sui tiri tentati/.test(String(magazzino["h2hVoci"].innerHTML))
      && /sui contrasti tentati/.test(String(magazzino["h2hVoci"].innerHTML)));

    // Il controllo che conta: si leggono i numeri STAMPATI e si verifica che sommino al
    // distacco annunciato. Ricalcolarli a parte non basta - il difetto puo' stare nel modo
    // in cui vengono mostrati, per esempio un segno sbagliato sui cartellini, e in quel
    // caso il conto tornerebbe lo stesso mentre a schermo compare l'opposto.
    //
    // E va fatto su TUTTE le coppie, non su quella aperta per prima: una versione
    // precedente ne guardava una sola e non si accorse di un'attribuzione sbagliata dei
    // pezzi dell'efficienza tecnica, perche' quella coppia non era fra le undici che la
    // rendevano visibile.
    // Tutto e' letto dal punto di vista del giocatore scelto A SINISTRA: positivo quando e'
    // lui a guadagnare la voce, negativo quando la perde. Il nome accanto ai punti dice a
    // chi vanno, quindi il segno si ricava da li'.
    const leggiPunti = (frammento, nomeSinistra) =>
      [...frammento.matchAll(/([+−])[\d.]*?([\d.]+) punti\s*<span[^>]*>\s*a ([^<]+?)\s*<\/span>/g)]
        .map(m => (m[3].trim() === nomeSinistra ? 1 : -1) * Number(m[2]))
        .concat([...frammento.matchAll(/>\s*pari\s*</g)].map(() => 0));

    let coppieViste = 0, vociSbagliate = 0, pezziSbagliati = 0, quanteVoci = new Set();
    let peggiorVoci = 0, peggiorPezzi = 0, senzaNome = 0;
    for (let i = 0; i < rosa.length; i++) {
      for (let j = i + 1; j < rosa.length; j++) {
        magazzino["h2hA"].value = rosa[i];
        magazzino["h2hB"].value = rosa[j];
        cambia();
        coppieViste++;
        const testoV = String(magazzino["h2hVerdetto"].innerHTML);
        const h = String(magazzino["h2hVoci"].innerHTML);
        // Il distacco annunciato e' in valore assoluto: il verso lo dice "sopra" o "sotto".
        const atteso = Number((testoV.match(/([\d.]+) punti/) || [])[1])
                     * (/sotto/.test(testoV) ? -1 : 1);
        // Il riferimento e' il valore VERO del menu di sinistra, non il nome che la
        // pagina stampa: ricavarlo dal verdetto rendeva il controllo cieco: se il codice
        // avesse ancorato tutto a chi sta piu' in alto in classifica, il test lo avrebbe
        // seguito invece di accorgersene. Provato rompendolo apposta.
        const nomeAlto = rosa[i];
        if (!/<strong>/.test(testoV) || !testoV.includes(nomeAlto)) { senzaNome++; continue; }
        if (!new RegExp("<strong>" + nomeAlto.replace(/[.*+?^${}()|\[\]\\]/g, "\\$&") + "</strong>\\s*sta").test(testoV)) {
          senzaNome++; continue;
        }

        // Le tendine contengono a loro volta dei punti: vanno tolte, altrimenti i pezzi
        // dell'efficienza tecnica verrebbero contati insieme al loro totale.
        const senzaTendine = h.replace(/<details[\s\S]*?<\/details>/g, "");
        const punti = leggiPunti(senzaTendine, nomeAlto);
        quanteVoci.add(punti.length);
        // Tolleranza 0.35 e non un numero a caso: si sommano sei voci gia' arrotondate a un
        // decimale e le si confronta con un totale anch'esso arrotondato, quindi sette
        // arrotondamenti da 0.05. Con 59 partite non si superava 0.15 e la soglia sembrava
        // stretta a sufficienza; a 69 partite e' arrivata una coppia a 0.20, che non era un
        // difetto: verificato che la somma ESATTA coincide col distacco a meno di 1e-14.
        // Un'attribuzione davvero sbagliata produce scarti di parecchi punti - le rotture
        // provate apposta davano 23.8 e 125.3 - quindi il controllo resta severo.
        const scartoVoci = Math.abs(punti.reduce((t, v) => t + v, 0) - atteso);
        if (scartoVoci > 0.35) vociSbagliate++;
        if (scartoVoci > peggiorVoci) peggiorVoci = scartoVoci;

        // La riga dell'efficienza tecnica va isolata PRIMA della sua tendina: cercando il
        // primo "punti" dopo l'etichetta si finiva dentro il riepilogo dei tre pezzi, e il
        // controllo confrontava un numero con se stesso passando sempre.
        const rigaTech = (h.match(/Efficienza tecnica([\s\S]*?)<details/) || [])[1];
        const dentroTendina = (h.match(/<details[\s\S]*?<\/details>/) || [])[0];
        if (rigaTech && dentroTendina) {
          const t = leggiPunti(rigaTech, nomeAlto)[0];
          const q = leggiPunti(dentroTendina, nomeAlto).reduce((a, b) => a + b, 0);
          // Tolleranza 0.16 e non zero: si sommano tre numeri gia' arrotondati a un
          // decimale, quindi fino a 0.05 ciascuno di scarto legittimo. Un'attribuzione
          // davvero sbagliata produce scarti di oltre un punto, ben fuori da qui.
          const scartoPezzi = Math.abs(t - q);
          if (scartoPezzi > 0.16) pezziSbagliati++;
          if (scartoPezzi > peggiorPezzi) peggiorPezzi = scartoPezzi;
        }
      }
    }
    verifica("il verdetto nomina sempre il giocatore di sinistra", senzaNome === 0,
      `${senzaNome} coppie senza nome`);

    // Colore e verso devono seguire il giocatore di SINISTRA: verde e barra a sinistra
    // quando e' in vantaggio, rosso e barra a destra quando e' in svantaggio. Se il colore
    // guardasse chi sta piu' in alto in classifica i numeri tornerebbero comunque, ma per
    // leggere una riga bisognerebbe prima ricordarsi quale dei due e' il primo.
    {
      let controcorrente = 0, coloreSbagliato = 0, verificate = 0;
      for (let i = 0; i < rosa.length && controcorrente === 0 && coloreSbagliato === 0; i++) {
        for (let j = i + 1; j < rosa.length; j++) {
          magazzino["h2hA"].value = rosa[i]; magazzino["h2hB"].value = rosa[j]; cambia();
          const nome = rosa[i];   // il giocatore scelto a sinistra, non quello annunciato
          const blocchi = String(magazzino["h2hVoci"].innerHTML)
            .replace(/<details[\s\S]*?<\/details>/g, "").split(/border-bottom:1px solid var\(--panel-2/);
          blocchi.forEach(b => {
            const p = leggiPunti(b, nome);
            if (!p.length || p[0] === 0) return;
            verificate++;
            // "right:50%" ancora la barra al centro e la fa crescere verso sinistra.
            if ((p[0] > 0) !== /right:50%/.test(b)) controcorrente++;
            if ((p[0] > 0) !== /--win/.test(b)) coloreSbagliato++;
          });
          if (controcorrente || coloreSbagliato) break;
        }
      }
      verifica(`la barra punta verso chi guadagna la voce (${verificate} righe)`,
        controcorrente === 0, `${controcorrente} righe con barra dalla parte sbagliata`);
      verifica("verde quando il giocatore di sinistra e' in vantaggio, rosso quando e' in svantaggio",
        coloreSbagliato === 0, `${coloreSbagliato} righe col colore invertito`);
    }
    const attese = Object.keys(PESI_INDICE).length;
    verifica(`le voci mostrate sono sempre ${attese} (${coppieViste} coppie)`,
      quanteVoci.size === 1 && quanteVoci.has(attese), `viste ${[...quanteVoci].join(", ")}`);
    verifica("in ogni coppia i punti stampati sommano al distacco annunciato",
      vociSbagliate === 0, `${vociSbagliate} coppie fuori, scarto massimo ${peggiorVoci.toFixed(2)}`);
    verifica("in ogni coppia i tre pezzi sommano all'efficienza tecnica",
      pezziSbagliati === 0, `${pezziSbagliati} coppie fuori, scarto massimo ${peggiorPezzi.toFixed(2)}`);
  } catch (e) {
    verifica("il confronto si esegue senza eccezioni", false, e.message);
  }
}

// "Novità dall'ultima serata" confronta due serate, non due istantanee. I numeri vengono
// ricalcolati qui da zero: se la sezione e quella ricostruzione divergono, uno dei due
// sbaglia — ed e' il tipo di errore che produce cifre plausibili, non un messaggio.
console.log("\nNovita' dall'ultima serata");
{
  const magazzino = {};
  const finto = (id) => magazzino[id] = magazzino[id] || {
    id, innerHTML: "", addEventListener(){}, get parentElement(){ return { innerHTML: "" }; },
  };
  global.document = { getElementById: finto, querySelector: () => ({ innerHTML: "" }), addEventListener(){} };

  try {
    new Function(
      ritaglia("const DATA = {", "// ---- Cards ----") + "\n" +
      // Il blocco finisce dove comincia la Share card: prima era la sezione "Crescita nel
      // tempo", tolta il 01/09/2026.
      ritaglia("// Confronta l'ULTIMA SERATA", "// ---- Share card:"))();
    const h = String(magazzino["newsBody"].innerHTML);
    const D = ambiente.DATA;
    const serate = D.serate || [];
    verifica("ci sono almeno due serate da confrontare", serate.length >= 2);

    const carta = (nome) => {
      const blocco = h.split('<div class="news-card">').slice(1)
        .find(c => (c.match(/class="nk">([^<]*)</) || [])[1] === nome);
      // `class="nv"` e basta: dal 01/09/2026 il valore grande non porta piu' la classe
      // up/down/flat, perche' il colore in questa sezione sta solo sui numeri col segno.
      return blocco ? (blocco.match(/class="nv"[^>]*>([^<]*)</) || [])[1] : null;
    };

    // Ricostruzione indipendente della serata piu' recente.
    const ids = serate[0].matchIds || [];
    const perId = new Map((D.matches || []).map(m => [m.match_id, m]));
    let v=0, n=0, p=0, gf=0, gs=0;
    ids.forEach(id => { const m = perId.get(id); if(!m) return;
      v += m.win?1:0; n += m.tie?1:0; p += m.loss?1:0;
      gf += m.goals_for||0; gs += m.goals_against||0; });

    verifica(`le partite mostrate sono quelle della serata (${ids.length})`,
      carta("Partite") === String(ids.length), `mostra ${carta("Partite")}`);
    verifica(`i gol fatti coincidono (${gf})`, carta("Gol fatti") === String(gf), `mostra ${carta("Gol fatti")}`);
    verifica(`i gol subiti coincidono (${gs})`, carta("Gol subiti") === String(gs), `mostra ${carta("Gol subiti")}`);
    verifica(`vittorie, pari e sconfitte coincidono (${v}V ${n}N ${p}P)`,
      h.includes(`${v}V · ${n}N · ${p}P`));

    // Il colore segue il MIGLIORAMENTO, non il segno. Il caso che lo mette alla prova sono i
    // gol subiti: "+12" ha il piu' davanti ma e' un peggioramento, e deve uscire rosso.
    // Nessun valore grande deve invece essere colorato: il colore e' solo per le variazioni.
    const scheda = (nome) => (h.split('<div class="news-card">').slice(1)
      .find(c => (c.match(/class="nk">([^<]*)</) || [])[1] === nome)) || "";
    const colore = (nome) => (scheda(nome).match(/class="ns">\s*<span class="(up|down|flat)"/) || [])[1] || null;

    const gsPrec = (serate[1] && (serate[1].matchIds || []).reduce((t, id) =>
      t + ((perId.get(id) || {}).goals_against || 0), 0)) ?? null;
    if(gsPrec !== null && gs !== gsPrec){
      const atteso = gs > gsPrec ? "down" : "up";
      verifica(`i gol subiti sono ${atteso === "down" ? "rossi" : "verdi"} (${gs} contro ${gsPrec} della volta prima)`,
        colore("Gol subiti") === atteso, `sono ${colore("Gol subiti")}`);
    }
    verifica("nessun valore grande e' colorato",
      !/class="nv (up|down|flat)"/.test(h),
      (h.match(/class="nv [^"]*"/g) || []).slice(0, 3).join(", "));

    // I giocatori elencati devono essere esattamente quelli che hanno giocato.
    const attesi = new Set();
    ids.forEach(id => (D.matchPlayers[id] || []).forEach(g => attesi.add(g.player_name)));
    const elencati = new Set([...h.matchAll(/<div class="mover">\s*<b>([^<]+)<\/b>/g)].map(m => m[1]));
    const mancanti = [...attesi].filter(x => !elencati.has(x));
    const inPiu = [...elencati].filter(x => !attesi.has(x));
    verifica(`sono elencati tutti e soli i ${attesi.size} che hanno giocato`,
      mancanti.length === 0 && inPiu.length === 0,
      `mancano ${mancanti.join(", ")||"-"}; in piu' ${inPiu.join(", ")||"-"}`);

    // "non c'era" solo per chi davvero non c'era nella serata precedente.
    const prima = new Set();
    (serate[1].matchIds || []).forEach(id => (D.matchPlayers[id] || []).forEach(g => prima.add(g.player_name)));
    // Una riga alla volta: cercando "non c'era" su tutto il blocco la ricerca scavalcava le
    // righe e attribuiva l'assenza al giocatore sbagliato.
    const blocchiGiocatore = h.split('<div class="mover">').slice(1);
    const sbagliati = [], mancate = [];
    blocchiGiocatore.forEach(b => {
      const nome = (b.match(/<b>([^<]+)<\/b>/) || [])[1];
      if(!nome) return;
      const dice = /non c'era/.test(b.split("</div>")[0]);
      if(dice && prima.has(nome)) sbagliati.push(nome);
      if(!dice && !prima.has(nome)) mancate.push(nome);
    });
    verifica("chi e' dichiarato assente la volta prima lo era davvero",
      sbagliati.length === 0, sbagliati.join(", "));
    verifica("e chi non c'era viene dichiarato, invece di mostrare una variazione finta",
      mancate.length === 0, mancate.join(", "));

    // La finestra dello skill rating parte dalla PRIMA partita della serata. Prenderne una
    // per posizione invece che per orario produce un numero plausibile e sbagliato.
    const istanti = ids.map(id => (perId.get(id) || {}).played_at).filter(Boolean).sort();
    const storia = D.history || [];
    const precedente = [...storia].reverse().find(x => x.fetched_at < istanti[0]);
    if(precedente && storia.length){
      const atteso = storia[storia.length-1].skill_rating - precedente.skill_rating;
      // La variazione ora vive dentro uno <span class="up|down"> per essere colorata.
      const mostrato = (h.match(/Skill rating[\s\S]*?class="ns">\s*<span[^>]*>([+−]?\d+)/) || [])[1];
      const num = mostrato ? Number(mostrato.replace("−","-")) : null;
      verifica(`la variazione di skill rating parte dall'inizio della serata (${atteso >= 0 ? "+" : ""}${atteso})`,
        num === atteso, `mostra ${mostrato}`);
    }
  } catch (e) {
    verifica("la sezione si esegue senza eccezioni", false, e.message);
  }
}

console.log(falliti === 0
  ? "\nTutti i controlli superati.\n"
  : `\n${falliti} controlli falliti.\n`);
process.exit(falliti === 0 ? 0 : 1);
