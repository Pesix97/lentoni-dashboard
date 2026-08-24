# Appunti — questioni aperte

Aggiornato il 24/08/2026. Il README spiega **come funziona** il progetto; qui c'è solo
quello che è **rimasto in sospeso**, così una conversazione nuova parte informata.

**Regola di questo file: se una riga qui dentro non è più vera, va corretta subito.** Il
21/08 diceva che le eccezioni di ruolo erano zero — ne sono state scritte 109 nei tre
giorni successivi, e per un po' nessuno se n'è accorto. Un appunto che mente è peggio di
un appunto che manca, perché una conversazione nuova ci si fida.

Dal 24/08 la regola non dipende più dalla memoria: `test_pipeline.py` contiene una classe
`TestDocumentazioneAllineata` che verifica le affermazioni **al presente** — i file
elencati esistono, i file esistenti sono elencati, i numeri dichiarati sono quelli veri, le
soglie citate sono quelle del codice. Appena l'ha eseguita la prima volta ha trovato due
omissioni (`ruoli.py` e `serata.py` mancavano dalla tabella del README) e un conteggio
fermo a 32 test su 46.

Le frasi **datate** ("al 24/08 le partite erano 59") restano vere per sempre e non vanno
toccate: è la differenza fra raccontare la storia e descrivere lo stato.

---

## Da fare quando capita

**Le eccezioni di ruolo: risolto, e non più un problema aperto.** Al 21/08 la lista
`eccezioni_partita` era vuota e il rischio era dimenticarsene. Al 24/08 sono **109**, e
soprattutto esiste un meccanismo che chiede invece di aspettare:

- `serata.py` raggruppa le partite in serate e mostra la griglia dei ruoli;
- un'attività pianificata (`lentoni-conferma-serata`) la propone ogni mattina alle 11:03;
- le serate confermate sono elencate in `serate_confermate` con **quante partite avevano
  alla conferma**: se EA ne pubblica altre dopo, la serata torna in coda da sola;
- quelle di cui nessuno ricorda più niente stanno in `serate_chiuse`, lista separata,
  perché "confermata" e "chiusa senza verifica" non sono la stessa cosa.

Resta vero il principio che ha fatto nascere tutto: segnarsi i fuori ruolo sul momento
funziona, a distanza di giorni no. Per questo la domanda arriva la mattina dopo.

**Le notifiche del controllo battito: rinunciato.** Il task `lentoni-controllo-battito`
gira ogni giorno alle 13:00 ma non manda notifiche. Non è stato possibile attivarle dalla
sessione che lo ha creato (nata a sua volta da un task pianificato), e da una chat nuova
il task non risultava nemmeno visibile — anche aprendola dall'app desktop. Il motivo non
è chiaro e non vale la pena inseguirlo.

Il ripiego funziona benissimo: l'esito resta nella sezione "Scheduled", e il battito è
consultabile in qualsiasi momento su
https://github.com/Pesix97/lentoni-dashboard/blob/stato/stato.json — trenta byte che
dicono se l'automazione è viva.

**Il vecchio task `lentoni-dashboard-update` è in pausa**, sostituito da GitHub Actions.
Al 24/08 l'automazione ha quattro giorni di funzionamento verificato alle spalle: la rete
di sicurezza ha esaurito il suo scopo e il task si può eliminare quando capita.

---

## Programmato per settembre

Tutto quello che è stato rimandato ha lo stesso motivo: **serve un archivio più grande**.
Al 24/08 le partite archiviate erano 59 (erano 33 il 21/08), e a ~9 per sessione a
settembre saranno diverse centinaia. Queste cose oggi non si possono né costruire bene né testare davvero.

### 1. Selettore del titolo nella dashboard

FC 27 è atteso per inizio ottobre. Database e script sono già pronti a contenere più
titoli insieme (vedi `club.json`), e ogni query filtra per club attivo — verificato
iniettando un secondo club finto e controllando che i numeri non cambiassero.

Manca il modo di passare da una stagione all'altra guardando la pagina. Va costruito
**prima** dell'uscita, ma non prima di settembre: con due mesi di partite si può simulare
il secondo titolo con dati veri invece che copiati.

### 2. Pesi specifici per reparto nell'Indice di Forza

Oggi il confronto tra pari ruolo corregge la **classifica**, non il **criterio**: un
difensore è ancora valutato per il 20% su gol e assist, solo rispetto ad altri difensori.

Un indice davvero fedele al ruolo peserebbe contrasti e clean sheet per chi sta dietro,
passaggi e assist per chi costruisce, precisione sotto porta per chi finalizza. Era stato
proposto e volutamente rimandato: tarare un algoritmo nuovo su poche decine di partite
non ha senso. Vedi anche il punto 6, che lo dimostra con i numeri.
Con qualche centinaio si potrà capire se i pesi alternativi producono classifiche sensate
o solo diverse.

