#!/usr/bin/env python3
"""controllo_dati.py - i numeri della pagina tornano con il database?

Gira nel ciclo (giro.sh) dopo la generazione e PRIMA della pubblicazione. Rilegge
lentoni.db con SQL semplice, senza passare da generate_dashboard.py, e lo confronta con i
dati incorporati nella pagina (`const DATA = ...`). Se qualcosa non torna, la pagina non si
pubblica: resta online quella di prima e le partite entrano comunque nel database.

Cosa controlla, e perche' proprio queste cose (misurate sui dati veri il 04/11/2026: tutte
senza eccezioni oggi, altrimenti non sarebbero un controllo ma un falso allarme fisso):

  1. le partite mostrate sono ESATTAMENTE quelle del club nel database, con gli stessi gol e
     lo stesso esito - non una in piu', non una in meno (e' il guasto "club sbagliato" o
     "titolo mescolato");
  2. in ogni partita vittoria/pareggio/sconfitta sono coerenti con i gol (lo dice il
     database, indipendentemente dalla pagina);
  3. i contatori in alto (V/P/S, partite, gol, skill rating) sono quelli dell'ultimo
     scaricamento nel database, e V+P+S fa le partite giocate;
  4. l'ultimo punto del grafico e' lo skill rating di oggi;
  5. gol e assist della rosa sono quelli dell'ultimo scaricamento dei giocatori (non per un
     titolo chiuso, la cui rosa e' fotografata a un'altra data);
  6. nessun valore impossibile nelle prestazioni: voto fuori da 0-10, passaggi riusciti piu'
     dei tentati, contrasti vinti piu' dei tentati, gol o assist negativi.

Cosa NON controlla, apposta: che i gol dei giocatori sommino ai gol della squadra. Misurato:
29 partite su 212 non tornano, e non e' un errore nostro (autogol, giocatori che escono
dall'elenco di EA). Un controllo che suona sempre non protegge da niente.

Non verifica nemmeno che EA abbia detto il vero: confronta la pagina con il database, non il
database con EA. Per quello c'e' il confronto col contatore di carriera (saluteArchivio).

Uscita: 0 tutto torna; 1 qualcosa non torna (elenco su stdout); 2 il controllo stesso non e'
riuscito a girare (file mancante, formato inatteso) - giro.sh lo tratta come NON bloccante,
perche' una rete di sicurezza che ferma l'archiviazione quando si rompe lei fa piu' danni di
quello che deve intercettare.
"""
import argparse
import json
import sqlite3
import sys

MAX_ELENCO = 12   # righe di dettaglio per controllo: il resto si riassume con un conteggio


def leggi_dati(percorso):
    with open(percorso, encoding="utf-8") as f:
        testo = f.read()
    inizio = testo.index("const DATA = ") + len("const DATA = ")
    return json.loads(testo[inizio:testo.index(";\n", inizio)])


