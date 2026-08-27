#!/usr/bin/env bash
# Un singolo giro di aggiornamento: scarica, aggiorna il database, rigenera, pubblica.
#
# Vive in un file separato perche' il workflow lo esegue in ciclo: la pianificazione di
# GitHub e' inaffidabile (misurato il 21/08/2026: con cadenza oraria impostata, in tre ore
# e mezza e' partita una sola esecuzione), quindi invece di sperare in trigger puntuali
# ogni esecuzione resta viva un paio d'ore e controlla piu' volte.
#
# Esce sempre 0 se il database e' rimasto integro: un singolo giro fallito non deve
# interrompere il ciclo, si ritenta tra venti minuti.
set -uo pipefail

# Club e piattaforma vengono da club.json: al passaggio a un titolo nuovo (FC 27 e
# successivi) si modifica solo quel file, non gli script.
leggi_club() {
  python3 -c "
import json,sys
try:
    a=json.load(open('club.json'))['attivo']
    print(a['club_id'], a.get('piattaforma','common-gen5'))
except Exception:
    print('2703620 common-gen5')
"
}
read -r CLUB_ID PIATTAFORMA <<< "$(leggi_club)"
echo "  club attivo: $CLUB_ID ($PIATTAFORMA)"

# Battito. Serve a distinguere "l'automazione e' viva e non c'era nulla da fare" da
# "l'automazione e' morta": sul ramo principale le due cose lasciano la stessa traccia,
# cioe' nessuna. Viene quindi scritto SEMPRE, anche quando non c'e' niente da pubblicare
# e anche quando la fonte non risponde - anzi soprattutto allora.
#
# Costruito con i comandi di basso livello di git, senza toccare il ramo corrente ne' la
# cartella di lavoro. La versione precedente creava un ramo orfano con checkout: dentro un
# ciclo che rilancia questo script sette volte di seguito il cambio di ramo a volte
# falliva, e il ramo 'stato' finiva per ereditare la storia di main con tutti i suoi file
# (verificato il 21/08/2026: 3 commit invece di 1). Cosi' invece il commit e' sempre
# senza genitore e contiene un solo file, e il force-push sostituisce il precedente.
#
# Il rovescio di quella scelta e' che il ramo non ha storia: diceva com'e' adesso, non
# com'e' andata. Un guasto notturno rientrato prima del mattino non lasciava traccia.
# Dal 24/08/2026 la memoria sta DENTRO il file - vedi battito.py - cosi' il ramo resta di
# un commit solo e il registro dei guasti esiste lo stesso.
scrivi_battito() {
  esito="$1"            # ok | irraggiungibile | --avvio
  problema="${2:-}"     # cosa si e' rotto dopo lo scaricamento, se qualcosa
  {
    # Lo stato precedente si rilegge dal ramo: il runner e' pulito ad ogni esecuzione,
    # quindi senza questo non si potrebbe sapere da quanto la fonte e' giu'.
    git fetch -q origin stato 2>/dev/null || true
    precedente=$(git show FETCH_HEAD:stato.json 2>/dev/null || echo '{}')

    # La costruzione dello stato sta in battito.py e non qui dentro: infilata in un
    # documento incorporato nello script non era collaudabile, e questa e' proprio la parte
    # che deve funzionare quando tutto il resto e' rotto. Ora ha i suoi test.
    if [ "$esito" = "--avvio" ]; then
      printf '%s' "$precedente" | python3 battito.py --avvio > /tmp/stato.json
      messaggio="avvio $(date -u '+%Y-%m-%d %H:%M') UTC - run ${GITHUB_RUN_ID:-locale}"
    else
      partite=$(python3 -c "import sqlite3;print(sqlite3.connect('lentoni.db').execute('select count(*) from matches').fetchone()[0])" 2>/dev/null || echo 0)
      printf '%s' "$precedente" | python3 battito.py "$esito" "$partite" "$problema" > /tmp/stato.json
      messaggio="battito $(date -u '+%Y-%m-%d %H:%M') UTC - fonte $esito${problema:+ - $problema}"
    fi

    blob=$(git hash-object -w /tmp/stato.json)
    albero=$(printf '100644 blob %s\tstato.json\n' "$blob" | git mktree)
    commit=$(git commit-tree "$albero" -m "$messaggio")
    git push -qf origin "$commit:refs/heads/stato"
  } >/dev/null 2>&1 || echo "  battito non aggiornato (non bloccante)"
}

# Modo "segna e basta": il workflow lo chiama appena parte, PRIMA del primo giro. Serve a
# distinguere un run che muore subito da un run che GitHub non ha mai lanciato - senza
# questo segno i due casi sono identici, e si finisce per cercare il guasto dalla parte
# sbagliata. E' l'unica alternativa a leggere i log delle Actions, che richiederebbero un
# accesso esterno al repository.
#
# Ha risposto la notte stessa in cui e' stato scritto. Fra il 27 e il 28/08/2026 il battito
# mostrava tre esecuzioni in sedici ore, TUTTE da push e NESSUNA programmata, e nessun
# avvio senza giri: quindi non e' il nostro codice che muore, e' GitHub che non lancia.
# Senza questo segno le due ipotesi sarebbero rimaste indistinguibili e si sarebbe cercato
# il guasto in casa nostra. Vedi il README, "Quando il cron non parte".
if [ "${1:-}" = "--solo-avvio" ]; then
  scrivi_battito --avvio
  echo "  avvio registrato (run ${GITHUB_RUN_ID:-locale})"
  exit 0
