# Dashboard club "Lentoni" (EA FC, PS5)

Statistiche del club Lentoni (clubId `2703620`, piattaforma `common-gen5` = PS5),
raccolte dalle API pubbliche non ufficiali di EA e pubblicate come pagina web.

**Dashboard online:** https://pesix97.github.io/lentoni-dashboard/

Tutto si aggiorna da solo, **due volte l'ora, sui server di GitHub**. Non serve tenere
acceso nessun computer.

---

## Come funziona

Il workflow `.github/workflows/aggiorna-dashboard.yml` esegue `giro.sh` **sedici volte a
distanza di venti minuti** quando parte dalla pianificazione, coprendo **5 ore e 20** per
ogni avvio. Dopo un push al codice ne esegue invece **uno solo**, perché lì serve solo
verificare che la modifica produca una pagina valida. Ogni giro:

1. legge da `club.json` quale club interrogare;
2. scarica i dati da proclubstracker.com;
3. li scompone nei file che la pipeline si aspetta (`raw/`, non versionati);
4. `ingest.py` li scrive nel database `lentoni.db`, e `potatura.py` toglie subito il testo
   grezzo che nessuno legge più — era il **77%** del peso del file;
5. `avversari.py` raccoglie il livello dei club affrontati (dieci al massimo per giro,
   sotto un tetto duro di un minuto: è un arricchimento, non deve dettare i tempi);
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
{ "ultimo_giro": "2026-08-25T05:00:00Z", "partite": 64,
  "fonte": "ok", "ultimo_successo_fonte": "2026-08-25T05:00:00Z",
  "fallimenti_di_fila": 0, "problema": null,
  "guasti_in_memoria": 1, "guasto_in_corso": false,
  "ultimo_guasto": { "fonte": "irraggiungibile", "partite": 59, "problema": null,
                     "da": "2026-08-25T03:00:00Z", "a": "2026-08-25T03:40:00Z", "giri": 3 },
  "storia": [ "..." ] }