### 3. Riprendere la sezione "Analisi serate"

Era stata costruita e poi rimossa il 21/08 perché il campione era troppo piccolo — sette
sessioni. Il codice è recuperabile dalla cronologia: **commit `7010b50`**.

Conteneva il rendimento in base a quante partite si erano già giocate quella sera (i dati
suggerivano 1.50 punti nelle prime tre contro 0.67 dalla quinta in poi) e le coppie di
giocatori in campo. Il difetto era evidente: quattro coppie di FFLI_Adriano avevano numeri
identici, perché erano semplicemente le stesse dieci partite viste da angoli diversi.

### 4. Idee proposte e mai realizzate

**Riepilogo dell'ultima serata** in cima alla dashboard: com'è andata ieri notte senza
doverlo chiedere. Non dipende dal campione, si può fare in qualsiasi momento.

**Traguardi**: chi sta per tagliare una cifra tonda (presenze, gol, assist).

### 5. Leve tenute da parte

**Spazio**: `matches.raw_json` occupa circa un terzo del database e duplica dati già
presenti in colonne vere.

**Manutenibilità**: `generate_dashboard.py` è un file da 3200 righe con HTML, CSS e
JavaScript dentro un'unica stringa.

---

### 6. Ripesare l'Indice di Forza sull'affidabilità misurata

Misurato il 24/08/2026 su 59 partite. Per ogni metrica ho confrontato la prima metà
dell'archivio con la seconda: se una misura dice qualcosa di vero, chi era sopra la media
prima dovrebbe esserlo anche dopo.

```
gol + assist            +0.63     l'unica cosa che persiste
scarto vs compagni      +0.19     debole, ma il doppio del voto grezzo
media voto              +0.07     praticamente rumore
premio migliore         +0.08     rumore
```

**L'indice attuale dà il 40% del peso alla metrica meno stabile (media voto) e il 20% alla
più stabile (gol+assist).** È pesato quasi al contrario, e nessuno se n'era accorto perché
quei pesi sembrano ragionevoli a chiunque li legga.

C'è anche un vizio strutturale: il voto di EA **già contiene** gol, assist e premi, quindi
sommarli come voci separate li conta due o tre volte.

Come rifarlo:

- pesare le metriche in base alla stabilità **misurata**, non stimata a sentimento;
- sostituire la media voto con lo **scarto rispetto ai compagni della stessa partita**, che
  cancella forza dell'avversario, andamento della squadra e stanchezza della serata — è la
  ragione per cui la sua affidabilità è il doppio di quella del voto grezzo;
- non sommare metriche correlate fra loro;
- mostrare l'affidabilità accanto al punteggio e **rimisurarla ogni mese**, lasciando che
  siano i dati a decidere i pesi.

Perché è rimandato e non fatto subito: con 59 partite e dieci giocatori, l'incertezza su
quelle correlazioni è di circa ±0.33. Il +0.63 è indicativo, non provato. In più, fra le
due metà il club ha cambiato modulo di continuo, e la prima metà è antecedente alla
pulizia di ruoli ed esclusioni: è la parte più sporca dell'archivio.

**La cosa da rifare a settembre non è l'indice: è la misura.** Lo script che l'ha prodotta
va rieseguito quando le partite saranno il doppio, e solo allora i pesi vanno riscritti.
Con 59 partite nessun indice regge davvero, incluso quello che proporrei io.

## Verifiche ancora aperte

**Il collaudo del ciclo: superato tre volte.** Le notti del 21, 22 e 23 agosto il ciclo
ha attraversato sessioni complete di 7, 9 e 10 partite. Ogni volta il contatore di EA e
l'archivio hanno detto lo stesso numero: **zero partite perse**. La prova che mancava al
21/08 è stata fatta, e ripetuta.

**Quello che resta non verificato** è il comportamento a PC spento con l'app chiusa. Il
23/08 l'app era chiusa e ha funzionato, il che basta a dire che non dipende da Cowork;
manca solo la prova formale a macchina spenta, che è una formalità visto che tutto gira
sui server di GitHub.

---

## Leve rimaste, se un giorno servissero

**Spazio.** `matches.raw_json` occupa da solo circa un terzo del database e duplica dati
già presenti in colonne vere. Nessuno lo legge. Toglierlo — o tenerlo solo per le partite
recenti — ridurrebbe di un terzo il peso di ogni commit. Va contro il principio "non
perdere nessun campo di EA" su cui è nato il progetto, quindi è una scelta da fare a
mente fredda, non una necessità.

