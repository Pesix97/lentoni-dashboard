# Dashboard club "Lentoni" (EA FC, PS5)

Statistiche del club Lentoni (clubId `2703620`, piattaforma `common-gen5` = PS5),
raccolte dalle API pubbliche non ufficiali di EA e pubblicate come pagina web.

**Dashboard online:** https://pesix97.github.io/lentoni-dashboard/

Tutto si aggiorna da solo, **ogni ora, sui server di GitHub**. Non serve tenere acceso
nessun computer.

---

## Come funziona

Il workflow `.github/workflows/aggiorna-dashboard.yml` esegue `giro.sh` **sette volte a
distanza di venti minuti** quando parte dalla pianificazione, coprendo circa due ore per
ogni avvio. Dopo un push al codice ne esegue invece **uno solo**, perché lì serve solo
verificare che la modifica produca una pagina valida. Ogni giro:

1. legge da `club.json` quale club interrogare;
2. scarica i dati da proclubstracker.com;
3. li scompone nei file che la pipeline si aspetta (`raw/`, non versionati);
4. `ingest.py` li scrive nel database `lentoni.db`;
5. `avversari.py` raccoglie il livello dei club affrontati (dieci al massimo per giro);
6. `generate_dashboard.py` rigenera `index.html`;
7. se qualcosa è cambiato compatta il database e committa, altrimenti non tocca nulla;
8. aggiorna il **battito** sul ramo `stato`.

### Il battito

Ogni giro riscrive `stato.json` sul ramo `stato`, anche quando non c'è niente da
pubblicare. Serve a distinguere "l'automazione è viva e non c'era nulla da fare" da
"l'automazione è morta": sul ramo principale le due cose lasciano la stessa identica
traccia, cioè nessuna.

Si consulta qui: **[stato.json](../../blob/stato/stato.json)**. È un ramo orfano riscritto
ogni volta, quindi la sua cronologia è lunga uno e non pesa sul repository.

```json
{ "ultimo_giro": "2026-08-23T13:48:00Z", "partite": 49,
  "fonte": "ok", "ultimo_successo_fonte": "2026-08-23T13:48:00Z",
  "fallimenti_di_fila": 0, "problema": null }
```

**Il battito distingue tre guasti diversi**, che prima erano lo stesso silenzio:

| Sintomo | Significato |
| --- | --- |
| `ultimo_giro` vecchio di ore | l'automazione non gira più |
| `fonte: irraggiungibile` | l'automazione è viva, ma la fonte dei dati non risponde |
| `problema` valorizzato | la fonte risponde, ma la nostra pipeline si è rotta a valle |

Il secondo caso è quello che mancava, e conta perché **è indistinguibile da "non abbiamo
giocato"**: il ciclo continuerebbe a girare regolarmente scrivendo "fonte non
raggiungibile" in un log che nessuno legge, e il battito resterebbe verde perché diceva
solo "sono vivo". Ora il battito viene scritto **anche quando la fonte cade** — prima il
giro usciva prima di arrivarci — e porta da quanti giri consecutivi non risponde.

Perché è urgente e non cosmetico: EA espone solo le ultime 10 partite. Se la fonte resta
giù per una notte di gioco e nessuno se ne accorge, quelle partite escono dalla finestra e
sono perse per sempre.

Un task pianificato di Cowork (`lentoni-controllo-battito`) legge il battito ogni giorno
alle 13:00 e segnala quale dei tre guasti è in corso.

### Perché proclubstracker e non EA direttamente

Le API di EA rispondono **403 Access Denied** alle richieste che arrivano da un data
center — verificato il 20/08/2026 da un runner GitHub. proclubstracker espone gli stessi
identici dati, nella stessa forma, e risponde senza problemi. In compenso è il contrario
in locale: `proclubstracker.com` non è leggibile senza un browser che esegua JavaScript.

### Perché ogni ora

