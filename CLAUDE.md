# Come si lavora a questo progetto

Dashboard del club EA FC Pro Clubs "Lentoni". Questo file viene letto automaticamente
quando si lavora in questa cartella: contiene il **modo di lavorare**, non la descrizione
tecnica. Per quella c'è `README.md`; per quello che è rimasto in sospeso, `APPUNTI.md`.

## Le regole, in ordine di importanza

**1. Verificare prima di affermare.** Se una cosa si può misurare con un comando, si
misura e poi si dice. Nessuna eccezione, nemmeno per le cose che sembrano ovvie.

Questa regola nasce da errori veri, tutti dello stesso tipo — **interpretare un sintomo
invece di misurarne la causa**:

- una proiezione sul peso del repository ha inventato una crisi inesistente partendo da un
  `du` letto su oggetti git non compattati;
- una classifica di fonti alternative poggiava su un errore HTTP 500 scambiato per una
  pagina costruita in JavaScript;
- tre affermazioni sulla pianificazione di GitHub date senza controllare i log.

**2. Efficienza.** Poche parole. Niente preamboli, niente annunci di quello che si sta per
fare, niente riepiloghi di quello che si è appena fatto se i numeri parlano da soli.

**3. Rendicontare in tabella** quando le cose da dire sono più di tre.

**4. Dire i dubbi prima di procedere.** Se una scelta ha conseguenze visibili sulla
dashboard, si chiede prima. Una modifica all'interfaccia è già stata annullata: succede, ed
è più economico chiedere.

**4-bis. Dire quando si è d'accordo a metà, invece di annuire.** Se Peppe esprime
un'opinione e il parere è diverso, va detto — con il motivo, non come obiezione di
principio. Vale anche quando la conclusione coincide ma la ragione no: "sono d'accordo a
toglierla, ma non perché faceva confusione" è un'informazione, "sì hai ragione" non lo è.

Un sì automatico costa il doppio: non aggiunge niente sul momento e toglie valore a tutti i
sì successivi, perché non si distinguono più da quelli veri. Se la questione è di gusto o
di priorità la decisione resta sua — ma la deve prendere sapendo cosa ne pensa l'altro.

**5. Non chiudere le conversazioni.** Niente formule di commiato, niente "buonanotte" o
"a presto" non richiesti. È stato fatto notare due volte.

**6. Verificare che un controllo nuovo sappia fallire.** Dopo aver scritto un test, romperlo
apposta e guardarlo fallire, poi ripristinare. Un test che non si è mai visto rosso non
dimostra niente.

**6-bis. Non "funziona?", ma "cosa dice?".** Sono due prove diverse, e superare la prima
non dice niente sulla seconda. Il passaggio a un titolo nuovo era stato provato il
23/08/2026 e la prova era passata — la pagina si generava, quindici sezioni presenti,
nessun `NaN`. Intanto l'intestazione diceva **"Club"** e un allarme era rotto: cose visibili
a occhio, che nessuno aveva guardato perché si stava controllando che non esplodesse.
Dopo aver verificato che una cosa gira, leggere cosa ha prodotto.

**7. Un controllo che si fida dell'output non controlla niente.** Deve partire da un
riferimento indipendente da ciò che verifica. Tre test scritti il 24/08/2026 passavano
mentre il codice era rotto, tutti per questo motivo:

| Il test | Perché era cieco |
| --- | --- |
| somma dei tre pezzi dell'efficienza tecnica | cercava il primo valore dopo l'etichetta e finiva nel riepilogo della tendina: confrontava un numero con se stesso |
| colore del testa a testa | ricavava il nome di riferimento dal testo stampato dalla pagina, quindi seguiva il codice invece di controllarlo |
| attribuzione dei punti | guardava una coppia sola su sessantasei, e non era fra le ventuno in cui il difetto si vedeva |

Le contromisure che funzionano: leggere i valori **stampati** e non ricalcolarli, ancorarsi
ai **dati di partenza** (il valore vero di un menu, non il nome che la pagina scrive), e
provare **tutti i casi**, non quello che si apre per primo.

## Cosa cercare quando qualcosa non torna

I guasti di questo progetto **non sono crash**. Sono numeri plausibili e sbagliati, e
nessun errore compare da nessuna parte. Casi reali:

| Sintomo | Causa |
| --- | --- |
| metà scheda giocatore vuota | le righe non portavano il `match_id`, ogni ricerca falliva in silenzio |
| "+206%" e "−202%" | percentuali su valori che attraversano lo zero o si moltiplicano |
| un giocatore con 1 partita sopra un titolare con 40 | campioni piccoli pesati come quelli grandi |
| terzo in classifica senza partite giocate | chi non aveva dati teneva il punteggio pieno |
| partite "mancanti" che erano in archivio | contatore di EA (pubblicazione) confrontato con `played_at` (gioco) |

Il filo comune: **confrontare cose non confrontabili**. Quando un numero sorprende, la
prima ipotesi è questa.

## Chi trova i problemi

Quasi tutti i difetti statistici veri sono stati trovati **usando** la dashboard, non
leggendo il codice — perché il codice faceva esattamente quello che gli era stato detto.
Quando arriva una segnalazione dal club, va presa sul serio e verificata subito sui dati:
finora sono risultate corrette tutte.

