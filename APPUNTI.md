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

**Il selettore del titolo nella dashboard.** FC 27 è atteso per inizio ottobre. Il
database e gli script sono già pronti a contenere più titoli insieme (vedi `club.json`),
e ogni query filtra per club attivo — verificato iniettando un secondo club finto.
Manca solo il modo di passare da una stagione all'altra guardando la pagina.

Meglio costruirlo a settembre che adesso: con due mesi di partite in archivio si può
simulare il secondo titolo con dati veri invece che copiati.

---

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
