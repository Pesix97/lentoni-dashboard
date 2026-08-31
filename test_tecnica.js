// Il dettaglio spiega davvero il numero della colonna?
//
// NATO DA UNA SEGNALAZIONE, il 31/08/2026. Nella classifica generale la colonna Tecnica
// diceva 68 e il riquadro che si apre cliccandoci sopra, sulla stessa riga dello stesso
// giocatore, diceva 71. Alla vista predefinita lo scarto arrivava a sette punti.
//
// La causa: la colonna mescola le due efficienze GIA' CALCOLATE (carriera e forma), mentre
// il dettaglio mescolava le tre percentuali grezze e rifaceva il conto da capo. Le due cose
// coincidono solo se il calcolo e' lineare, e la tecnica non lo e': lo smorzamento dipende
// dai tentativi, e le scale tagliano a 0 e a 100.
//
// Nessun test poteva accorgersene, perche' tutti guardavano UNA cosa alla volta. Questo
// guarda due cose insieme e chiede che diano lo stesso numero:
//
//     somma dei punti delle tre righe del dettaglio  ==  valore della colonna Tecnica
//
// per ogni giocatore, per ogni finestra e per ogni peso della forma. E' l'unica proprieta'
// che rende quel riquadro una spiegazione invece di un secondo parere.
//
// Uso:  node test_tecnica.js [percorso/index.html]

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

const nulla = () => {};
const dom = new JSDOM(fs.readFileSync(file, "utf-8"), {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  url: "https://pesix97.github.io/lentoni-dashboard/",
  beforeParse(w) {
    w.Chart = function () { return { destroy() {}, update() {} }; };
    w.Chart.register = () => {};
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
  },
});

