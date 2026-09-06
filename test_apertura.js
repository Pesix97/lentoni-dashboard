// La pagina si apre davvero?
//
// NATO DA UN GUASTO IN PRODUZIONE, il 29/08/2026. Una variabile scritta male dentro un
// template letterale - `gruppo` invece di `group` - ha prodotto un ReferenceError a runtime:
// il JavaScript moriva alla prima riga della classifica per reparto, quindi niente menu
// laterale, niente sezioni nascoste, tutte e diciassette una sotto l'altra. La dashboard era
// inutilizzabile, ed e' finita online.
//
// Il punto non e' l'errore di battitura: e' che TRE reti di sicurezza l'hanno lasciato
// passare, perche' nessuna faceva la domanda piu' semplice.
//
//   node --check          controlla la SINTASSI, e la sintassi era giusta
//   test_ruoli.js         chiama le funzioni una per una, ma quella riga viveva dentro
//                         un template letterale che nessun test eseguiva
//   test_pipeline.py      controlla che le sezioni esistano nel FILE, non che si aprano
//
// Centodue controlli JavaScript e novanta Python, e nessuno montava i pezzi per vedere se
// la cosa si accendeva. Questo file fa solo quello.
//
// Uso:  node test_apertura.js [percorso/index.html]

const fs = require("fs");

let JSDOM;
try {
  ({ JSDOM } = require("jsdom"));
} catch (e) {
  console.error("jsdom non installato: `npm install jsdom`. Senza, questo controllo non gira.");
  process.exit(2);
}