fi


echo "--- giro delle $(date -u '+%H:%M:%S') UTC ---"

if ! curl -sS --fail --max-time 60 -H 'User-Agent: Mozilla/5.0' \
     "https://proclubstracker.com/api/clubs/${CLUB_ID}?platform=${PIATTAFORMA}" \
     -o /tmp/club.json; then
  # La fonte e' un progetto amatoriale di una persona: il 23/08/2026 il principale sito
  # alternativo rispondeva 500 su ogni pagina, homepage compresa. Un giorno capitera' a
  # questa. Il giro deve uscire, ma lasciando detto perche', altrimenti "fonte caduta" e
  # "non abbiamo giocato" sono indistinguibili.
  echo "  fonte non raggiungibile, salto questo giro"
  scrivi_battito irraggiungibile
  exit 0
fi

python3 - <<'PY' || { echo "  JSON inatteso, salto questo giro"; scrivi_battito ok "json inatteso"; exit 0; }
import json, pathlib
j = json.load(open('/tmp/club.json'))
raw = pathlib.Path('raw'); raw.mkdir(exist_ok=True)
scrivi = lambda n, o: (raw / n).write_text(json.dumps(o, ensure_ascii=False))
scrivi('overall_stats.json',    [j['overallStats']])
scrivi('members_stats.json',    j['memberStats'])
scrivi('club_info.json',        j['clubInfoData'])
scrivi('matches_league.json',   j['matches']['league'])
scrivi('matches_playoff.json',  j['matches']['playoff'])
scrivi('matches_friendly.json', j['matches']['friendly'])
print(f"  skillRating {j['overallStats']['skillRating']} | partite nel feed {len(j['matches']['league'])}")
PY

python3 ingest.py --raw-dir raw --db lentoni.db || { echo "  ingest fallito, salto"; scrivi_battito ok "ingest fallito"; exit 0; }
python3 avversari.py --db lentoni.db --max-richieste 10 || echo "  avversari non aggiornati (non bloccante)"

python3 generate_dashboard.py --db lentoni.db --out index.html || { echo "  generazione fallita, salto"; scrivi_battito ok "generazione fallita"; exit 0; }

# Controlli minimi: meglio non pubblicare che pubblicare una pagina rotta.
grep -q '"skill_rating": [1-9]' index.html || { echo "  dashboard senza skill rating, non pubblico"; scrivi_battito ok "pagina senza skill rating"; exit 0; }
# Nessuna sezione deve sparire per strada. Invece di elencarle una per una - erano tre
# su quindici, e le altre dodici sarebbero potute uscire rotte in silenzio - si confronta
# il numero di sezioni della pagina prodotta con quelle del modello. Cosi' la guardia si
# aggiorna da sola quando se ne aggiunge una.
attese=$(grep -c '<section id=' modello/pagina.html)
prodotte=$(grep -c '<section id=' index.html)
if [ "$prodotte" -lt "$attese" ]; then
  echo "  sezioni mancanti: $prodotte su $attese, non pubblico"; scrivi_battito ok "sezioni mancanti"; exit 0
fi

# Piu' i contenitori che devono essere riempiti dal JavaScript: una sezione presente ma
# vuota passerebbe il conteggio qui sopra.
for ancora in 'id="forza"' 'Reparto per reparto' 'id="historyRange"' 'id="serateFiltri"' \
              'id="diagnosiTabella"' 'id="ossConfronto"' 'id="wrappedGrid"' 'id="pitchField"'; do
  grep -q "$ancora" index.html || { echo "  manca $ancora nella pagina, non pubblico"; scrivi_battito ok "pagina incompleta"; exit 0; }
done

git add index.html lentoni.db
if git diff --staged --quiet; then
  echo "  nessuna modifica"
else
  # VACUUM solo quando c'e' davvero qualcosa da pubblicare. Non e' deterministico:
  # ricompattare un contenuto identico produce byte diversi ad ogni esecuzione
  # (verificato il 21/08/2026, tre VACUUM di fila = tre hash diversi). Eseguirlo ad
  # ogni giro significherebbe un commit ogni venti minuti anche senza aver giocato.
  python3 -c "import sqlite3; c=sqlite3.connect('lentoni.db'); c.execute('VACUUM'); c.close()" || true
  git add lentoni.db
  git commit -q -m "Aggiornamento automatico $(date -u '+%Y-%m-%d %H:%M') UTC"
  if ! git push -q origin HEAD:main 2>/dev/null; then
    echo "  push respinto, riprovo dopo un rebase"
    git pull -q --rebase origin main && git push -q origin HEAD:main && echo "  pubblicato al secondo tentativo"
  else
    echo "  pubblicato"
  fi
fi

scrivi_battito ok

exit 0