EA rende disponibili solo le **ultime 10 partite**. Quelle giocate oltre quel limite tra
un aggiornamento e l'altro spariscono per sempre: non esistono API per recuperarle.

Due fatti misurati il 21/08/2026 rendono la cadenza oraria necessaria:

- **EA pubblica i risultati con ore di ritardo.** Una sessione finita alle 02:10 era
  ancora invisibile alle 03:00, e completa solo dopo le 05:00.
- **La pianificazione di GitHub non è puntuale.** Due esecuzioni sono partite con ~60
  minuti di ritardo e una è stata saltata del tutto: comportamento noto per i repository
  pubblici.

### Perché due gruppi di concorrenza

Il ciclo pianificato e la verifica dopo un push vivono in **gruppi separati** e non si
cancellano a vicenda. Con un gruppo solo succedeva questo, misurato il 23/08/2026: su 28
push, **dodici sono stati seguiti da oltre venticinque minuti senza un giro automatico**.
Ogni pubblicazione di una modifica uccideva il ciclo che stava coprendo la notte, e la
finestra rimanente andava persa. Non è mai costato una partita solo perché non si stava
giocando in quei momenti.

Dentro il proprio gruppo `cancel-in-progress` resta attivo, così due cicli notturni non si
sovrappongono mai. Due esecuzioni contemporanee sullo stesso database non sono un problema:
`giro.sh` gestisce già il push respinto rifacendo un rebase.

### Il fuso orario, e perché le chiavi sono in UTC

L'ora italiana era una somma fissa di due ore. Funziona da marzo a ottobre e sbaglia tutto
il resto dell'anno:

```
UTC 24/12 22:10   →   in Italia sono le 23:10 del 24
                      con il vecchio calcolo: le 00:10 del 25
```

Oltre all'ora sbagliata, **le partite di fine serata sarebbero finite datate al giorno
dopo**. Ora si usa il fuso vero `Europe/Rome`, con la regola europea scritta a mano come
ripiego se manca il database dei fusi.

Le chiavi delle serate confermate sono invece **ancorate a UTC** (`2026-08-22T23:21Z`).
Costruirle sull'ora locale sembrava più leggibile, ma le legava al fuso in vigore quel
giorno: correggere l'ora legale avrebbe cambiato ogni chiave e fatto riaprire tutte le
conferme già date. La migrazione delle nove serate esistenti è stata verificata — nessuna
conferma persa, nessuna serata riaperta.

### Perché lo storico si assottiglia

Ogni istantanea dei giocatori pesa circa 6 KB dentro `index.html`, e ne viene salvata una a
ogni cambiamento: in una notte di gioco sono sette o otto. Misurato il 23/08/2026 questo
storico era il **31% della pagina**, e a quel ritmo avrebbe superato i 6 MB in un anno.

`generate_dashboard.py` pubblica quindi tutte le istantanee degli ultimi 7 giorni, una al
giorno per i due mesi precedenti e una a settimana per il resto. Su una simulazione di un
anno: **1460 istantanee diventano 131, da 9 MB a 0,8 MB**. Il primo e l'ultimo punto non si
toccano mai, così le curve non cambiano né inizio né fine — e il database conserva tutto,
si assottiglia solo ciò che finisce nella pagina.

Girare spesso non costa nulla perché senza dati nuovi il database non cambia e non viene
prodotto alcun commit. Il ciclo interno serve proprio a questo: basta **un** trigger
riuscito per coprire una finestra ampia, anche quando GitHub ne salta tre di fila.

---

## File