**Manutenibilità.** `generate_dashboard.py` è un file da 3200 righe che contiene HTML,
CSS e JavaScript dentro un'unica stringa. Funziona, ma ogni modifica è una sostituzione
di testo dentro quella stringa. Separare template, stile e logica in file distinti,
assemblati alla generazione, non cambierebbe il risultato ma renderebbe più semplice
tutto quello che verrà dopo.
---

## Come si lavora a questo progetto

Le stesse regole vivono in tre posti, con raggi d'azione diversi: qui, in `CLAUDE.md`
(letto automaticamente da Claude appena lavora in questa cartella) e nella skill
`lentoni-dashboard`, che compare in ogni sessione anche senza aprire il progetto. Se una
regola cambia, vanno aggiornati tutti e tre.

Questa sezione non parla di codice. Serve a una conversazione nuova — o a una che ha perso
la memoria delle prime ore — per non ripetere errori già fatti.

**Verificare prima di affermare.** È la regola più importante, e nasce da tre affermazioni
imprecise sulla pianificazione date senza controllare. Se una cosa si può misurare con un
comando, si misura e poi si dice. Vale anche per le proprie conclusioni: il 23/08 una
proiezione sul peso del repository ha inventato una crisi inesistente perché partiva da un
`du` letto male, e il 24/08 una classifica di siti alternativi poggiava su un errore 500
scambiato per una pagina in JavaScript. Due volte lo stesso vizio: interpretare un sintomo
invece di misurarne la causa.

**Efficienza prima di tutto.** Poche parole, niente preamboli, niente riepiloghi di quello
che si sta per fare. I risultati con i numeri accanto.

**Rendicontare in tabella** quando le cose da dire sono più di tre.

**Dire i dubbi prima di procedere**, non dopo. Quando una scelta ha conseguenze visibili
sulla dashboard, si chiede.

**Non chiudere le conversazioni.** Niente formule di commiato, niente "buonanotte" non
richiesti: è stato fatto notare due volte.

**Le correzioni migliori arrivano da chi gioca.** Quasi tutti i difetti statistici veri
sono stati trovati usando la dashboard, non leggendo il codice: eredes terzo senza partite,
un giocatore con una presenza sopra un titolare, confronti fra due eccezioni. Il codice
faceva esattamente quello che gli era stato detto — per questo nessun test poteva
accorgersene. Quando arriva una segnalazione così, va presa sul serio subito.

---

## Decisioni prese, da non rifare

**La formazione tipo resta com'è.** Il 23/08 era stata riscritta sui reparti di
`roles.json` (sei posti reali invece di un 3-4-1-2 con cinque caselle riempite da stime).
La modifica è stata **annullata su richiesta**, per ripensarla meglio. Il codice è nella
storia di git, commit `e9f0b6c` per il ripristino. Non va rifatta senza chiederlo.

**Premi e Stats divertenti sono stati rimossi il 23/08**, non persi. Erano intrattenimento
copiato dalle funzioni di proclubstracker, e il progetto ha preso la direzione opposta:
descrivere come si gioca invece di premiare chi sta davanti.

**L'archetipo di EA non si usa mai**, per decisione esplicita del club.

**Il COC conta fra gli attaccanti**, sempre, anche se EA lo etichetta `midfielder`.

**La soglia per entrare in classifica nei reparti è 3**, scelta sapendo il compromesso.
Va rialzata solo se il club lo chiede.

---

## Cose imparate, da non riscoprire

- EA espone solo le **ultime 10 partite**. Non esiste paginazione: testati `offset`,
  `page`, `startIndex`, `before`, `beforeTimestamp`, `timestampBefore`, tutti ignorati.
- EA pubblica i risultati con **ore di ritardo** — misurate fino a tre.
- Le API di EA rispondono **403 da un data center**: i runner GitHub non possono usarle,
  serve proclubstracker. In locale è il contrario: proclubstracker richiede un browser.
- La **pianificazione di GitHub Actions non è puntuale**: ritardi fino a un'ora ed
  esecuzioni saltate. Da qui il ciclo interno.
- `VACUUM` di SQLite **non è deterministico**: ricompattare lo stesso contenuto produce
  byte diversi. Va eseguito solo quando c'è davvero qualcosa da pubblicare.
- EA restituisce campi volatili (`teamId`, `kitId`) che cambiano ad ogni chiamata pur non
  significando nulla.
- EA elenca solo i giocatori **umani** di ogni partita, di solito 5 o 6. Il resto sono CPU.
- Le partite **abbandonate o interrotte** non vengono conteggiate da EA.