const file = process.argv[2] || "index.html";
if (!fs.existsSync(file)) {
  console.error(`File non trovato: ${file}`);
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

const errori = [];
const dom = new JSDOM(fs.readFileSync(file, "utf-8"), {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  // Un URL vero e non about:blank: la pagina usa history.replaceState per ricordare quale
  // sezione e' aperta, e su about:blank quella chiamata esplode per conto suo. Un finto
  // fallimento del banco di prova e' peggio di nessun banco di prova.
  url: "https://pesix97.github.io/lentoni-dashboard/",
  beforeParse(w) {
    // Chart.js arriva da un CDN che qui non si raggiunge: si sostituisce con un guscio.
    // Non e' un compromesso: i grafici non sono cio' che questo controllo verifica.
    w.Chart = function () { return { destroy() {}, update() {} }; };
    w.Chart.register = () => {};

    // Un finto contesto 2D. Senza, la pagina muore su createLinearGradient mentre disegna
    // l'immagine da condividere, e non si distingue piu' un difetto vero da una mancanza
    // dell'ambiente di prova.
    const nulla = () => {};
    const ctx = new Proxy({}, {
      get: (_, k) => {
        if (k === "createLinearGradient" || k === "createRadialGradient" || k === "createPattern")
          return () => ({ addColorStop: nulla });
        if (k === "measureText") return () => ({ width: 10 });
        if (k === "canvas") return { width: 1000, height: 1000 };
        return nulla;
      },
    });
    w.HTMLCanvasElement.prototype.getContext = () => ctx;
    w.HTMLCanvasElement.prototype.toDataURL = () => "data:,";

    w.addEventListener("error", (e) => errori.push(e.message || String(e.error)));
  },
});

const d = dom.window.document;

setTimeout(() => {
  console.log("\nLa pagina si apre");

  // 1. Nessun errore. E' il controllo per cui questo file esiste.
  verifica("il JavaScript gira senza errori", errori.length === 0, errori.slice(0, 3).join(" | "));

  // 2. Il menu laterale. E' la prima cosa che sparisce quando il JavaScript muore presto,
  //    ed e' anche come il guasto del 29/08 si e' manifestato a schermo.
  const voci = d.querySelectorAll("#navLinks *").length;
  verifica("il menu laterale ha delle voci", voci >= 5, `ne ha ${voci}`);

  // 3. Le tabelle che il JavaScript riempie. Se restano vuote, la pagina "c'e'" ma non
  //    dice niente - ed e' il modo in cui un guasto puo' passare inosservato. Un archivio
  //    davvero vuoto (il primo giorno di un titolo nuovo) e' pero' un caso legittimo che va
  //    distinto da un guasto: la rosa e la classifica in quel caso mostrano una riga
  //    placeholder ("Nessun giocatore trovato"), quindi "ha delle righe" resta vero anche
  //    a zero giocatori. E' voluto, non e' cio' che questo controllo deve intercettare.
  const riempite = [
    ["classifica generale", "#powerTable tbody tr"],
    ["rosa", "#rosterTable tbody tr"],
    // La sezione "Classifiche complete" e' stata assorbita dalla tabella dei giocatori il
    // 01/09/2026: al suo posto si controlla che quella tabella sappia aggiungere colonne.
    ["barra delle colonne aggiuntive", "#rosterColonne .filter-btn"],
    ["intestazioni ordinabili", "#rosterHead th[data-key]"],
  ];
  riempite.forEach(([nome, sel]) => {
    const n = d.querySelectorAll(sel).length;
    verifica(`la ${nome} ha delle righe`, n > 0, `ne ha ${n}`);
  });

  // 4. I contenitori che le altre reti gia' controllano nel file, qui verificati DOPO che
  //    il JavaScript li ha riempiti: esistere ed essere pieni sono due cose diverse.
  //
  //    #serateFiltri fa eccezione: renderSerate() lo RIMUOVE apposta quando non c'e'
  //    nessuna serata (stessa scelta di "Nessun giocatore trovato" per la rosa, solo che
  //    qui il contenitore sparisce invece di restare vuoto) - non e' un buco, quindi si
  //    verifica separatamente invece di pretendere che esista sempre.
  const pieni = ["forza", "diagnosiTabella", "wrappedGrid"];
  pieni.forEach((id) => {
    const el = d.getElementById(id);
    verifica(`#${id} esiste ed e' stato riempito`,
      !!el && el.innerHTML.trim().length > 0, el ? "vuoto" : "non esiste");
  });
  const nessunaSerata = !!d.querySelector("#serataDettaglio .empty");
  if (nessunaSerata) {
    verifica("#serateFiltri assente perche' non c'e' nessuna serata in archivio (rimosso apposta)", true);
  } else {
    const el = d.getElementById("serateFiltri");
    verifica("#serateFiltri esiste ed e' stato riempito",
      !!el && el.innerHTML.trim().length > 0, el ? "vuoto" : "non esiste");
  }

  // 5. Il dettaglio dell'efficienza tecnica, che e' cio' che ha rotto la pagina - ma solo
  //    se c'e' almeno un giocatore: a zero giocatori non c'e' nessuna colonna Tecnica da
  //    aprire, e non e' un guasto, e' l'unico stato possibile con zero dati.
  const haGiocatori = d.querySelectorAll("#rosterTable .player-link").length > 0;
  if (haGiocatori) {
    const aperture = d.querySelectorAll(".tec-apri").length;
    const dettagli = d.querySelectorAll("tr.tecnica-detail").length;
    verifica("i numeri della colonna Tecnica sono cliccabili", aperture > 0, `ne ha ${aperture}`);
    verifica("ogni numero cliccabile ha la sua riga di dettaglio",
      dettagli === aperture, `${aperture} cliccabili contro ${dettagli} dettagli`);
  } else {
    verifica("nessun giocatore in questo archivio: salto i controlli sulla colonna Tecnica", true);
  }

  // E i dettagli devono partire CHIUSI: aperti tutti insieme la tabella e' illeggibile.
  const apertiSubito = d.querySelectorAll("tr.tecnica-detail.open").length;
  verifica("i dettagli partono chiusi", apertiSubito === 0, `${apertiSubito} gia' aperti`);

  // Le intestazioni della tabella giocatori devono RISPONDERE al clic, non solo esistere.
  // Il 01/09/2026 sono rimaste mute per un giro: le celle si ricostruiscono da `outerHTML`,
  // che si portava dietro il marcatore "ascoltatore gia' attaccato" senza l'ascoltatore.
  // Esistevano, avevano il data-key giusto, erano perfette a guardarle - e non facevano
  // niente. Da qui il controllo: si clicca davvero e si guarda se l'ordine cambia. Anche
  // qui serve almeno un giocatore: con una sola riga placeholder non c'e' niente da
  // riordinare, e "prima e dopo restano uguali" sarebbe un fallimento del controllo, non
  // della pagina.
  if (haGiocatori) {
    const nomePrimo = () => {
      const c = d.querySelector("#rosterTable tbody tr td:nth-child(2)");
      return c ? c.textContent.trim() : null;
    };
    const th = (k) => [...d.querySelectorAll("#rosterHead th")].find(t => t.dataset.key === k);
    const partenza = nomePrimo();
    if (th("games_played")) th("games_played").click();
    const dopoPresenze = nomePrimo();
    verifica("cliccare un'intestazione riordina la tabella",
      partenza !== null && dopoPresenze !== null && partenza !== dopoPresenze,
      `prima ${partenza}, dopo ${dopoPresenze}`);

    // Secondo clic sulla stessa: l'ordine si inverte, e chi era primo non lo e' piu'.
    if (th("games_played")) th("games_played").click();
    verifica("il secondo clic inverte il verso",
      nomePrimo() !== dopoPresenze, `resta ${nomePrimo()}`);

    // E il segno di quale colonna sta ordinando deve seguire il clic.
    const ordinata = d.querySelector("#rosterHead th.ordinata");
    verifica("l'intestazione ordinata e' segnalata",
      !!ordinata && ordinata.dataset.key === "games_played" && !!ordinata.dataset.verso,
      ordinata ? `${ordinata.dataset.key} ${ordinata.dataset.verso}` : "nessuna");
  } else {
    verifica("nessun giocatore in questo archivio: salto i controlli sull'ordinamento", true);
  }

  // 6. Una sezione alla volta. La dashboard e' una pagina sola che ne mostra una per volta:
  //    se il JavaScript muore prima di nasconderle, si vedono tutte impilate - ed e'
  //    esattamente cosi' che il guasto e' apparso a chi guardava.
  const sezioni = [...d.querySelectorAll("section")];
  const visibili = sezioni.filter(s => dom.window.getComputedStyle(s).display !== "none");
  verifica("le sezioni non sono tutte visibili insieme",
    visibili.length < sezioni.length,
    `${visibili.length} visibili su ${sezioni.length}: il JavaScript non le ha nascoste`);

  console.log(falliti ? `\n${falliti} controlli falliti.\n` : "\nLa pagina si apre e si riempie.\n");
  process.exit(falliti ? 1 : 0);
}, 1200);