| File | Cosa fa |
| --- | --- |
| `index.html` | La dashboard pubblicata. **Generata**, non modificarla a mano. |
| `lentoni.db` | Database SQLite con tutto lo storico. |
| `ingest.py` | Scrive i JSON scaricati nel database. Nessuna chiamata di rete. |
| `avversari.py` | Raccoglie skill rating e record dei club affrontati. |
| `generate_dashboard.py` | Legge il database e assembla `index.html` dai pezzi in `modello/`. |
| `modello/pagina.html` | Struttura della pagina, con i segnaposto `__STILE__` e `__SCRIPT__`. |
| `modello/stile.css` | Tutto il CSS. |
| `modello/pagina.js` | Tutta la logica che gira nel browser. **File .js vero**: `node --check` lo verifica. |
| `giro.sh` | Un singolo giro completo: scarica, aggiorna, rigenera, pubblica, batte. |
| `club.json` | Quale club è attivo. **Unico file da toccare al passaggio a FC 27.** |
| `roles.json` | Ruoli reali dei giocatori, eccezioni per partita, ex giocatori. Scritto a mano. |
| `test_pipeline.py` | 32 test: ingest, duplicati, isolamento tra titoli, qualità dei dati, modello. |
| `test_ruoli.js` | 34 controlli su ruoli, formazione e scheda osservatore, eseguiti sulla pagina generata. |
| `raw/club_search.json` | Fotografia del club presa a mano, usata per stemma e regione. **Non** per la piattaforma. |

---

## club.json — quale club, quale titolo

Ogni titolo EA crea un club nuovo con un id diverso, ma le persone restano le stesse.
L'archivio tiene **tutti i titoli insieme**, distinti da `club_id`, e la dashboard ne
mostra uno alla volta: quello indicato in `attivo`.

Al passaggio a FC 27 si sposta il club corrente in `storico`, si scrive il nuovo in
`attivo`, e non serve toccare nient'altro. La **piattaforma mostrata viene da qui**, non da
`raw/club_search.json`: quel file è una fotografia presa a mano del club di FC 26 e avrebbe
continuato a dichiarare la piattaforma di quello vecchio, contraddicendo proprio la regola
dell'unico file da toccare. **La transizione è stata provata a vuoto il
23/08/2026**: con un club nuovo e zero partite la pagina si genera comunque, tutte e 15 le
sezioni ci sono, le guardie di pubblicazione passano e non compaiono `NaN` o valori vuoti.
`serata.py` risponde "Nessuna partita in archivio" invece di rompersi. Ogni query di `generate_dashboard.py` filtra
per club attivo — senza quel filtro due stagioni finirebbero sommate nella stessa rosa
senza che nulla lo segnali.

---

## roles.json — la mappa dei ruoli

EA conosce solo quattro etichette (`goalkeeper`, `defender`, `midfielder`, `forward`) e
**non sa distinguere un COC da un CC**: per lei sono entrambi "midfielder". Il ruolo reale
può quindi arrivare solo da un file mantenuto a mano.

Il gruppo indicato in `giocatori` è il ruolo **abituale**. Per la singola partita vince
invece il dato EA: se qualcuno viene schierato in una posizione diversa dalla sua, quella
partita conta nel reparto in cui ha davvero giocato.

Per i casi che EA non può distinguere esiste `eccezioni_partita`: una riga per partita,
e l'eccezione batte qualsiasi deduzione automatica.

```json
{ "match_id": "935736622260364", "quando": "04/08 22:47 CansaditosFC",
  "giocatore": "Pesix_97", "gruppo": "CENTROCAMPISTI" }
```

Modificare `roles.json` è sicuro: al giro successivo la dashboard si ricalcola **su tutto
lo storico**, non solo sulle partite future. Se il file è malformato, la generazione non
si ferma: ripiega sulle etichette EA e lo segnala nel log.

### Prestazioni che non contano

Quando qualcuno si disconnette, il CPU prende il controllo del suo pro ma EA continua ad
attribuire voto, gol e passaggi alla persona. Quella riga non racconta niente di vero, e
lasciandola dentro sposta le medie. Va elencata in `esclusioni_partita`:

```json
{ "match_id": "993784040560433", "quando": "22/08 01:55 albasrah",
  "giocatore": "Pesix_97", "motivo": "controllato dalla CPU" }
```

