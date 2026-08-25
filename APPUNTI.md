# Appunti — questioni aperte

Aggiornato il 25/08/2026. Il README spiega **come funziona** il progetto; qui c'è solo
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

**L'indice dà il 50% del peso alla metrica meno stabile (media voto) e il 20% alla più
stabile (gol+assist).** È pesato quasi al contrario, e nessuno se n'era accorto perché quei
pesi sembrano ragionevoli a chiunque li legga. Il 24/08 il MOTM è sceso dal 15% al 5% e i
dieci punti sono andati proprio alla media voto: era la scelta del club, fatta sapendo che
va nella direzione opposta a questa (vedi sotto, "Cosa si è misurato provando a tarare").

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

### Cosa si è misurato provando a tarare (24/08/2026)

Prima di toccare i pesi sono state confrontate quattro tarature: quelle attuali, una pesata
sull'affidabilità, una sul legame con la vittoria, e la stessa senza le voci circolari.

| | si conferma nel tempo | sale nelle vittorie |
| --- | --- | --- |
| efficienza tecnica | **+0.71** | +0.44 |
| gol + assist | **+0.63** | +0.47 |
| % vittorie | +0.17 | — |
| MOTM | +0.08 | +0.79 |
| media voto | +0.07 | +0.58 |

Tre cose ne sono uscite, e vanno tenute a mente prima di riprovare:

1. **Le voci si somigliano troppo.** Media voto, gol+assist, MOTM e % vittorie sono
   correlate fra loro da +0.49 a +0.84: spostare peso dall'una all'altra non cambia la
   classifica. L'unica voce indipendente è l'efficienza tecnica — che però è correlata
   **negativamente** con le vittorie (−0.39). Capire cosa misuri davvero viene prima di
   darle peso.
2. **Nessuna taratura è più riproducibile delle altre.** Su 400 divisioni casuali
   dell'archivio, i pesi attuali danno +0.72 e le alternative +0.67/+0.68. La taratura
   "migliore" batte quella in uso in 4 divisioni su 400.
3. **Una sola divisione a metà inganna.** Con la divisione cronologica le alternative
   sembravano nettamente meglio (+0.48 contro +0.21). Era una divisione fortunata, e per
   giunta confusa dal fatto che fra le due metà il club ha cambiato modulo.

### Il testa a testa ora spiega il distacco (24/08/2026)

Il vecchio confronto mostrava un grafico a barre con gol e assist come **totali di carriera**
accanto a delle percentuali: con 541 partite contro 96, il più anziano vinceva sempre anche
rendendo meno. È stato sostituito dalla scomposizione del distacco nell'Indice di Forza.

**Il punto di vista è il giocatore scelto a sinistra**, non chi sta più in alto in
classifica. Verde e barra a sinistra quando è lui in vantaggio in quella voce, rosso e barra
a destra quando è in svantaggio. Scambiando i due menu i colori si invertono, ed è
voluto: ancorare il colore a chi sta primo obbligava a ricordarsi ogni volta quale dei due
fosse, e rendeva il grafico inutile.

Tre cose da non rompere:

- **Le voci devono sommare al distacco.** È la promessa scritta nella sezione, ed è
  verificata su tutte le coppie da `test_ruoli.js`, leggendo i numeri *stampati* e non
  ricalcolandoli: un difetto può stare nel modo in cui vengono mostrati (per esempio il
  segno dei cartellini) e un controllo che rifà il conto per conto suo non se ne accorge.
- **I valori grezzi mostrati sono mescolati come il punteggio.** Mostrare la media di
  carriera accanto a un punteggio che contiene anche la forma produceva righe assurde tipo
  «+13.4 punti, 7.10 contro 7.10». Funziona perché la normalizzazione è lineare: mescolare
  i valori grezzi dà lo stesso risultato che mescolare i normalizzati.
