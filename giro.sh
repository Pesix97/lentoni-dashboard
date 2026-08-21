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

echo "--- giro delle $(date -u '+%H:%M:%S') UTC ---"

if ! curl -sS --fail --max-time 60 -H 'User-Agent: Mozilla/5.0' \
     "https://proclubstracker.com/api/clubs/${CLUB_ID}?platform=${PIATTAFORMA}" \
     -o /tmp/club.json; then
  echo "  dati non scaricati, salto questo giro"
  exit 0
fi

python3 - <<'PY' || { echo "  JSON inatteso, salto questo giro"; exit 0; }
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

python3 ingest.py --raw-dir raw --db lentoni.db || { echo "  ingest fallito, salto"; exit 0; }
python3 avversari.py --db lentoni.db --max-richieste 10 || echo "  avversari non aggiornati (non bloccante)"

# VACUUM: sqlite non restituisce da solo lo spazio delle pagine liberate. Senza, il file
# cresce piu' del contenuto e ogni commit porta in dote quel peso inutile.
python3 -c "import sqlite3; c=sqlite3.connect('lentoni.db'); c.execute('VACUUM'); c.close()" || true

python3 generate_dashboard.py --db lentoni.db --out index.html || { echo "  generazione fallita, salto"; exit 0; }

# Controlli minimi: meglio non pubblicare che pubblicare una pagina rotta.
grep -q '"skill_rating": [1-9]' index.html || { echo "  dashboard senza skill rating, non pubblico"; exit 0; }
grep -q 'id="ruoli"' index.html          || { echo "  sezione ruoli mancante, non pubblico"; exit 0; }

git add index.html lentoni.db
if git diff --staged --quiet; then
  echo "  nessuna modifica"
else
  git commit -q -m "Aggiornamento automatico $(date -u '+%Y-%m-%d %H:%M') UTC"
  if ! git push -q origin HEAD:main 2>/dev/null; then
    echo "  push respinto, riprovo dopo un rebase"
    git pull -q --rebase origin main && git push -q origin HEAD:main && echo "  pubblicato al secondo tentativo"
  else
    echo "  pubblicato"
  fi
fi

# Battito: un ramo orfano con un solo commit, riscritto ogni volta con force-push.
# Serve ad accorgersi se la pianificazione di GitHub smette di funzionare, cosa che
# altrimenti non lascerebbe alcuna traccia. Non pesa sul repository perche' il commit
# precedente viene sostituito, non accodato: la cronologia di 'stato' e' lunga uno.
{
  printf '{"ultimo_giro":"%s","partite":%s}\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    "$(python3 -c "import sqlite3;print(sqlite3.connect('lentoni.db').execute('select count(*) from matches').fetchone()[0])" 2>/dev/null || echo 0)" \
    > /tmp/stato.json
  git checkout -q --orphan stato-tmp
  git rm -rq --cached . >/dev/null 2>&1 || true
  cp /tmp/stato.json stato.json
  git add stato.json
  git commit -q -m "battito $(date -u '+%Y-%m-%d %H:%M') UTC"
  git push -qf origin stato-tmp:stato
  git checkout -q main
  git branch -qD stato-tmp
} >/dev/null 2>&1 || echo "  battito non aggiornato (non bloccante)"

exit 0