È una cosa diversa dalle eccezioni: quelle **correggono il reparto**, questa **toglie del
tutto la riga** dai calcoli che partono dalle partite — classifiche per reparto, indice di
forma, formazione tipo, schede osservatore. La riga sparisce dai dati prima che finiscano nella pagina,
quindi non c'è modo di dimenticarsene in un calcolo.

Resta invece dentro ai totali di carriera, perché quelli li somma EA e non sono
correggibili: è un limite, non una scelta. Il `motivo` è obbligatorio — senza, fra sei mesi
una statistica mancante sarebbe indistinguibile da una svista.

**Un caso si riconosce da solo** e non va elencato. Guardando la distribuzione dei voti su
tutto l'archivio (22/08/2026) è saltata fuori una discontinuità:

```
3.0    8 righe        ← e sotto, il vuoto
5.8    2 righe
6.0    3 righe
6.1    4 righe        ← da qui in su, continuo
```

Niente tra 3.0 e 5.8. E tutte e otto le righe da 3.0 avevano zero tiri e da tre a dieci
passaggi in un'ora di gioco. Non è il fondo di una scala: è **il valore che EA scrive
quando un voto non c'è**. La voce `voto_sentinella` in `roles.json` le esclude in
automatico, senza doverle segnalare una per una. Mettendola a `null` la regola si spegne e
le righe tornano.

Sulle medie pesava parecchio:

```
Pesix_97           7.36 → 7.83
Jysmu              7.20 → 7.58
Maverik_44_        6.43 → 6.77
ilmille            6.97 → 7.11
domenicocasaburi   7.40 → 7.52
```

### La domanda del mattino

Il punto debole di tutto l'impianto non è tecnico: è che le eccezioni dipendono dalla
memoria di chi ha giocato. Una serata non segnalata resta classificata male per sempre, e
niente lo indica.

Il 22/08/2026 ho provato a rilevarle dai numeri. **Non funziona**: le partite giocate
fuori ruolo hanno tiri, contrasti e passaggi identici a quelle normali, dentro la stessa
distribuzione. Un classificatore su quei dati produce rumore, e non va costruito.

Funziona invece un vincolo di formazione: **il club gioca con due esterni**, quindi quando
ne risulta uno solo o l'altra fascia la teneva la CPU, oppure la copriva un umano che di
solito gioca altrove. Misurata su 42 partite a eccezioni rimosse, intercetta 10 delle 12
correzioni note con 12 falsi allarmi.

Due regole che sembravano buone sono state scartate, ed è utile sapere perché:

| regola | esito |
|---|---|
| due della rotazione COC insieme tra gli attaccanti | segnalava 27 partite senza che ci fosse nulla da correggere: quando giocano insieme uno fa il COC e l'altro la punta, quindi sono attaccanti entrambi |
| quattro o più conteggiati a centrocampo | zero correzioni intercettate su dodici |
| tiri, contrasti e passaggi anomali per il ruolo | nessun segnale: i valori cadono dentro la distribuzione normale |

La prima è stata smontata da una frase di chi ci gioca, non dai dati. È il motivo per cui
lo strumento chiede invece di decidere.

Dieci su dodici non basta per decidere, ma basta per **accorciare la domanda**. Da qui:

```
python3 serata.py            l'ultima serata non ancora confermata
python3 serata.py --tutte    tutte quelle in sospeso
```

Stampa la griglia della serata — chi ha giocato dove, secondo la classificazione
automatica — con sotto le osservazioni delle regole strutturali e la chiave da incollare
in `serate_confermate` quando è tutto giusto. Le serate non confermate sono **marcate come
provvisorie anche sulla dashboard**, così se una mattina nessuno risponde i numeri non
diventano falsi di nascosto.