- **I tre pezzi dell'efficienza tecnica si attribuiscono ripartendo il totale ottenuto**,
  in proporzione a quanto ciascuno contribuisce alla differenza. Dividere invece per
  l'ampiezza della scala sembra più diretto e **non torna in 21 coppie su 66**: la parte
  storica e quella di forma si normalizzano su intervalli che non coincidono, e chi esce
  dai bordi viene schiacciato.

Allargare le scale per comprendere anche i valori di forma è stato **provato e scartato**:
risolverebbe lo schiacciamento (nella vista predefinita nessuno cambia posizione, scarto
massimo 1,7 punti) ma richiede di cambiare anche la normalizzazione dello storico, che oggi
usa un intervallo calcolato per conto suo. Farne metà è peggio di non farne: le due metà
dell'indice finirebbero su scale diverse. Se un giorno si riprende, vanno cambiate insieme.

### La percentuale di contrasti misura in parte la selettività (24/08/2026)

Chi tenta più contrasti ha la percentuale più bassa: **correlazione −0,78**. Non è un caso —
se tenti solo i duelli facili li vinci quasi sempre.

| | % vinti | tentati a partita | vinti a partita |
| --- | --- | --- | --- |
| Smilzo_87 | 9% | 12,9 | 1,16 |
| ktm-008 | 9% | 12,6 | 1,13 |
| gio05596 | 58% | 1,8 | 1,02 |
| Pesix_97 | 42% | 1,3 | 0,56 |

Il 9% di ktm è calcolato su 5233 contrasti, il 42% di Pesix su 502: il dato di ktm è dieci
volte meglio sostenuto, e in contrasti vinti a partita ne fa il doppio.

**Le altre due voci non hanno questo vizio**: tiri +0,36 e passaggi +0,44, cioè chi ne fa di
più ha percentuali migliori. Il difetto è solo nei contrasti.

Sostituire la percentuale con i **contrasti vinti a partita** è stato proposto e **scartato
dal club**: la voce si chiama efficienza e deve restare efficienza, chi tenta tanto e
sbaglia tanto va penalizzato lo stesso. I contrasti sono invece scesi dal 20% al **10%**
dentro l'efficienza tecnica. La classifica generale è identica con i contrasti al 20, 15,
10 o 5 per cento: cambia solo il valore della voce, non le posizioni.

**Il dribbling non è disponibile.** Verificato su colonne del database, campi EA per
giocatore/partita e campi di carriera: non esiste. L'unica traccia è
`match_event_aggregate_0`, 146 codici numerici non documentati; nessuno di essi coincide
con un valore noto (gol, tiri, passaggi, contrasti), quindi non è decodificabile senza
inventare.

## Il laboratorio: costruito, misurato e rimosso (25/08/2026)

Era una sezione sperimentale con quattro modi diversi di fare la stessa classifica, per
decidere con i numeri davanti quali tenere. **È stata tolta lo stesso giorno**, su richiesta
del club: con 69 partite le prove erano troppo povere di dati per significare qualcosa.

La decisione è coerente con quello che le prove stesse dicevano — vedi l'ultima riga della
tabella. Il codice è nella storia di git; qui restano le misure, che valgono comunque e
vanno rilette quando l'archivio sarà molto più grande.

Cosa hanno detto le prove su 69 partite:

| Prova | Esito |
| --- | --- |
| **Minuti giocati davvero** | **non sposta nessuno.** Scartare le prestazioni sotto i 5 minuti e rapportare gol e assist al tempo in campo cambia i punteggi di poco e le posizioni di zero. Si può buttare |
| **Scarto rispetto ai compagni** | cambia 4 posizioni su 11 |
| **Scala a percentili** | cambia 6 posizioni su 11 |
| **Fasce di incertezza** | **33 coppie su 55 hanno forchette che si sovrappongono** |

L'ultima riga è la più importante e non è una variante della classifica: è una lettura di
quella che c'è già. Rifacendola 500 volte su campioni diversi delle stesse partite, dal
secondo al settimo posto non c'è **nessuna differenza misurabile**. Regge il primo posto, e
regge lo stacco fra il gruppo di testa e quello di coda.

