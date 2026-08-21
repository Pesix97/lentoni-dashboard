#!/usr/bin/env python3
"""Raccoglie i dati dei club affrontati, per sapere contro chi si e' giocato davvero.

I dati della singola partita contengono nome e id dell'avversario, ma non il suo
livello: senza quello "abbiamo perso 1-3" non distingue una sconfitta contro una
squadra molto piu' forte da una contro una piu' debole.

Ogni club viene interrogato UNA VOLTA e poi rinfrescato di rado (vedi GIORNI_VALIDITA):
lo skill rating di un avversario cambia lentamente e non vale una chiamata ad ogni giro.
Le richieste sono limitate per esecuzione, cosi' anche partendo da zero il carico si
distribuisce su piu' aggiornamenti invece di arrivare tutto insieme.

Usa solo la libreria standard: gira sui runner GitHub senza installare nulla.
"""

import argparse
import json
import sqlite3
import time
from pathlib import Path
import urllib.error
import urllib.request
from datetime import datetime, timezone

URL = "https://proclubstracker.com/api/clubs/{club_id}?platform={piattaforma}"
GIORNI_VALIDITA = 14      # oltre questa eta' il dato viene riscaricato
PAUSA_TRA_CHIAMATE = 1.5  # secondi: nessuna fretta, l'endpoint e' gratuito e non nostro

SCHEMA = """
CREATE TABLE IF NOT EXISTS opponent_clubs (
    club_id       INTEGER PRIMARY KEY,
    name          TEXT,
    skill_rating  INTEGER,
    games_played  INTEGER,
    wins          INTEGER,
    losses        INTEGER,
    ties          INTEGER,
    best_division TEXT,
    fetched_at    TEXT NOT NULL
)
"""


def intero(v, default=None):
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return default


def scarica(club_id, piattaforma, timeout=30):
    req = urllib.request.Request(
        URL.format(club_id=club_id, piattaforma=piattaforma),
        headers={"User-Agent": "Mozilla/5.0"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def da_aggiornare(cur, massimo):
    """Club affrontati che non abbiamo mai interrogato, o il cui dato e' vecchio.

    I piu' affrontati vengono prima: sono quelli su cui l'informazione rende di piu'.
    """
    righe = cur.execute(
        """
        SELECT m.opponent_club_id, COUNT(*) AS incontri, o.fetched_at
          FROM matches m
          LEFT JOIN opponent_clubs o ON o.club_id = m.opponent_club_id
         WHERE m.opponent_club_id IS NOT NULL
           AND (o.club_id IS NULL
                OR julianday('now') - julianday(o.fetched_at) > ?)
      GROUP BY m.opponent_club_id
      ORDER BY incontri DESC
         LIMIT ?
        """,
        (GIORNI_VALIDITA, massimo),
    ).fetchall()
    return [(r[0], r[1]) for r in righe]


def piattaforma_attiva():
    """Letta da club.json, cosi' al cambio di titolo si tocca un file solo."""
    try:
        percorso = Path(__file__).resolve().parent / "club.json"
        return json.loads(percorso.read_text(encoding="utf-8"))["attivo"].get(
            "piattaforma", "common-gen5")
    except Exception:  # noqa: BLE001
        return "common-gen5"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="lentoni.db")
    ap.add_argument("--piattaforma", default=None,
                    help="se omessa viene letta da club.json")
    ap.add_argument("--max-richieste", type=int, default=15,
                    help="quanti club interrogare al massimo in questa esecuzione")
    args = ap.parse_args()

    piattaforma = args.piattaforma or piattaforma_attiva()

    con = sqlite3.connect(args.db)
    cur = con.cursor()
    cur.execute(SCHEMA)
    con.commit()

    lavoro = da_aggiornare(cur, args.max_richieste)
    if not lavoro:
        totale = cur.execute("SELECT COUNT(*) FROM opponent_clubs").fetchone()[0]
        print(f"Avversari: nessun club da aggiornare ({totale} gia' in archivio)")
        con.close()
        return

    print(f"Avversari da interrogare in questa esecuzione: {len(lavoro)}")
    ok = falliti = 0
    for club_id, incontri in lavoro:
        try:
            j = scarica(club_id, piattaforma)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError) as e:
            # Un avversario irraggiungibile non deve fermare l'aggiornamento: si riprova
            # al giro successivo, resta semplicemente senza dati fino ad allora.
            print(f"  club {club_id}: non recuperato ({e.__class__.__name__})")
            falliti += 1
            continue

        o = j.get("overallStats") or {}
        info = (j.get("clubInfoData") or {}).get(str(club_id)) or {}
        cur.execute(
            """INSERT INTO opponent_clubs
                 (club_id, name, skill_rating, games_played, wins, losses, ties,
                  best_division, fetched_at)
               VALUES (?,?,?,?,?,?,?,?,?)
               ON CONFLICT(club_id) DO UPDATE SET
                 name=excluded.name, skill_rating=excluded.skill_rating,
                 games_played=excluded.games_played, wins=excluded.wins,
                 losses=excluded.losses, ties=excluded.ties,
                 best_division=excluded.best_division, fetched_at=excluded.fetched_at""",
            (
                intero(club_id),
                info.get("name") or o.get("name"),
                intero(o.get("skillRating")),
                intero(o.get("gamesPlayed")),
                intero(o.get("wins")),
                intero(o.get("losses")),
                intero(o.get("ties")),
                o.get("bestDivision"),
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        con.commit()
        ok += 1
        print(f"  {info.get('name') or club_id}: skill {o.get('skillRating')} "
              f"({incontri} {'incontro' if incontri == 1 else 'incontri'} con noi)")
        time.sleep(PAUSA_TRA_CHIAMATE)

    totale = cur.execute("SELECT COUNT(*) FROM opponent_clubs").fetchone()[0]
    con.close()
    print(f"Avversari aggiornati: {ok} | non recuperati: {falliti} | totale in archivio: {totale}")


if __name__ == "__main__":
    main()