Le regole sono tarate larghe di proposito: un falso allarme costa una riga di risposta,
una svista costa un dato sbagliato per sempre.

**Una serata chiusa può riaprirsi.** Di ogni conferma si registra anche quante partite
aveva quel giorno:

```json
{ "serata": "2026-08-23 01:21", "partite": 7 }
```

Serve perché EA pubblica in ritardo. Il 23/08/2026 una serata è stata confermata con sei
partite e la settima è arrivata mezz'ora dopo, finendo dentro una serata già chiusa: tre
giocatori su cinque erano classificati male e **nessuno avrebbe più chiesto niente**. Ora
se il conteggio cresce la serata torna in coda, con un avviso che dice quante partite sono
arrivate dopo.

**Confermata e chiusa non sono la stessa cosa.** `serate_confermate` elenca le serate che
qualcuno ha guardato e dichiarato giuste. `serate_chiuse` elenca quelle di cui nessuno
ricorda più niente: ci si tiene la classificazione automatica sapendo che non è stata
verificata. Per la domanda del mattino valgono uguale — non le ripropone né l'una né
l'altra — ma restano separate nel file, perché mescolarle farebbe sembrare controllato
tutto l'archivio, che è esattamente la finta certezza che questo meccanismo evita.

Le 26 partite anteriori al 21/08/2026 sono chiuse così: sono quelle giocate quando ancora
niente chiedeva i ruoli il giorno dopo.

### Chi ha lasciato il club

La voce `ex_giocatori` elenca chi non fa più parte del gruppo. Viene escluso da tutta la
dashboard prima ancora che i dati entrino nella pagina, e il suo nome non compare nel file
pubblicato. Serve una lista esplicita perché **EA continua a restituirli tra i membri del
club** anche dopo che ne sono usciti: cancellarne le righe dal database sarebbe inutile,
il primo aggiornamento le riscriverebbe.

Non è una cancellazione: lo storico resta, e togliendo un nome dalla lista il giocatore
ricompare com'era.

---

## Test

```bash
python3 -m unittest test_pipeline -v          # pipeline e qualità dei dati
python3 generate_dashboard.py --db lentoni.db --out /tmp/prova.html
node test_ruoli.js /tmp/prova.html            # logica dei ruoli
```

Girano da soli ad ogni modifica del codice, tramite `.github/workflows/test.yml`.

Sono **deliberatamente fuori** dal workflow di aggiornamento: se un test avesse un difetto
bloccherebbe la raccolta dei dati, e una partita persa non si recupera. Proteggono le
modifiche, non devono poter fermare l'archiviazione.

Due dettagli utili. I test ricostruiscono i dati grezzi **dal database** invece di leggere
`raw/`, che non è versionato: girano ovunque, senza rete. E quelli JavaScript **estraggono
le funzioni dalla pagina generata** ed eseguono quelle, non una copia che potrebbe
divergere.

---

## Perché il modello sta in tre file

Fino al 23/08/2026 la pagina intera viveva dentro una stringa Python di 3711 righe, con
dentro 2903 righe di JavaScript. Il problema non era la lunghezza: **dentro una stringa
nessun editor sa che quel testo è JavaScript**, quindi un tag mai chiuso o una parentesi
di troppo non venivano segnalati da niente e si scoprivano solo aprendo la pagina.

Ora `modello/pagina.js` è un file `.js` vero e `node --check` lo verifica a ogni giro di
test. Il risultato pubblicato non cambia: `index.html` resta un unico file autonomo.

La separazione è stata fatta con una garanzia verificabile — **hash identico prima e
dopo**. Chiunque la rifaccia dovrebbe pretendere lo stesso: se `index.html` cambia anche
di un byte, qualcosa è andato storto.

## Cosa si aggiorna, e quando

Ogni giro riesegue `generate_dashboard.py`, che **ricalcola tutto da zero** partendo dal
database: schede osservatore, diagnosi vittorie/sconfitte, serate, classifiche. Non ci sono
valori congelati da qualche parte — la pagina è sempre una fotografia del database in quel
momento, esattamente come lo skill rating.