**Le tre cose da ricordare quando si riproverà:**

1. i minuti giocati non contano — è già misurato, non serve rifarlo;
2. se l'obiettivo è una classifica *fra compagni*, le fasce sono la risposta più onesta, ma
   hanno senso solo quando saranno abbastanza strette da separare qualcuno;
3. prima di toccare i pesi va rifatta la misura di affidabilità (punto 6 qui sopra).

E la lezione che vale al di là di questo caso: **una misura può essere corretta e lo stesso
inutile**. Le quattro prove erano giuste, i controlli passavano, il calcolo era esatto — ma
non c'erano abbastanza partite perché dicessero qualcosa. Prima di costruire uno strumento
di analisi conviene chiedersi se i dati bastano a farlo parlare.

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

**L'Indice di Forza generale non si filtra per reparto**, dal 25/08/2026. Quei bottoni
promettevano una cosa che quella classifica non può mantenere: è calcolata sulle carriere
complete, e nelle carriere EA non registra in che ruolo si è giocato. Il reparto era quindi
quello abituale di `roles.json`, uno solo per giocatore, e filtrare "Centrocampisti"
rispondeva a "chi fa il centrocampista di mestiere" mentre chi leggeva capiva "chi ha
giocato a centrocampo".

Il caso che l'ha fatto notare: Maverik_44_ ha **4 partite a centrocampo su 20** ma ruolo
abituale ESTERNI, quindi filtrando i centrocampisti spariva — e sembrava un dato mancante.
Le sue presenze sono 10 da esterno, 4 a centrocampo, 4 in difesa, 2 in attacco: in "Reparto
per reparto" compare in tutti e quattro.

Il difetto non era nel calcolo ma nell'avere **due file di bottoni identici a pochi
centimetri di distanza con significati diversi**, senza niente a dirlo. Non vanno rimessi.

**"Come regge la serata" è stata tolta il 24/08/2026** dalle schede giocatore, perché
misurava rumore. Confrontava le prime due partite della serata con quelle dalla quinta in
poi, e dava un giudizio con due decimali. Tre misure, in ordine di gravità:

| Cosa è stato misurato | Risultato |
| --- | --- |
| il confronto è fra popolazioni diverse — la quinta partita esiste solo nelle serate lunghe, 7 su 10 | ricalcolandolo dentro la stessa serata, 4 giudizi su 10 cambiano e 2 invertono il segno |
| si conferma nel tempo? prime 5 serate contro ultime 5 | affidabilità **+0.13** su 6 giocatori: uno passa da +0.92 a −0.20 |
| esiste almeno per la squadra? | pendenza **+0.013** voto per partita, p = **0.70**, intervallo del caso da −0.06 a +0.06 |

Non va rifatta finché l'archivio non raddoppia, e comunque solo dopo aver rieseguito
`python3 affidabilita.py --serata`. Il codice tolto è documentato nel commento che ha
lasciato al suo posto, in `modello/pagina.js`.

---

## Cose imparate, da non riscoprire

- La **media voto di carriera arriva da EA con un solo decimale** (7.1, non 7.13). Le
  medie a due cifre che si vedono in rosa e nell'Indice di Forza sono quindi un decimale
  vero e uno zero di formattazione. Dove invece la media è calcolata sulle partite
  archiviate — classifiche per reparto, formazione tipo — le due cifre sono entrambe vere.
  Le due colonne non sono confrontabili: la prima è su centinaia di partite di carriera, la
  seconda solo sulle archiviate. Al 24/08/2026 Ironman-6-6 aveva 7.1 di carriera e 7.62
  sull'archivio, e non è un errore. Mostrare la media esatta sull'archivio è stato proposto
  e **scartato**: il dato EA non migliorerebbe comunque, e aggiungere una terza colonna di
  medie confondibili con le altre due costa più di quanto renda.
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