def controlla(db, dati):
    """Ritorna la lista dei problemi, ciascuno una riga leggibile. Lista vuota = tutto torna."""
    problemi = []

    def segnala(titolo, voci):
        if not voci:
            return
        extra = f" (+{len(voci) - MAX_ELENCO} altri)" if len(voci) > MAX_ELENCO else ""
        problemi.append(f"{titolo}: {len(voci)}{extra}\n" +
                        "\n".join("    " + v for v in voci[:MAX_ELENCO]))

    club_id = (dati.get("club") or {}).get("club_id")
    if club_id is None:
        raise ValueError("la pagina non dice di quale club e'")

    # 1. le partite mostrate sono quelle del database
    nel_db = {str(r["match_id"]): r for r in db.execute(
        "SELECT match_id, goals_for, goals_against, win, loss, tie FROM matches WHERE club_id=?",
        (club_id,))}
    in_pagina = {str(m["match_id"]): m for m in dati.get("matches", [])}
    segnala("partite nella pagina ma non nel database del club",
            [f"{k}" for k in in_pagina if k not in nel_db])
    segnala("partite del club nel database ma non nella pagina",
            [f"{k}" for k in nel_db if k not in in_pagina])
    diverse = []
    for k, r in nel_db.items():
        m = in_pagina.get(k)
        if m is None:
            continue
        a = (r["goals_for"], r["goals_against"], int(r["win"]), int(r["loss"]), int(r["tie"]))
        b = (m["goals_for"], m["goals_against"], int(bool(m["win"])), int(bool(m["loss"])),
             int(bool(m["tie"])))
        if a != b:
            diverse.append(f"{k}: database gf/gs/V/S/P {a}, pagina {b}")
    segnala("partite con gol o esito diversi fra pagina e database", diverse)

    # 2. esito coerente con i gol, letto dal solo database
    incoerenti = []
    for k, r in nel_db.items():
        gf, gs = r["goals_for"], r["goals_against"]
        atteso = (int(gf > gs), int(gf < gs), int(gf == gs))
        if (int(r["win"]), int(r["loss"]), int(r["tie"])) != atteso:
            incoerenti.append(f"{k}: {gf}-{gs} ma V/S/P = {r['win']}/{r['loss']}/{r['tie']}")
    segnala("partite il cui esito non torna con i gol (database)", incoerenti)

    # 3. contatori in alto = ultimo scaricamento
    ultimo = db.execute(
        "SELECT * FROM club_stats_history WHERE club_id=? ORDER BY fetched_at DESC LIMIT 1",
        (club_id,)).fetchone()
    latest = dati.get("latest") or {}
    if ultimo is not None:
        campi = ("wins", "losses", "ties", "games_played", "goals", "goals_against", "skill_rating")
        segnala("contatori in alto diversi dall'ultimo scaricamento",
                [f"{c}: database {ultimo[c]}, pagina {latest.get(c)}"
                 for c in campi if ultimo[c] != latest.get(c)])
        if ultimo["wins"] + ultimo["losses"] + ultimo["ties"] != ultimo["games_played"]:
            problemi.append(
                f"V+P+S non fa le partite giocate nell'ultimo scaricamento: "
                f"{ultimo['wins']}+{ultimo['ties']}+{ultimo['losses']} contro {ultimo['games_played']}")
        # 4. ultimo punto del grafico
        storia = dati.get("history") or []
        if storia and storia[-1].get("skill_rating") != ultimo["skill_rating"]:
            problemi.append(f"l'ultimo punto del grafico e' {storia[-1].get('skill_rating')}, "
                            f"lo skill rating di oggi e' {ultimo['skill_rating']}")

    # 5. gol e assist della rosa = ultimo scaricamento dei giocatori
    # Non per un titolo chiuso: la sua rosa e' fotografata a un'altra data (e con i totali di
    # carriera di allora), non nell'ultimo scaricamento del club. Misurato il 04/11/2026 su
    # archivio/fc-26.html: 25 differenze, tutte legittime. Un controllo che li segnala suona
    # sempre, quindi per i titoli chiusi non si applica.
    ultimo_giro = None if dati.get("titoloChiuso") else db.execute(
        "SELECT MAX(fetched_at) FROM member_stats_history WHERE club_id=?", (club_id,)).fetchone()[0]
    if ultimo_giro:
        ref = {r["player_name"]: r for r in db.execute(
            "SELECT player_name, goals, assists FROM member_stats_history "
            "WHERE club_id=? AND fetched_at=?", (club_id, ultimo_giro))}
        errori = []
        for r in dati.get("roster", []):
            n = r["player_name"]
            if n not in ref:
                errori.append(f"{n}: in rosa nella pagina ma assente dall'ultimo scaricamento")
            elif (ref[n]["goals"], ref[n]["assists"]) != (r["goals"], r["assists"]):
                errori.append(f"{n}: gol/assist database {ref[n]['goals']}/{ref[n]['assists']}, "
                              f"pagina {r['goals']}/{r['assists']}")
        segnala("rosa: gol o assist diversi dall'ultimo scaricamento", errori)

    # 6. valori impossibili nelle prestazioni mostrate
    assurdi = []
    for mid, righe in (dati.get("matchPlayers") or {}).items():
        for p in righe:
            nome = f"{mid} {p.get('player_name')}"
            v = p.get("rating")
            if v is not None and not (0 <= v <= 10):
                assurdi.append(f"{nome}: voto {v}")
            if (p.get("passes_made") or 0) > (p.get("pass_attempts") or 0):
                assurdi.append(f"{nome}: passaggi riusciti {p.get('passes_made')} > tentati {p.get('pass_attempts')}")
            if (p.get("tackles_made") or 0) > (p.get("tackle_attempts") or 0):
                assurdi.append(f"{nome}: contrasti vinti {p.get('tackles_made')} > tentati {p.get('tackle_attempts')}")
            if (p.get("goals") or 0) < 0 or (p.get("assists") or 0) < 0:
                assurdi.append(f"{nome}: gol/assist negativi")
    segnala("prestazioni con valori impossibili", assurdi)
    return problemi


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default="lentoni.db")
    ap.add_argument("--html", default="index.html")
    a = ap.parse_args(argv)
    try:
        dati = leggi_dati(a.html)
        db = sqlite3.connect(f"file:{a.db}?mode=ro", uri=True)
        db.row_factory = sqlite3.Row
        problemi = controlla(db, dati)
    except Exception as e:          # il controllo non e' riuscito: non e' un verdetto
        print(f"  controllo dei dati non eseguibile: {type(e).__name__}: {e}")
        return 2
    if problemi:
        print(f"  {a.html}: i numeri non tornano con il database")
        for p in problemi:
            print("  - " + p)
        return 1
    print(f"  {a.html}: i numeri tornano con il database")
    return 0


if __name__ == "__main__":
    sys.exit(main())