Due sole cose hanno un ritmo diverso, ed è bene saperlo quando si leggono i confronti con
gli avversari:

- lo **skill rating degli avversari** viene riscaricato solo se più vecchio di 14 giorni, al
  massimo quindici club per giro (`avversari.py`). Un avversario affrontato oggi porta il
  livello che aveva quando è stato interrogato, non quello di stasera;
- **16 partite su 49 non hanno l'id dell'avversario** nei dati EA, quindi restano fuori da
  ogni confronto per forza dell'avversario. Compaiono in tutto il resto.

## I campioni piccoli non pesano quanto quelli grandi

Segnalati il 24/08/2026, due sintomi della stessa causa:

- nell'Indice di Forza filtrato al **100% forma**, eredes risultava terzo **senza una sola
  partita archiviata**;
- tra gli ESTERNI, Ironman-6-6 compariva sopra chi in quel ruolo gioca da quaranta partite,
  con **una presenza**.

Il primo era un errore vero nel codice: chi non aveva dati di forma teneva il punteggio
storico **pieno** e continuava a competere nella stessa classifica. Non era valutato male,
non era valutato affatto. Ora chi non ha partite archiviate resta **fuori classifica**, in
fondo e con il motivo scritto: metterlo terzo sarebbe falso, metterlo ultimo pure.

Il secondo si corregge con la statistica. Ogni valore viene tirato verso la media del
reparto in proporzione a quante partite lo sostengono:

```
 1 partita  →  conta per il 17%,  il resto è la media del reparto
 3 partite  →  38%
 5 partite  →  50%
10 partite  →  67%
40 partite  →  89%
```

Non basta però da solo: con una partita il punteggio finisce **esattamente a metà
classifica**, e metà classifica è comunque sopra un titolare che rende sotto la media. Per
questo sotto le **5 presenze nel reparto** il giocatore resta in tabella con tutte le sue
cifre, ma senza posizione. Una partita non è un rendimento: si mostra, non si ordina.

## L'identità dei giocatori è il nome, non l'id

Nella pagina il nome del giocatore è la chiave **69 volte**; l'id numerico che EA assegna a
ogni persona compare **due volte in tutto**, solo per deduplicare le vecchie righe
ricostruite. Anche `roles.json` è indicizzato per nome.

Se qualcuno cambia il nome PSN, lo storico si spezza in due persone diverse: la nuova
compare senza ruolo tra i "da assegnare", e le medie di entrambe diventano sbagliate. Senza
alcun errore da nessuna parte.

Riscrivere l'identità sull'id EA vorrebbe dire toccare ogni chiave del progetto per un
guasto che non è ancora successo. Al suo posto c'è un **rilevamento**: se un id EA compare
con più di un nome, la generazione lo scrive nel log e un test lo verifica. Provato
simulando un cambio di nome su due partite — segnalato correttamente.

Il giorno che succede, la soluzione sarà una riga: rinominare a mano le righe vecchie, o
aggiungere una mappa di alias.

## Il peso del repository

Misurato il 23/08/2026, perché una proiezione fatta a occhio diceva il contrario:

```
clone locale, .git non compattato       5,9 MB
lo stesso dopo un repack                428 KB
repository come lo consegna GitHub      1,09 MiB per 107 commit
aggiungere una serata (7 partite)       +14 KiB nel pack
```

Git **sa** comprimere per differenze anche un file binario: le pagine di SQLite che non
cambiano vengono deltate senza problemi. Conservare il database come dump SQL testuale
farebbe risparmiare 3 KiB a serata, cioè niente, e non vale il rischio di riscrivere come
è custodito l'archivio.

A quattro serate a settimana la storia cresce di circa **15 MB in un anno**, contro il
gigabyte oltre il quale GitHub comincia a lamentarsi.