## Prima di considerare finito qualcosa

```
python3 generate_dashboard.py --db lentoni.db --out index.html
python3 -m unittest test_pipeline
node test_ruoli.js index.html
node test_apertura.js index.html     # apre davvero la pagina: serve `npm install jsdom`
```

**L'ultimo non è opzionale, ed è nato da un guasto in produzione.** Il 29/08/2026 una
dashboard inutilizzabile è finita online con tutti gli altri controlli verdi: una variabile
scritta male dentro un template letterale, `ReferenceError` a runtime, niente menu e
diciassette sezioni impilate. Sintassi giusta, ancore tutte presenti, 192 controlli passati.
Nessuno montava i pezzi per vedere se la cosa si accendeva.

**Il "Come funziona" della dashboard spiega COME FUNZIONA, non cosa abbiamo fatto.** È una
distinzione che si perde da sola: ogni modifica lascia la tentazione di scrivere lì perché è
stata fatta, e il riquadro diventa un diario. Il 29/08/2026 quello dell'Indice di Forza era
arrivato a 739 parole di cui la metà erano date, correlazioni misurate e «prima non era
così». Riscritto in 343, al presente.

La regola: **nel riquadro va solo ciò che serve a leggere il numero che si ha davanti** —
le voci, i pesi, le scale, cosa significa una colonna. Il *perché* di una scelta, le misure
che l'hanno motivata e ciò che c'era prima vanno nel README, che esiste per quello.

**La documentazione va nello stesso commit, non dopo.** Un passo separato è quello che
salta quando si va di fretta: il 25/08/2026 quattro modifiche importanti sono finite online
documentate a metà, in un pomeriggio solo, e non perché la regola mancasse. Se una modifica
merita una riga in README o APPUNTI, quella riga fa parte della modifica.

E se sono stati toccati file, numeri o soglie citati nei testi: `TestDocumentazioneAllineata`
verifica che README e APPUNTI dicano ancora il vero. Le frasi **datate** ("al 24/08 erano 59
partite") non si toccano mai: restano vere per sempre. Solo le affermazioni **al presente**
vanno mantenute.

Infine, se è cambiato uno di questi documenti, va rigenerata la pagina che Peppe usa per
leggerli — Windows non apre i `.md`:

```
python3 "../Claude - skill/genera-documenti.py"
```

Produce `Downloads\Documenti.html`. È una **copia**: se non si rigenera, lui legge la
versione vecchia senza accorgersene.

## Toccare l'automazione: due cautele, e sono nate da un danno

Le modifiche a `giro.sh`, al workflow e a tutto ciò che regola il ciclo **non si pubblicano
nelle ore vicine alle partite** (si gioca fra le 22:00 e le 03:00). Se una modifica al ciclo
è pronta la sera, aspetta la mattina dopo: un difetto lì non si vede subito, si vede quando
mancano le partite, e allora è tardi.

**Se una modifica tocca due parametri che interagiscono, la relazione fra i due va scritta
come test PRIMA di pubblicare.** Non dopo il guasto, non "ci stiamo attenti".

Perché sono regole e non consigli. Il 27/08/2026, alle 10:22, sono stati pubblicati insieme
un ciclo più lungo (da 2h20 a 5h20) e un cron in più (da uno a due l'ora). Erano entrambe
difese *contro* i buchi, entrambe sensate prese una per una, e i test erano verdi. Nessuno
copriva l'interazione: con `cancel-in-progress` attivo, un ciclo più lungo dell'intervallo
fra due partenze non finisce mai. Una mina innescata, pubblicata dodici ore prima di una
serata di gioco.

## La diagnosi: guardare l'esito, non l'esistenza

La notte del 27/08 l'automazione è rimasta ferma **sedici ore**, e la diagnosi ha sbagliato
**due volte, in direzioni opposte**:

1. dal battito si è concluso *«GitHub non lancia»* — corretto, ma dedotto da un'assenza;
2. davanti a *«ci sono un sacco di run»* si è ribaltato tutto e data la colpa alle nostre
   impostazioni, scrivendolo nel README. Erano run da `push` e di giorni prima.

La verità è emersa solo guardando la lista filtrata per `event: schedule`: **zero righe** il
27 agosto, né riuscite né cancellate. La firma dello scarto per carico, che GitHub documenta
apertamente — i lavori programmati vengono ritardati sotto carico, l'inizio di ogni ora è il
picco, e alcuni vengono *scartati*. I cron erano a `:00` e `:30`.

La lezione non è «guarda le Actions» né «guarda l'ultima modifica», ma:

> **Guarda l'esito, non l'esistenza.** Una lista piena di run non dice niente finché non
> sai di che tipo sono e come sono finiti. E un'assenza è un dato, non un vuoto da riempire
> con l'ipotesi più comoda.

Il filtro giusto, da usare sempre prima di concludere qualcosa sull'automazione:

```
.../actions/workflows/aggiorna-dashboard.yml?query=event%3Aschedule
```

## Pubblicazione

Il token GitHub **non è memorizzato da nessuna parte**, per scelta. Va chiesto, usato
inline in un singolo comando di push, e non deve mai finire in `.git/config` né nei log —
filtrare l'output con `sed 's/github_pat_[A-Za-z0-9_]*/[TOKEN]/g'`.
