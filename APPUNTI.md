# Appunti — questioni aperte

Aggiornato il 21/08/2026. Il README spiega **come funziona** il progetto; qui c'è solo
quello che è **rimasto in sospeso**, così una conversazione nuova parte informata.

---

## Da fare quando capita

**Le eccezioni CC/CDC.** In `roles.json` la lista `eccezioni_partita` è vuota. Serve
perché Pesix_97, ktm-008 e domenicocasaburi giocano COC a turno, e per EA un COC e un CC
sono la stessa etichetta `midfielder`: di default tutte le loro partite contano tra gli
attaccanti, che è la regola voluta dal club. Quando uno di loro gioca davvero da CC o CDC,
quella partita va elencata lì.

Basta indicare quando ("la seconda di giovedì", "quella contro I Razzi"), i `match_id` si
recuperano dal database. Segnarselo sul momento funziona; a distanza di giorni no — a
metà agosto ci abbiamo provato con 11 partite ambigue e non erano più ricostruibili.

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
Si può eliminare, ma vale la pena tenerlo ancora qualche giorno come rete di sicurezza.

---

## Programmato per settembre

Tutto quello che è stato rimandato ha lo stesso motivo: **serve un archivio più grande**.
Al 21/08 le partite archiviate erano 33, e a ~7 per sessione a settembre saranno diverse
centinaia. Queste cose oggi non si possono né costruire bene né testare davvero.

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
proposto e volutamente rimandato: tarare un algoritmo nuovo su 33 partite non ha senso.
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

**Una serata vera con il ciclo nuovo.** Al 21/08 il ciclo interno (7 controlli ogni 20
minuti per esecuzione) non ha ancora attraversato una sessione di gioco completa. È la
prova che conta: la sera del 20 agosto si erano persi dati per un buco di quattro ore
nella pianificazione di GitHub.

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