L'unica accortezza riguarda il clone locale, non il progetto. Git compatta da solo quando
gli oggetti sciolti superano una soglia, ma quella soglia **conta gli oggetti, non i
byte**: qui ce n'erano diciassette da 1,5 MB l'uno, lontanissimi dai 6700 previsti, e la
pulizia non partiva mai. Si risolve una volta sola, e sono impostazioni locali:

```
git config gc.auto 50
git config gc.autoPackLimit 10
```

Se un giorno la cartella venisse ricreata da zero, vanno rimesse — altrimenti `.git`
ricomincia a gonfiarsi senza che nulla lo segnali. Non ha conseguenze sulla dashboard né
sull'automazione: il runner di GitHub fa un checkout pulito a ogni giro.

## Struttura del database

- `club_info` — nome, piattaforma, stemma, kit del club.
- `club_stats_history` — uno snapshot per ogni cambiamento reale (W/L/T, gol, skill rating,
  piazzamenti). Le esecuzioni che non trovano novità non lasciano traccia.
- `member_stats_history` — stessa logica, per ogni giocatore.
- `matches` — una riga per partita, deduplicata su `match_id`.
- `match_player_stats` — statistiche per giocatore per partita.
- `opponent_clubs` — livello dei club affrontati.

`ingest.py` unifica automaticamente i giocatori con più account: vedi `NAME_ALIASES` in
cima al file (attualmente "Pinosix97" confluisce in "Pesix_97").

---

## Backup

**La cronologia di git è il backup.** Ogni commit di `lentoni.db` è uno stato completo e
recuperabile:

```bash
git log --oneline -- lentoni.db     # trova il commit buono
git show <commit>:lentoni.db > lentoni.db
```

Non esiste una cartella `backups/`: raddoppierebbe lo spazio occupato senza aggiungere
niente che git non faccia già.

---

## Salute dell'archivio

EA tiene un contatore cumulativo delle partite giocate che non perde mai nulla. La
differenza tra quel numero e le partite effettivamente archiviate dice **quante ne sono
andate perse**. La dashboard lo mostra nella sezione *Partite*, e il workflow lo scrive
nel log ad ogni esecuzione.

Un divario nelle ultime ore è normale: EA pubblica in ritardo. Un divario che resta anche
il giorno dopo significa che quelle partite non sono più recuperabili.

Storicamente ne sono state perse 35, quasi tutte tra il 7 e il 19 agosto 2026, quando
l'aggiornamento girava una sola volta al giorno.

---

## Lavorare in locale

Gli script non richiedono dipendenze esterne, solo Python 3:

```bash
python3 ingest.py --raw-dir raw --db lentoni.db
python3 avversari.py --db lentoni.db --max-richieste 15
python3 generate_dashboard.py --db lentoni.db --out index.html
```

Per modificare la dashboard conviene lavorare su `generate_dashboard.py` e lasciare che
sia il workflow a rigenerare `index.html`: un `index.html` modificato a mano viene
sovrascritto al primo aggiornamento.

---

## Limiti da tenere presente

- Endpoint non documentati: possono cambiare o sparire senza preavviso.
- Solo le ultime 10 partite sono recuperabili, e non esiste modo di paginare all'indietro
  (testati `offset`, `page`, `startIndex`, `before`, `beforeTimestamp`: tutti ignorati).
- EA elenca solo i giocatori **umani** di ogni partita, tipicamente 5 o 6: il resto sono CPU.
- Le partite abbandonate o interrotte da disconnessione non vengono conteggiate da EA.
- Non esistono dati su posizione in campo, minuti dei gol o errori difensivi: analisi che
  richiedono quel livello di dettaglio non sono realizzabili.
- Uso non ufficiale delle API EA: fuori dai termini di servizio in senso stretto, anche se
  è la stessa tecnica usata da proclubstracker e simili.