```

**La memoria sta dentro il file, non nella storia del ramo.** Il ramo ha un commit solo per
scelta — così non cresce mai — ma il prezzo era che il battito diceva com'è *adesso*, non
com'è *andata*: un guasto notturno rientrato prima del mattino non lasciava traccia da
nessuna parte. Ed è proprio il caso che conta, perché in quelle ore le partite giocate
possono uscire dalla finestra delle dieci e sparire per sempre.

`battito.py` tiene quindi un registro di **cambiamenti**, non di campionamenti: finché i
giri raccontano la stessa cosa la voce esistente si allunga e il contatore `giri` sale, e
una voce nuova nasce solo quando qualcosa cambia davvero. Con cento voci si coprono mesi di
funzionamento regolare restando su pochi KB.

**Due memorie, perché le domande sono due.** Il registro per stato risponde a *"la fonte ha
mai smesso di rispondere?"*. Non risponde a *"l'automazione ha mai smesso di girare?"*, ed è
un'altra cosa: se il ciclo non parte non scrive niente, e nel registro per stato la voce
precedente si allunga e basta — sei ore di silenzio e sei ore di funzionamento regolare
producono la stessa identica riga.

Il 27/08/2026 è servito sapere proprio quello, e la risposta si è potuta solo **dedurre da
una media**: 51 giri dove ne erano attesi 78 in ventisei ore. Si sapeva che ne mancavano 27,
non dove. Da allora `giri_recenti` conserva l'istante di ogni giro senza accorpare, e
`interruzioni` elenca i vuoti oltre **un'ora e mezza** — sotto quella soglia è la
pianificazione di GitHub che salta un colpo, non un guasto.

**E chi ha fatto ogni giro.** Ogni giro porta anche `GITHUB_RUN_ID`, così `esecuzioni`
elenca i run del workflow partiti davvero, con quanti giri ha fatto ciascuno. Alla domanda
*«quanti run ci sono stati oggi»* si risponde leggendo il battito.

Serviva un modo di guardare le Actions, e la strada ovvia non funziona: **il connettore
GitHub sincronizza i file di un ramo, non la cronologia né i metadati** — quindi niente
esecuzioni (verificato sulla documentazione il 27/08/2026). Invece di aggiungere un accesso
esterno, è il workflow stesso a lasciare la propria traccia dove già scriviamo. Non serve
toccare il workflow: `GITHUB_RUN_ID` è già nell'ambiente di ogni esecuzione.

**E chi è partito senza arrivare.** Restava scoperto un caso: un run che muore *prima* del
primo giro non scriveva niente, quindi era indistinguibile da un run che GitHub non ha mai
lanciato. Sono due guasti opposti — il nostro codice che esplode contro la pianificazione
che salta — e senza distinguerli si cerca dalla parte sbagliata.

Dal 27/08/2026 il workflow scrive il proprio avvio nel battito **appena parte**, in un
passo separato prima del ciclo (`giro.sh --solo-avvio`). Confrontando `avvii` con
`esecuzioni` il quadro si chiude senza leggere i log:

| Cosa si legge | Cosa è successo |
| --- | --- |
| nessun avvio | il workflow non è mai arrivato al checkout — **o non è partito, o è stato cancellato mentre era in coda** |
| avvio senza giri (`morti_sul_nascere`) | il run è partito ed è morto subito |
| avvio con pochi giri | è stato ucciso a metà |
| avvio con tutti i giri | tutto regolare |

L'avvio più recente non conta mai fra i `morti_sul_nascere`: è quello in corso, e il suo
primo giro deve ancora arrivare. Contarlo produrrebbe un allarme ad ogni esecuzione, cioè
rumore continuo — il modo più sicuro di far ignorare un allarme vero. Il passo è
`continue-on-error`: è diagnostica, non deve poter fermare l'aggiornamento.

**Il limite della prima riga, scoperto la notte stessa.** Il segno si scrive dopo il
checkout, quindi un'esecuzione cancellata *mentre è in coda* non lo scrive — ed è
indistinguibile da una mai lanciata. La notte fra il 27 e il 28/08/2026 si è concluso
«GitHub non lancia» e la lista delle Actions era invece piena di run cancellati dalle
nostre stesse impostazioni. Il battito **restringe il campo, non lo chiude**: quando la
prima riga è quella vera, le Actions vanno guardate lo stesso. Vedi
[Quando il ciclo non gira](#quando-il-ciclo-non-gira).

**Il battito distingue cinque guasti diversi**, che prima erano lo stesso silenzio:

| Sintomo | Significato |
| --- | --- |
| `ultimo_giro` vecchio di ore | l'automazione non gira più |
| `fonte: irraggiungibile` | l'automazione è viva, ma la fonte dei dati non risponde |
| `problema` valorizzato | la fonte risponde, ma la nostra pipeline si è rotta a valle |
| `interruzioni` non vuoto | l'automazione ha smesso di girare per un periodo, poi è tornata |
| `morti_sul_nascere` non vuoto | il workflow è partito ed è morto prima del primo giro |

Il secondo caso è quello che mancava, e conta perché **è indistinguibile da "non abbiamo
giocato"**: il ciclo continuerebbe a girare regolarmente scrivendo "fonte non
raggiungibile" in un log che nessuno legge, e il battito resterebbe verde perché diceva
solo "sono vivo". Ora il battito viene scritto **anche quando la fonte cade** — prima il
giro usciva prima di arrivarci — e porta da quanti giri consecutivi non risponde.

Perché è urgente e non cosmetico: EA espone solo le ultime 10 partite. Se la fonte resta
giù per una notte di gioco e nessuno se ne accorge, quelle partite escono dalla finestra e
sono perse per sempre.

**Chi legge il battito, e quando.** Tre task pianificati di Cowork, con tre scopi diversi:

| Task | Orario | A cosa serve |
| --- | --- | --- |
| `lentoni-controllo-battito` | 23:45 | arriva **prima** che si cominci a giocare: se l'automazione è ferma, si lancia il workflow a mano e la serata è salva |
| `lentoni-guardia-partite` | 01:10 | **in piena fascia di gioco**, ed è l'unico che può ancora salvare qualcosa mentre si è in tempo |
| `lentoni-controllo-battito` | 09:45 | il resoconto della notte, quando non c'è più niente da salvare ma c'è da capire |

Il controllo dell'01:10 è nato il 28/08/2026 da un vuoto misurato: fra le 23:45 e le 09:45
c'erano **nove ore scoperte**, tutte dentro la fascia in cui si gioca. Un guasto a metà
serata restava invisibile fino al mattino — e a 19 minuti a partita, tre ore di guasto
costano partite per sempre.

**Parla solo se qualcosa è rotto.** All'una di notte un controllo che riferisce anche
quando va tutto bene diventa rumore, e un allarme che suona sempre si impara a ignorarlo.
Se il ciclo gira, la risposta è una riga sola.

### Quando il ciclo non gira

La notte fra il **27 e il 28/08/2026** l'automazione è rimasta ferma **sedici ore** e la
serata non è finita in archivio. Dieci partite si sono salvate per un soffio: la finestra
di EA ne tiene dieci, e ne erano state giocate esattamente dieci.

**La causa eravamo noi.** Quella stessa mattina il ciclo era passato da 2h20 a **5h20** e i
cron da uno a **due l'ora** — entrambe modifiche fatte *per ridurre i buchi*. Ma
`cancel-in-progress` era rimasto attivo anche sul gruppo del ciclo: ogni esecuzione
programmata veniva quindi uccisa dalla successiva entro trenta minuti. E poiché la
pianificazione di GitHub arriva anche con un'ora di ritardo, la vittima era spesso ancora
**in coda**, cioè moriva senza eseguire un solo passo.

La regola, che è aritmetica e non un'opinione:

> Se il ciclo dura più dell'intervallo fra due partenze, cancellare significa non finire mai.

Ora le esecuzioni programmate si **accodano** (`cancel-in-progress` esclude `schedule`).
GitHub ne tiene al massimo una in esecuzione e una in attesa, quindi non si accumulano, e
quando il ciclo lungo finisce la successiva parte subito. Tre test in `test_pipeline.py`
ricalcolano la disuguaglianza dai numeri veri del workflow, così la regola resta valida se
domani i giri o i cron cambiano ancora.

**Cosa aveva detto il battito, e cosa no.** Tre esecuzioni in tutto il giorno, tutte da
`push`, e `morti_sul_nascere` vuoto. Da lì si era concluso *«GitHub non lancia»* — ed era
**sbagliato**: GitHub lanciava eccome, la lista delle Actions era piena di esecuzioni
cancellate. È il limite da ricordare: il segno di avvio si scrive dopo il checkout, quindi
**un'esecuzione cancellata mentre è in coda resta indistinguibile da una mai partita**. Il
battito restringe il campo, non lo chiude: la lista delle Actions va guardata lo stesso.

Se dovesse ricapitare, in ordine:

1. **Chiudere il buco subito.** Actions → *Aggiorna dashboard Lentoni* → *Run workflow*,
   anche dal telefono. In alternativa basta un commit che tocchi uno dei file elencati fra
   i `paths` del workflow: innesca un'esecuzione da push, che fa un giro solo. Un giro
   basta a salvare le partite ancora dentro la finestra delle dieci.
2. **Guardare l'esito delle esecuzioni programmate, non solo se esistono.** Una lista piena
   di run *cancellati* è il sintomo di questo guasto. Un run *fallito* è un'altra cosa e il
   log dice cosa. Nessun run è la terza, e allora vale la pena controllare che il workflow
   non sia stato disabilitato (Actions lo segnala in cima) e githubstatus.com.
3. **Verificare il contatore di carriera di EA**, che è la prova indipendente di quante
   partite si siano perse davvero: la differenza fra due letture consecutive di
   `games_played` in `club_stats_history` dice quante se ne sono giocate, e si confronta
   con quante ne sono entrate in archivio. La notte del 27/08: da 708 a 718, dieci
   archiviate, **zero perse**.

**Da Cowork non si rimedia via codice.** Quella macchina prende **403 dalla fonte** —
proclubstracker risponde ai runner GitHub, non a quel data center — e `api.github.com` non
è raggiungibile, quindi né i log delle Actions né `workflow_dispatch`. L'unico canale
aperto è `github.com` in git: da lì passa il push, che è appunto il rimedio numero 1.

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

### Quanto può durare un buco prima di costare una partita

Misurato il 27/08/2026: il club gioca **una partita ogni 19 minuti** (mediana; 15 nelle
serate veloci), quasi sempre fra le **22:00 e le 03:00**. EA ne espone dieci, quindi

```
10 partite × 19 minuti ≈ 3 ore
```

Un'interruzione costa partite **solo se supera le tre ore mentre si sta giocando**. Di
giorno non ha alcun costo.

**E non si recuperano.** Verificato lo stesso giorno: la risposta di proclubstracker
contiene esattamente le stesse dieci partite di lega che dà EA — non è un archivio, è un
passaggio. Playoff e amichevoli sono vuote, quindi non c'è nemmeno il trucco di sommare
finestre diverse per tipo di partita. Una partita uscita dalla finestra è persa.

Da qui le difese contro i buchi, nate fra il 27 e il 28/08/2026 dopo che erano mancati **27 giri su 78
attesi** in ventisei ore:

| Difesa | Cosa cambia |
| --- | --- |
| **Ciclo da 16 giri** invece di 7 | un solo trigger riuscito copre 5h20 invece di 2h20: per scoprire una serata GitHub deve saltare sedici trigger di fila |
| **Due orari di partenza** (`:00` e `:30`) | raddoppiano le occasioni che almeno uno scatti |
| **Esecuzioni programmate in coda, non cancellate** | senza questa, le prime due si annullano a vicenda — vedi sotto |
| **Tetto duro a ogni attesa di rete** (`ATTESA_FONTE`, `ATTESA_AVVERSARI`) | senza, il caso peggiore sforava il limite di sei ore di GitHub e il ciclo veniva ucciso verso il quattordicesimo giro |
| **Controllo del battito tre volte al giorno**: 23:45, 01:10, 09:45 | i primi due arrivano prima e durante le partite, quando c'è ancora qualcosa da salvare: il workflow si lancia a mano da GitHub — anche dal telefono — e il buco si chiude in un minuto |

**La terza difesa è nata da un danno fatto dalle prime due.** Allungare il ciclo e
raddoppiare i cron, senza toccare `cancel-in-progress`, ha prodotto la notte stessa un buco
di sedici ore: ogni esecuzione programmata veniva uccisa dalla successiva prima di
finire — spesso prima ancora di cominciare. Due modifiche pensate per ridurre i buchi ne
hanno creato il più lungo mai misurato. La lezione, in una riga: **se il ciclo dura più
dell'intervallo fra due partenze, cancellare significa non finire mai.**

Non è una garanzia, e vale la pena dirlo: una garanzia richiederebbe una fonte che conserva
lo storico, e non esiste. È il massimo ottenibile con quello che EA espone.

### Perché due gruppi di concorrenza

Il ciclo pianificato e la verifica dopo un push vivono in **gruppi separati** e non si
cancellano a vicenda. Con un gruppo solo succedeva questo, misurato il 23/08/2026: su 28
push, **dodici sono stati seguiti da oltre venticinque minuti senza un giro automatico**.
Ogni pubblicazione di una modifica uccideva il ciclo che stava coprendo la notte, e la
finestra rimanente andava persa. Non è mai costato una partita solo perché non si stava
giocando in quei momenti.

**Ma dentro il gruppo del ciclo, cancellare è l'errore da non fare** — e questa riga ha
sostituito il 28/08/2026 quella che diceva il contrario. Finché il ciclo durava 2h20 con un
cron l'ora, ogni esecuzione aveva sessanta minuti prima di essere sostituita: bastavano.
Portato il ciclo a 5h20 con due cron l'ora, la sostituzione arriva dopo trenta minuti e
nessuna esecuzione finisce più — spesso nessuna comincia nemmeno, perché la pianificazione
di GitHub ritarda anche di un'ora e la vittima viene uccisa mentre è ancora in coda.

Ora `cancel-in-progress` vale solo per le verifiche da push, che durano un minuto e di cui
contano solo le ultime. Le esecuzioni programmate si **accodano**: GitHub ne tiene una in
esecuzione e una in attesa, quindi non si accumulano, e la copertura non ha stacchi. Due
esecuzioni contemporanee sullo stesso database non sarebbero comunque un problema:
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
| `CLAUDE.md` | Le regole di lavoro. Letto automaticamente da Claude quando opera in questa cartella. |
| `index.html` | La dashboard pubblicata. **Generata**, non modificarla a mano. |
| `lentoni.db` | Database SQLite con tutto lo storico. |
| `ingest.py` | Scrive i JSON scaricati nel database. Nessuna chiamata di rete. |
| `avversari.py` | Raccoglie skill rating e record dei club affrontati. |
| `generate_dashboard.py` | Legge il database e assembla `index.html` dai pezzi in `modello/`. |
| `modello/pagina.html` | Struttura della pagina, con i segnaposto `__STILE__` e `__SCRIPT__`. |
| `modello/stile.css` | Tutto il CSS. |
| `modello/pagina.js` | Tutta la logica che gira nel browser. **File .js vero**: `node --check` lo verifica. |
| `giro.sh` | Un singolo giro completo: scarica, aggiorna, rigenera, pubblica, batte. Con `--solo-avvio` segna solo «sono partito» ed esce, senza toccare la fonte. |
| `potatura.py` | Toglie dal database il grezzo di EA che nessuno legge più. Era il **77%** del peso, e il database intero viene committato ad ogni giro con novità. |
| `battito.py` | Lo stato dell'automazione, con la memoria dei guasti. Il ramo `stato` ha un commit solo per scelta, quindi il registro vive dentro il file: una voce per ogni **cambiamento**, non per ogni giro. |
| `ruoli.py` | La regola dei ruoli in un posto solo: chi conta, in che reparto, in che serata. Condivisa fra gli script. |
| `serata.py` | La griglia di una serata da confermare, con le osservazioni su cosa non torna. |
| `club.json` | Quale club è attivo. **Unico file da toccare al passaggio a FC 27.** |
| `roles.json` | Ruoli reali dei giocatori, eccezioni per partita, ex giocatori. Scritto a mano. |
| `affidabilita.py` | Misura quali metriche si confermano nel tempo. Serve a decidere i pesi dell'Indice di Forza con i dati invece che a intuito. |
| `test_pipeline.py` | 81 test: ingest, duplicati, isolamento tra titoli, passaggio di titolo, qualità dei dati, modello, memoria del battito con interruzioni, esecuzioni e avvii, coerenza fra durata del ciclo e cadenza dei cron, potatura del grezzo, numeri dichiarati nei testi. |
| `test_ruoli.js` | 81 controlli su ruoli, pesi dell’indice, testa a testa, novità dell’ultima serata, scheda giocatore e collegamenti interni, eseguiti sulla pagina generata. |
| `raw/club_search.json` | Fotografia del club presa a mano, usata per stemma e regione. **Non** per la piattaforma. |

---

## club.json — quale club, quale titolo

Ogni titolo EA crea un club nuovo con un id diverso, ma le persone restano le stesse.
L'archivio tiene **tutti i titoli insieme**, distinti da `club_id`, e la dashboard ne
mostra uno alla volta: quello indicato in `attivo`.

Al passaggio a FC 27 (**18 settembre 2026**) si sposta il club corrente in `storico`, si
scrive il nuovo in `attivo` con `club_id`, `nome` e `titolo`, e non serve toccare
nient'altro. La **piattaforma mostrata viene da qui**, non da `raw/club_search.json`: quel
file è una fotografia presa a mano del club di FC 26 e avrebbe continuato a dichiarare la
piattaforma di quello vecchio, contraddicendo proprio la regola dell'unico file da toccare.
Ogni query di `generate_dashboard.py` filtra per club attivo — senza quel filtro due
stagioni finirebbero sommate nella stessa rosa senza che nulla lo segnali.

**La transizione è stata provata due volte, e la seconda serviva.** Il 23/08/2026 a vuoto:
con un club nuovo e zero partite la pagina si genera, tutte le sezioni ci sono, le guardie
di pubblicazione passano e non compaiono `NaN`. Quella prova però verificava che la pagina
*si generasse*, non **cosa dicesse** — e due difetti erano lì da allora senza che nessuno li
guardasse:

| Cosa si rompeva | Perché, e come è stato risolto |
| --- | --- |
| la pagina usciva intestata **"Club"**, con «Club — Club Dashboard» nel titolo della scheda | il nome vero sta nel database, dove lo scrive il primo scaricamento riuscito: al primo giorno di un titolo nuovo quella riga non esiste. Il ripiego è il campo `nome` di `club.json` |
| l'avviso `prestazioni escluse a mano: 3 su 3` sarebbe diventato **`0 su 3` per sempre** | le esclusioni sono elencate per `match_id` e quelli di FC 26 non esistono in FC 27. Ora le voci che riguardano titoli precedenti vengono dichiarate tali invece di essere contate come errori: un allarme che suona sempre insegna a non guardarlo |

Dal 25/08/2026 il passaggio non è più una prova a mano ma un test:
`TestPassaggioDiTitolo` in `test_pipeline.py` lo percorre da capo a fondo — primo giorno
senza partite e giorni successivi con poche — e verifica che il titolo vecchio non filtri
in quello nuovo.

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

## La documentazione è verificata, non promessa

`README.md` descrive **come funziona**, `APPUNTI.md` cosa è **rimasto in sospeso**. Il
problema di due file così è che invecchiano senza rumore: il 24/08/2026 gli appunti
sostenevano ancora che la lista delle eccezioni di ruolo fosse vuota, mentre ne contava
109, e nessuno se n'era accorto per giorni.

`TestDocumentazioneAllineata` in `test_pipeline.py` controlla le affermazioni **al
presente**, quelle che decadono:

- ogni file elencato nella tabella qui sopra esiste davvero;
- ogni file del progetto è elencato nella tabella;
- il numero di test dichiarato è quello reale;
- le soglie citate nei testi sono quelle scritte nel codice;
- ogni «N righe» scritto accanto al nome di un file somiglia alla realtà, con una
  tolleranza del 25%: non serve che il numero sia esatto, serve che non sia assurdo;
- gli appunti non negano cose che i dati smentiscono.

Alla prima esecuzione ha trovato tre disallineamenti veri, fra cui due file mai
documentati. Le frasi **datate** non vengono toccate: "al 24/08 erano 59 partite" resta
vero per sempre, ed è la differenza fra raccontare la storia e descrivere lo stato.

**Metà del problema però non è meccanizzabile**, e va detto invece di far finta. Il
25/08/2026 gli appunti tenevano ancora fra le leve da valutare una cosa risolta due giorni
prima: il numero sbagliato adesso lo prende un test, ma la frase diceva anche "dentro
un'unica stringa", e nessun controllo sa che una leva rimandata non è più da rimandare.
Quella metà si trova solo rileggendo — ed è stata trovata così.

Per non lasciarla al caso c'è un'attività pianificata, **`lentoni-rilettura-appunti`, ogni
domenica**: rilegge `APPUNTI.md`, `README.md` e `CLAUDE.md` contro lo stato vero del
codice, guarda cosa è cambiato nella settimana e propone le correzioni. Non applica niente
senza un sì esplicito.

Cerca **due guasti diversi**, ed è importante che siano due:

- **le righe diventate false** — una leva descritta come da valutare che è già stata
  realizzata, una cosa data per mancante che ora c'è;
- **le cose fatte e mai scritte** — il guasto opposto, e altrettanto comune: il 25/08/2026
  quattro modifiche importanti erano state documentate solo a metà.

Il secondo non è meccanizzabile, e conviene sapere perché invece di riprovarci. Un test del
tipo "ogni sezione della dashboard dev'essere nominata nel README" è stato costruito e
scartato: **8 sezioni su 17 non lo sono, e la maggior parte va benissimo così.** Questo file
spiega *perché* le cose sono come sono, non cataloga l'interfaccia — e cosa meriti una
riga è un giudizio, non una regola.

Niente di tutto questo sostituisce chi legge: le lacune di quel giorno le ha trovate il
club, non un controllo. Quello che cambia è il limite — una riga falsa resta in piedi al
massimo sette giorni invece che indefinitamente.

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

## I pesi dell'Indice di Forza stanno in un posto solo

`PESI_INDICE` e `PESI_TECNICA` in `modello/pagina.js`. Erano ripetuti a mano in **quattro**
punti — generale storico, generale forma, per reparto, per ruolo EA — ed è il tipo di
duplicato che prima o poi si disallinea in silenzio. Otto controlli in `test_ruoli.js`
impediscono che le copie tornino.

Il 24/08/2026 il club ha deciso due ritocchi, entrambi con la misura davanti:

- **il MOTM è sceso dal 15% al 5%**, i dieci punti alla media voto. Il premio di migliore in
  campo è quasi automatico quando si vince (correla +0,79 con la vittoria) e messo alla
  prova non si conferma: +0,08 fra prima e seconda metà dell'archivio;
- **l'efficienza tecnica** era la media semplice di passaggi, contrasti e tiro. Ora pesa
  passaggi 45%, tiro 45%, **contrasti 10%**. La percentuale di contrasti è la più ambigua
  delle tre: chi ne tenta di più ha la percentuale più bassa (correlazione **−0,78**),
  quindi in parte premia chi sceglie i duelli facili. Sulle altre due il vizio non c'è —
  tiri +0,36 e passaggi +0,44.

Sostituire la percentuale di contrasti con i **contrasti vinti a partita** è stato proposto
e **scartato dal club**: la voce si chiama efficienza e deve restare efficienza, chi tenta
tanto e sbaglia tanto va penalizzato lo stesso.

Nelle **classifiche per reparto**, dove il ruolo si conosce partita per partita, per i
difensori il rapporto si ribalta: contrasti 50%, passaggi 35%, tiro 15%. È l'unico punto
della dashboard dove i pesi cambiano col ruolo.

## Novità dall'ultima serata

La sezione in cima confronta **l'ultima serata con la penultima**. Prima confrontava gli
ultimi due aggiornamenti dello storico del club, e la finestra dipendeva da quando EA
pubblicava: poteva contenere una partita, sei o zero, e non corrispondeva a niente di
riconoscibile. La serata invece è l'unità in cui il club gioca e ragiona.

Cambia anche la fonte dei numeri: non la differenza fra due istantanee di totali di
carriera, ma le partite archiviate di quella serata. Sono esatte e non dipendono dai tempi
di pubblicazione di EA.

Per ogni giocatore: partite, media voto con la variazione rispetto alla **sua** serata
precedente, gol, assist e premi. Chi la volta prima non c'era viene dichiarato invece di
mostrare una variazione inventata, e in fondo si legge chi c'era prima e stavolta no.

Lo skill rating è l'unico dato che non viene dalle partite — si legge dalle istantanee del
club, prendendo l'ultima precedente all'inizio della serata. È una finestra, non una misura
esatta, e l'etichetta lo dichiara.

## Il confronto testa a testa spiega il distacco

Mostrava un grafico a barre con gol e assist come **totali di carriera** accanto a delle
percentuali: con 541 partite contro 96 il più anziano vinceva sempre, anche rendendo meno.

Ora il distacco nell'Indice di Forza viene spezzato nelle voci che lo compongono, e i pezzi
sommano esattamente al totale. Accanto a ogni voce ci sono i valori dei due giocatori e
dove si collocano nella rosa: «7,80 contro 7,50» non si legge finché non sai che la rosa va
da 6,80 a 8,00. L'efficienza tecnica si apre in una tendina nei suoi tre pezzi.

Il punto di vista è **il giocatore scelto a sinistra**, non chi sta più in alto in
classifica: verde quando è lui in vantaggio in quella voce, rosso quando è in svantaggio.
Scambiando i due menu i colori si invertono, ed è voluto — ancorare il colore al primo in
classifica obbligava a ricordarsi ogni volta quale dei due fosse.

I salti interni alla pagina usano `data-vai`, non `href="#..."`: la dashboard mostra una
sezione alla volta in base all'ancora, e un'ancora che non è una pagina fa tornare a home.
Due controlli in `test_ruoli.js` impediscono che il difetto rientri.

## La scheda si apre anche per chi non è ancora in rosa

La rosa mostra solo chi ha almeno **30 partite di carriera**. La sezione **Serate** invece
elenca chiunque abbia giocato quella sera, e quei nomi sono cliccabili: per un giocatore
appena arrivato il clic quindi non apriva niente, **in silenzio**. Nessun errore, nessun
messaggio, solo un nome che non risponde — segnalato dal club il 25/08/2026 su
Bagherese_95, cinque partite giocate la sera prima.

Ora la scheda si costruisce dalle **partite archiviate**: presenze, media voto, gol,
assist, premi, percentuali di passaggi, contrasti e tiro, e in che ruolo ha giocato. Un
riquadro dichiara che i numeri sono veri ma parziali, e cosa manca — totali di carriera,
OVR e traguardi, che EA manda solo per chi è in rosa.

Il silenzio resta giusto in un caso solo: un nome che non ha proprio giocato non apre
niente, ed è quello che deve succedere.

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
questo sotto le **3 presenze nel reparto** il giocatore resta in tabella con tutte le sue
cifre, ma senza posizione. Una partita non è un rendimento: si mostra, non si ordina.

La soglia è stata scelta dal club a 3 sapendo il compromesso: con 3 partite il valore conta
per il 38% di sé stesso, quindi qualcuno entra in classifica su un campione ancora sottile.
Alzarla a 5 è una riga in `modello/pagina.js` (`MIN_PER_CLASSIFICA`).

### La scheda osservatore e i confronti onesti

Due correzioni del 24/08/2026, entrambe nate dallo stesso vizio — confrontare cose che non
sono confrontabili:

- **"Dove rende di più"** prendeva il reparto migliore contro il peggiore fra tutti quelli
  con almeno tre partite. Per chi ha 32 presenze da attaccante finiva a confrontare nove
  partite a centrocampo con tre da esterno: un paragone fra due eccezioni. Ora il confronto
  è **ancorato al ruolo abituale** — quello con più presenze — e l'alternativa scelta è
  quella **con più partite**, non quella con lo scarto più vistoso. Chi non ha un secondo
  reparto abbastanza giocato se lo sente dire.
- **"Con lui e senza di lui"** confrontava percentuali grezze. Con sei assenze, "50%" sono
  tre vittorie su sei, cioè un caso. Le percentuali mostrate restano quelle vere, **con
  accanto i conteggi**, ma il giudizio in parole usa valori tirati verso la media della
  squadra in proporzione alle partite. Per domenicocasaburi la voce è passata da "la
  squadra va peggio senza di lui" a "nessuna differenza rilevabile".

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
