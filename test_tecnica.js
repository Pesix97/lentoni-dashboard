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
// Chart.js e' vendorizzato inline dal 30/09/2026: tolto qui prima di dare la pagina a
// jsdom, altrimenti girerebbe per davvero contro un <canvas> che jsdom non implementa
// (vedi lo stesso commento, piu' esteso, in test_apertura.js).
const html = fs.readFileSync(file, "utf-8")
  .replace(/<script id="lib-chartjs">[\s\S]*?<\/script>/, "");
const dom = new JSDOM(html, {
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
    efficienzaTecnica, MEDIE_TECNICA, DATA, sommaGolSubiti,
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
  // Quattro pezzi dal 27/10/2026: il quarto (gol subiti ogni 90') pesa solo per i difensori.
  const PEZZI = ["passaggi", "contrasti", "tiro", "difesa"];
  function sommaDettaglio(tec, gruppo) {
    const p = T.PESI_TECNICA_PER_REPARTO[gruppo] || T.PESI_TECNICA;
    const pesoW = tec.pesoForma;
    return PEZZI.reduce((tot, k) => {
      if (!p[k]) return tot;
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
    `le righe sommano alla colonna (${combinazioni} casi: ${finestre.length} finestre x ${pesi.length} pesi)`,
    peggiore.scarto < 0.005,
    peggiore.scarto
      ? `${peggiore.chi} con finestra ${peggiore.finestra} e peso ${peggiore.peso}: ` +
        `colonna ${peggiore.colonna.toFixed(2)}, dettaglio ${peggiore.dettaglio.toFixed(2)}`
      : "");

  // 2. I due lati esistono e portano le PROPRIE prove. E' l'altra meta' del difetto: il
  //    dettaglio mostrava i tentativi di carriera accanto a percentuali di forma, quindi
  //    non smorzava niente proprio dove il campione era piccolo.
  // A zero giocatori (titolo appena passato, nessuna partita ancora) non c'e' nessuna
  // forma da mescolare: e' l'unico stato possibile con zero dati, non un guasto. Stessa
  // distinzione di haGiocatori in test_apertura.js.
  const haGiocatori = w.document.querySelectorAll("#rosterTable .player-link").length > 0;
  if (haGiocatori) {
    const conForma = T.computeBlendedScores(30, 0.5).filter((s) => s.formAvailable);
    verifica("qualcuno ha davvero una forma recente da mescolare", conForma.length > 0,
      `ne ha ${conForma.length}`);
    const tentativiDistinti = conForma.every((s) =>
      PEZZI.every((k) => {
        const d = s.tecnica.pezzi[k];
        return d.formaTent !== null && d.formaTent !== undefined && d.formaTent <= d.carTent;
      }));
    verifica("ogni lato porta i propri tentativi, e quelli della finestra non superano la carriera",
      tentativiDistinti);
  } else {
    verifica("nessun giocatore in questo archivio: salto i controlli sulla forma recente", true);
  }

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
  if (haGiocatori) {
  const primo = w.document.querySelector("#powerTable tbody tr.tecnica-detail");
  verifica("il riquadro del dettaglio esiste nella pagina", !!primo);
  if (primo) {
    const righe = primo.querySelectorAll(".tecq-riga:not(.tecq-totale)").length;
    verifica("il riquadro ha tre righe, quattro per un difensore", righe === 3 || righe === 4,
      `ne ha ${righe}`);
    // La percentuale scritta nella riga deve essere quella che GENERA i punti a fianco: e'
    // la versione visibile dello stesso difetto: mostrare un numero e calcolarne un altro.
    // Scritte qui a mano, non lette dalla pagina: e' il riferimento indipendente. I gol
    // subiti vanno al contrario (4 -> 0); la stessa formula regge, con max - min negativo.
    const SCALE = { "passaggi riusciti": [60, 90], "contrasti riusciti": [5, 50],
                    "tiri trasformati": [10, 50], "gol subiti ogni 90'": [4, 0] };
    let incoerenti = 0;
    primo.querySelectorAll(".tecq-riga:not(.tecq-totale)").forEach((r) => {
      const eti = r.querySelector(".tecq-eti").textContent.trim();
      const pct = parseFloat(r.querySelector(".tecq-val").textContent);
      const peso = parseFloat(r.querySelector(".tecq-peso").textContent.replace("×", "")) / 100;
      const punti = parseFloat(r.querySelector(".tecq-punti").textContent);
      const [min, max] = SCALE[eti] || [0, 100];
      const attesi = 100 * peso * Math.max(0, Math.min(1, (pct - min) / (max - min)));
      // La soglia deve reggere il doppio arrotondamento della pagina: la percentuale e'
      // scritta a un decimale (errore fino a 0.05) e i punti pure (fino a 0.05). Il caso
      // peggiore e' "passaggi riusciti" per attaccanti/esterni: peso 45%, scala di 30 punti
      // (60-90), quindi un decimo di percentuale vale 100*0.45/30 = 1.5 punti di errore.
      // Massimo teorico: 1.5*0.05 (sulla percentuale) + 0.05 (sui punti) = 0.125.
      //
      // Trovato il 02/09/2026: Pesix_97, passaggi riusciti, scarto 0.100 - dentro
      // l'arrotondamento lecito della pagina, ma sopra la vecchia soglia di 0.1. Il
      // controllo bloccava la pubblicazione per un falso positivo, e la pagina e' rimasta
      // ferma 8 ore mentre il database continuava ad aggiornarsi sotto.
      if (Math.abs(attesi - punti) > 0.15) incoerenti++;
    });
    verifica("la percentuale mostrata è quella che produce i punti", incoerenti === 0,
      `${incoerenti} righe su ${righe}`);

    const totale = primo.querySelector(".tecq-totale .tecq-punti");
    const cella = w.document.querySelector("#powerTable tbody tr .tec-apri");
    verifica("il totale del riquadro e' il numero della colonna",
      totale && cella && totale.textContent.trim() === cella.textContent.trim(),
      totale && cella ? `riquadro ${totale.textContent.trim()}, colonna ${cella.textContent.trim()}` : "");
  }
  } else {
    verifica("nessun giocatore in questo archivio: salto i controlli sul riquadro del dettaglio", true);
  }

  // 6. I gol subiti dei difensori (27/10/2026). Ogni controllo parte da un riferimento che
  //    non passa dal codice della pagina: i pesi scritti qui, le righe grezze di DATA.
  console.log("\nI gol subiti ogni 90' dei difensori");
  const P = T.PESI_TECNICA_PER_REPARTO;
  const sommeOk = Object.entries(P).every(([, p]) =>
    Math.abs(p.passaggi + p.contrasti + p.tiro + (p.difesa || 0) - 1) < 1e-9);
  verifica("in ogni reparto i pesi della tecnica sommano a 100%", sommeOk);
  verifica("i pesi dei difensori sono 25/40/5/30",
    P.DIFENSORI.passaggi === 0.25 && P.DIFENSORI.contrasti === 0.40 &&
    P.DIFENSORI.tiro === 0.05 && P.DIFENSORI.difesa === 0.30,
    JSON.stringify(P.DIFENSORI));
  verifica("fuori dalla difesa i gol subiti non pesano",
    Object.entries(P).every(([g, p]) => g === "DIFENSORI" || !p.difesa));

  // La direzione: piu' gol subiti, meno tecnica. Se la scala fosse girata al contrario
  // tutto il resto passerebbe lo stesso, e premierebbe chi ne prende di piu'.
  const base = { passaggi: 1000, contrasti: 100, tiro: 50, difesa: 50 };
  const pochi = T.efficienzaTecnica(80, 25, 30, "DIFENSORI", base, 1.0);
  const tanti = T.efficienzaTecnica(80, 25, 30, "DIFENSORI", base, 3.5);
  verifica("un difensore che subisce meno gol ha piu' tecnica", pochi > tanti,
    `1 gol/90' -> ${pochi.toFixed(2)}, 3,5 gol/90' -> ${tanti.toFixed(2)}`);
  const attA = T.efficienzaTecnica(80, 25, 30, "ATTACCANTI", base, 1.0);
  const attB = T.efficienzaTecnica(80, 25, 30, "ATTACCANTI", base, 3.5);
  verifica("per un attaccante i gol subiti non cambiano niente", Math.abs(attA - attB) < 1e-9);

  // Senza minuti in campo si vale la media del club, non zero gol (= punteggio pieno).
  const senzaMinuti = T.efficienzaTecnica(80, 25, 30, "DIFENSORI",
    { passaggi: 1000, contrasti: 100, tiro: 50 }, 0);
  const allaMedia = T.efficienzaTecnica(80, 25, 30, "DIFENSORI",
    { passaggi: 1000, contrasti: 100, tiro: 50, difesa: 1e9 }, T.MEDIE_TECNICA.difesa);
  verifica("senza minuti in campo un difensore vale la media del club, non il massimo",
    Math.abs(senzaMinuti - allaMedia) < 1e-6,
    `senza minuti ${senzaMinuti.toFixed(2)}, alla media ${allaMedia.toFixed(2)}`);

  // Le righe che non devono contare, provate una per una: sui dati veri la riga con 0
  // secondi e un gol subito (27/10/2026) e' di qualcuno fuori rosa, quindi il confronto
  // con l'archivio qui sotto non se ne accorgerebbe mai.
  const acc = { gol: 0, secondi: 0 };
  T.sommaGolSubiti(acc, { goals_conceded: 3, seconds_played: 0 });
  T.sommaGolSubiti(acc, { goals_conceded: null, seconds_played: 5400 });
  T.sommaGolSubiti(acc, { goals_conceded: 2 });
  verifica("non contano le righe senza minuti in campo o senza gol subiti",
    acc.gol === 0 && acc.secondi === 0, JSON.stringify(acc));
  T.sommaGolSubiti(acc, { goals_conceded: 2, seconds_played: 2700 });
  verifica("e una riga valida conta per il suo tempo", acc.gol === 2 && acc.secondi === 2700,
    JSON.stringify(acc));

  // Il valore di carriera contro le righe grezze dell'archivio, rifatto qui da capo:
  // gol subiti diviso minuti, solo righe con entrambi i dati e almeno un secondo in campo.
  if (haGiocatori) {
    const grezzi = new Map();
    Object.values(T.DATA.matchPlayers || {}).forEach((righe) => (righe || []).forEach((r) => {
      if (r.goals_conceded == null || !(r.seconds_played > 0)) return;
      const a = grezzi.get(r.player_name) || { g: 0, s: 0 };
      a.g += r.goals_conceded; a.s += r.seconds_played;
      grezzi.set(r.player_name, a);
    }));
    verifica("l'archivio porta davvero i gol subiti", grezzi.size > 0, `giocatori: ${grezzi.size}`);
    const diversi = [];
    T.computeBlendedScores(30, 0.5).forEach((s) => {
      const a = grezzi.get(s.r.player_name);
      const atteso = a ? a.g * 5400 / a.s : 0;
      const d = s.tecnica.pezzi.difesa;
      if (!d || Math.abs(d.car - atteso) > 1e-9) diversi.push(`${s.r.player_name}: ${d && d.car} vs ${atteso}`);
    });
    verifica("i gol subiti di carriera sono quelli delle righe dell'archivio", diversi.length === 0,
      diversi.slice(0, 3).join("; "));

    // Nella pagina: chi gioca in difesa ha la quarta riga, chi no non ce l'ha.
    const dettDif = w.document.querySelectorAll('tr.tecnica-detail[id^="tec-r-DIFENSORI-"]');
    const dettAltri = w.document.querySelectorAll('tr.tecnica-detail[id^="tec-r-"]:not([id^="tec-r-DIFENSORI-"])');
    const conRiga = (tr) => [...tr.querySelectorAll(".tecq-eti")].some((e) => e.textContent.includes("gol subiti"));
    verifica("nelle classifiche per reparto ogni difensore ha la riga dei gol subiti",
      dettDif.length > 0 && [...dettDif].every(conRiga), `riquadri da difensore: ${dettDif.length}`);
    verifica("e negli altri reparti la riga non compare", [...dettAltri].every((tr) => !conRiga(tr)));

    // Ogni riquadro della classifica generale contro la SUA colonna, non solo il primo.
    // (Confrontare le righe del riquadro con il suo totale non basterebbe: escono dallo
    // stesso calcolo e tornano sempre - verificato togliendo la riga dei gol subiti.)
    const celle = [...w.document.querySelectorAll('#powerTable tbody .tec-apri[data-tec^="g-"]')];
    const storti = celle.filter((c) => {
      const tr = w.document.getElementById("tec-" + c.dataset.tec);
      const tot = tr && tr.querySelector(".tecq-totale .tecq-punti");
      return !tot || tot.textContent.trim() !== c.textContent.trim();
    });
    verifica("nella classifica generale ogni riquadro ha il totale della sua colonna",
      celle.length > 0 && storti.length === 0,
      `${storti.length} su ${celle.length} non tornano` + (storti[0] ? ` (es. ${storti[0].dataset.tec})` : ""));

    // Quanti riquadri devono avere i gol subiti lo dice roles.json (il reparto abituale
    // scritto nella rosa), non la pagina: in FC 26 nessuno era difensore abituale.
    const attesi = new Set((T.DATA.roster || []).filter((r) => r.gruppo === "DIFENSORI").map((r) => r.player_name));
    const conGol = new Set(celle.filter((c) => {
      const tr = w.document.getElementById("tec-" + c.dataset.tec);
      return tr && [...tr.querySelectorAll(".tecq-eti")].some((e) => e.textContent.includes("gol subiti"));
    }).map((c) => c.dataset.tec.slice(2)));
    const uguali = attesi.size === conGol.size && [...attesi].every((n) => conGol.has(n));
    verifica("i gol subiti compaiono nel riquadro generale esattamente dei difensori abituali", uguali,
      `difensori abituali: ${[...attesi].join(", ") || "nessuno"}; con la riga: ${[...conGol].join(", ") || "nessuno"}`);
  }

  // 7. Il testa a testa spezza la tecnica con i pesi DEL REPARTO di ciascuno (27/10/2026).
  //    Fino ad allora usava i pesi dell'attacco per tutti: il totale tornava lo stesso,
  //    perche' i punti si ripartiscono in proporzione, e per questo il controllo "i pezzi
  //    sommano alla riga" in test_ruoli.js non poteva accorgersene. Il riferimento qui sono
  //    i riquadri STAMPATI nella classifica generale: il pezzo k del confronto deve valere
  //    t * (punti_k di A - punti_k di B) / (tecnica di A - tecnica di B), dove t e' la riga
  //    dell'efficienza tecnica nel confronto.
  if (haGiocatori) {
    console.log("\nIl testa a testa spezza la tecnica con i pesi di ciascuno");
    const selA = w.document.getElementById("h2hA");
    const selB = w.document.getElementById("h2hB");
    const voci = w.document.getElementById("h2hVoci");
    const ETI = { "Passaggi riusciti": "passaggi riusciti", "Contrasti vinti": "contrasti riusciti",
                  "Realizzazione": "tiri trasformati", "Gol subiti ogni 90'": "gol subiti ogni 90'" };
    const riquadro = (nome) => {
      const tr = w.document.getElementById("tec-g-" + nome);
      const m = new Map();
      if (!tr) return m;
      tr.querySelectorAll(".tecq-riga:not(.tecq-totale)").forEach((r) =>
        m.set(r.querySelector(".tecq-eti").textContent.trim(), parseFloat(r.querySelector(".tecq-punti").textContent)));
      return m;
    };
    const leggiPunti = (frammento, sinistra) =>
      [...frammento.matchAll(/([+−])[\d.]*?([\d.]+) punti\s*<span[^>]*>\s*a ([^<]+?)\s*<\/span>/g)]
        .map((m) => (m[3].trim() === sinistra ? 1 : -1) * Number(m[2]))
        .concat([...frammento.matchAll(/>\s*pari\s*</g)].map(() => 0));
    const difensori = (T.DATA.roster || []).filter((r) => r.gruppo === "DIFENSORI").map((r) => r.player_name);
    const nomi = [...selA.options].map((o) => o.value);
    let coppie = 0, senzaRiga = 0, sbagliati = 0, peggiore = { scarto: 0 };
    difensori.forEach((d) => nomi.filter((n) => n !== d).forEach((x) => {
      selA.value = d; selB.value = x;
      selA.dispatchEvent(new w.Event("change"));
      const h = voci.innerHTML;
      const rigaTech = (h.match(/Efficienza tecnica([\s\S]*?)<details/) || [])[1];
      const tendina = (h.match(/<details[\s\S]*?<\/details>/) || [])[0];
      if (!rigaTech || !tendina) return;
      const t = leggiPunti(rigaTech, d)[0];
      const RA = riquadro(d), RB = riquadro(x);
      const den = [...RA.values()].reduce((s, v) => s + v, 0) - [...RB.values()].reduce((s, v) => s + v, 0);
      if (!tendina.includes("Gol subiti")) senzaRiga++;
      if (Math.abs(den) < 3 || Math.abs(t) < 0.5) return;   // rapporto troppo sensibile agli arrotondamenti
      coppie++;
      tendina.split('<div style="padding:6px 0;">').slice(1).forEach((pezzo) => {
        const eti = Object.keys(ETI).find((k) => pezzo.includes(k));
        if (!eti) return;
        const num = (RA.get(ETI[eti]) || 0) - (RB.get(ETI[eti]) || 0);
        const atteso = t * num / den;
        const visto = leggiPunti(pezzo, d)[0];
        // Ogni riga del riquadro e' arrotondata a 0,05: 0,1 sul numeratore, fino a 0,4 sul
        // denominatore (quattro righe per parte). Propagati sul rapporto, piu' 0,05 per
        // l'arrotondamento del pezzo stampato e 0,05 su t.
        const tolleranza = 0.1 + Math.abs(t) * (0.1 / Math.abs(den) + Math.abs(num) * 0.4 / (den * den));
        const scarto = Math.abs(visto - atteso);
        if (scarto > tolleranza) sbagliati++;
        if (scarto > peggiore.scarto) peggiore = { scarto, d, x, eti, visto, atteso };
      });
    }));
    if (difensori.length === 0) {
      verifica("nessun difensore abituale in questo archivio: salto il confronto testa a testa", true);
    } else {
      verifica("con un difensore il testa a testa mostra i gol subiti", senzaRiga === 0,
        `${senzaRiga} confronti senza la riga`);
      verifica(`ogni pezzo del testa a testa torna con i riquadri stampati (${coppie} coppie)`,
        coppie > 0 && sbagliati === 0,
        peggiore.d ? `${sbagliati} fuori; peggiore ${peggiore.d} contro ${peggiore.x}, ${peggiore.eti}: ` +
          `${peggiore.visto} invece di ${peggiore.atteso.toFixed(2)}` : `coppie controllate: ${coppie}`);
    }
  }

  console.log(falliti === 0
    ? `\nTutto quadra. Scarto massimo misurato: ${peggiore.scarto.toExponential(1)}`
    : `\n${falliti} controlli falliti.`);
  process.exit(falliti === 0 ? 0 : 1);
}, 1200);