setTimeout(() => {
  const w = dom.window;

  // Le dichiarazioni `const` e `function` in cima a uno script classico non finiscono su
  // window: per raggiungerle si esegue un pezzo di codice DENTRO la pagina, che e' anche il
  // modo piu' onesto di provarle - sono esattamente gli stessi oggetti che usa la dashboard.
  const sc = w.document.createElement("script");
  sc.textContent = `window.__T = {
    computeBlendedScores, suScalaTecnica, versoLaMediaTecnica,
    PESI_TECNICA_PER_REPARTO, PESI_TECNICA, FORM_WINDOWS,
  };`;
  w.document.body.appendChild(sc);
  const T = w.__T;

  console.log("\nIl dettaglio della tecnica quadra con la colonna");

  if (!T || !T.computeBlendedScores) {
    verifica("le funzioni della tecnica sono raggiungibili", false, "window.__T non popolato");
    console.log(`\n${falliti} controlli falliti.`);
    process.exit(1);
  }

  // La stessa somma che disegna dettaglioTecnicaMista, rifatta qui in modo indipendente.
  function sommaDettaglio(tec, gruppo) {
    const p = T.PESI_TECNICA_PER_REPARTO[gruppo] || T.PESI_TECNICA;
    const pesoW = tec.pesoForma;
    return ["passaggi", "contrasti", "tiro"].reduce((tot, k) => {
      const d = tec.pezzi[k];
      const qCar = T.suScalaTecnica(T.versoLaMediaTecnica(d.car, d.carTent, k), k);
      const misto = d.forma !== null && pesoW > 0;
      const qFor = misto ? T.suScalaTecnica(T.versoLaMediaTecnica(d.forma, d.formaTent, k), k) : 0;
      const quota = misto ? (1 - pesoW) * qCar + pesoW * qFor : qCar;
      return tot + 100 * p[k] * quota;
    }, 0);
  }

  // 1. La quadratura, su tutte le combinazioni che l'interfaccia permette di scegliere.
  const finestre = T.FORM_WINDOWS || [30, 40, 0];
  const pesi = [0, 0.25, 0.5, 0.75, 1];
  let peggiore = { scarto: 0 };
  let combinazioni = 0;
  finestre.forEach((finestra) => {
    pesi.forEach((peso) => {
      T.computeBlendedScores(finestra, peso).forEach((s) => {
        combinazioni++;
        const scarto = Math.abs(sommaDettaglio(s.tecnica, s.r.gruppo) - s.grezziMescolati.tech);
        if (scarto > peggiore.scarto) {
          peggiore = { scarto, chi: s.r.player_name, finestra, peso,
                       colonna: s.grezziMescolati.tech,
                       dettaglio: sommaDettaglio(s.tecnica, s.r.gruppo) };
        }
      });
    });
  });
  verifica(
    `le tre righe sommano alla colonna (${combinazioni} casi: ${finestre.length} finestre x ${pesi.length} pesi)`,
    peggiore.scarto < 0.005,
    peggiore.scarto
      ? `${peggiore.chi} con finestra ${peggiore.finestra} e peso ${peggiore.peso}: ` +
        `colonna ${peggiore.colonna.toFixed(2)}, dettaglio ${peggiore.dettaglio.toFixed(2)}`
      : "");

  // 2. I due lati esistono e portano le PROPRIE prove. E' l'altra meta' del difetto: il
  //    dettaglio mostrava i tentativi di carriera accanto a percentuali di forma, quindi
  //    non smorzava niente proprio dove il campione era piccolo.
  const conForma = T.computeBlendedScores(30, 0.5).filter((s) => s.formAvailable);
  verifica("qualcuno ha davvero una forma recente da mescolare", conForma.length > 0,
    `ne ha ${conForma.length}`);
  const tentativiDistinti = conForma.every((s) =>
    ["passaggi", "contrasti", "tiro"].every((k) => {
      const d = s.tecnica.pezzi[k];
      return d.formaTent !== null && d.formaTent !== undefined && d.formaTent <= d.carTent;
    }));
  verifica("ogni lato porta i propri tentativi, e quelli della finestra non superano la carriera",
    tentativiDistinti);

  // 3. A peso zero il miscuglio sparisce e deve restare esattamente la carriera: e' il caso
  //    in cui il vecchio dettaglio era gia' giusto, e deve restare tale.
  const soloStorico = T.computeBlendedScores(30, 0);
  const identici = soloStorico.every((s) =>
    Math.abs(sommaDettaglio(s.tecnica, s.r.gruppo) - s.grezziMescolati.tech) < 0.005);
  verifica("a 100% storico il dettaglio coincide con la colonna", identici);

  // 4. Lo smorzamento nella formazione tipo. Per un anno i tentativi arrivavano con il nome
  //    sbagliato (a.passAtt invece di a.sumPassAttempts): tre `undefined`, e la funzione,
  //    scritta per tollerare il dato mancante, restituiva il valore grezzo. Silenzioso.
  const ruoli = w.document.querySelectorAll("#formazione *").length;
  verifica("la formazione tipo viene disegnata", ruoli > 0, `nodi trovati: ${ruoli}`);

  // 5. Il riquadro nella pagina vera: tre righe piu' il totale, e il totale mostrato deve
  //    essere quello della colonna arrotondato. Guardare l'HTML e non solo le funzioni e'
  //    il motivo per cui il guasto del 29/08 era passato.
  const primo = w.document.querySelector("#powerTable tbody tr.tecnica-detail");
  verifica("il riquadro del dettaglio esiste nella pagina", !!primo);
  if (primo) {
    const righe = primo.querySelectorAll(".tecq-riga:not(.tecq-totale)").length;
    verifica("il riquadro ha le tre righe dei pezzi", righe === 3, `ne ha ${righe}`);
    const totale = primo.querySelector(".tecq-totale .tecq-punti");
    const cella = w.document.querySelector("#powerTable tbody tr .tec-apri");
    verifica("il totale del riquadro e' il numero della colonna",
      totale && cella && totale.textContent.trim() === cella.textContent.trim(),
      totale && cella ? `riquadro ${totale.textContent.trim()}, colonna ${cella.textContent.trim()}` : "");
  }

  console.log(falliti === 0
    ? `\nTutto quadra. Scarto massimo misurato: ${peggiore.scarto.toExponential(1)}`
    : `\n${falliti} controlli falliti.`);
  process.exit(falliti === 0 ? 0 : 1);
}, 1200);
