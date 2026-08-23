#!/usr/bin/env python3
"""La domanda del mattino: com'e' stata classificata la serata di ieri?

Nasce dal punto debole piu' serio dell'archivio. EA scrive "midfielder" sia per un COC
sia per un CC sia per un esterno, quindi il ruolo vero di una singola partita puo'
arrivare solo da chi ha giocato. Finora arrivava se e solo se qualcuno se ne ricordava:
un meccanismo che si degrada in silenzio, perche' una serata non segnalata resta
classificata male per sempre senza che nulla lo indichi.

Misurato sull'archivio il 22/08/2026: le partite giocate fuori ruolo sono
statisticamente indistinguibili dalle altre. Tiri, contrasti e passaggi delle partite
corrette a mano cadono in pieno dentro la distribuzione di quelle normali. Un
classificatore automatico su quei numeri produrrebbe rumore, e non va costruito.

Quello che invece si vede sono i vincoli di formazione: due giocatori che fanno il COC a
turno non possono farlo insieme, e un reparto piu' affollato del solito vuol dire che
qualcuno sta coprendo un ruolo che non e' il suo. Su 42 partite queste due regole
intercettano 8 delle 10 correzioni reali, con 12 falsi allarmi.

Otto su dieci non basta per decidere. Basta invece per fare la domanda giusta: invece di
"controlla nove partite" si chiede "in sei eravate a centrocampo sia tu che domenico, chi
faceva il COC?". Le regole servono ad accorciare la domanda, non a sostituire la
risposta. E siccome un falso allarme costa una riga e una svista costa un dato sbagliato
per sempre, sono tarate larghe di proposito.

Uso:
    python3 serata.py                  l'ultima serata non ancora confermata
    python3 serata.py --tutte          tutte le serate non confermate
    python3 serata.py --serata 22/08   una serata precisa
"""

import argparse
import sqlite3
from datetime import datetime, timedelta, timezone

import ruoli

FUSO = timedelta(hours=2)          # ora italiana, per leggere gli orari come li vivete
STACCO = timedelta(hours=3)        # oltre tre ore di pausa comincia un'altra serata


def ora_locale(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00").replace("+00:00", "")) + FUSO


def raggruppa_in_serate(partite):
    """Spezza l'elenco in serate. La soglia vive in ruoli.serate, usata anche altrove."""
    serate, corrente = [], []
    for p in partite:
        if corrente and p["quando"] - corrente[-1]["quando"] > STACCO:
            serate.append(corrente)
            corrente = []
        corrente.append(p)
    if corrente:
        serate.append(corrente)
    return serate


def leggi(db, club_id, cfg):
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    partite = []
    for m in con.execute(
        "SELECT match_id, played_at, opponent_name, goals_for, goals_against "
        "FROM matches WHERE club_id = ? ORDER BY played_at", (club_id,)
    ):
        righe = []
        for r in con.execute(
            "SELECT player_name, pos, rating, goals, assists FROM match_player_stats "
            "WHERE match_id = ? AND club_id = ?", (m["match_id"], club_id)
        ):
            if not ruoli.conta(cfg, r["player_name"], r["pos"], str(m["match_id"]), r["rating"]):
                continue
            righe.append({
                "nome": r["player_name"], "pos": r["pos"], "voto": r["rating"],
                "gol": r["goals"], "assist": r["assists"],
                "gruppo": ruoli.gruppo(cfg, r["player_name"], r["pos"], str(m["match_id"])),
            })
        partite.append({
            "id": str(m["match_id"]), "quando": ora_locale(m["played_at"]),
            "avversario": (m["opponent_name"] or "?").strip(),
            "gol_fatti": m["goals_for"], "gol_subiti": m["goals_against"],
            "righe": righe,
        })
    con.close()
    return partite


def sospetti(serata, cfg):
    """Le due regole strutturali. Restituisce le osservazioni da sottoporre.

    Guardano il reparto GIA' RISOLTO, non l'etichetta grezza di EA. La differenza conta:
    se una serata e' gia' stata corretta a mano, le sue eccezioni hanno gia' sciolto
    l'ambiguita' e non c'e' piu' niente da chiedere. Lavorando sulle etichette grezze lo
    script continuerebbe a segnalare cose gia' sistemate, e una segnalazione che non
    sparisce mai si impara a ignorarla.
    """
    note = []

    # La fascia scoperta. Il club gioca con due esterni: quando ne risulta uno solo, o
    # l'altro lato lo teneva la CPU, oppure lo copriva un umano che di solito gioca
    # altrove. Il secondo caso e' esattamente cio' che va segnalato.
    #
    # Misurata sull'archivio il 22/08/2026, a eccezioni rimosse: intercetta 10 delle 12
    # correzioni note, con 12 falsi allarmi su 42 partite. La precisione e' bassa di
    # proposito, perche' i costi non sono simmetrici: un falso allarme costa una riga di
    # risposta, una svista costa un dato sbagliato per sempre.
    scoperte = [p for p in serata
                if len([r for r in p["righe"] if r["gruppo"] == "ESTERNI"]) < 2]
    if scoperte:
        quante = (f"in 1 partita su {len(serata)}" if len(scoperte) == 1
                  else f"in {len(scoperte)} partite su {len(serata)}")
        # Zero esterni e uno solo vogliono dire cose diverse: nessuno significa quasi
        # sempre che avete cambiato modulo, come la sera del 23/08/2026.
        vuote = [p for p in scoperte
                 if not [r for r in p["righe"] if r["gruppo"] == "ESTERNI"]]
        cosa = ("non risulta nessun esterno" if len(vuote) == len(scoperte)
                else "risulta un solo esterno")
        note.append(
            f"{quante} {cosa}: le fasce le teneva la CPU, oppure le coprivano giocatori "
            f"che di solito stanno altrove, oppure avete cambiato modulo. Come giocavate?"
        )
    return note

# Regole scartate, per non riprovarle:
#
# "Due della rotazione COC insieme tra gli attaccanti." Sembrava solida - il COC e' uno
# solo - ma poggiava su un presupposto sbagliato: quando giocano insieme uno fa il COC e
# l'altro la punta, quindi sono entrambi attaccanti e la classificazione e' gia' giusta.
# Segnalava 27 partite senza che ci fosse niente da correggere. Smontata da una frase di
# chi ci gioca, non dai dati.
#
# "Quattro o piu' a centrocampo." Misurata: zero correzioni intercettate su dodici.
#
# "Tiri, contrasti e passaggi anomali per il ruolo." Le partite giocate fuori ruolo hanno
# valori dentro la distribuzione di quelle normali: non c'e' segnale da estrarre.


def stampa(serata, cfg, confermata):
    inizio, fine = serata[0]["quando"], serata[-1]["quando"]
    v = sum(1 for p in serata if p["gol_fatti"] > p["gol_subiti"])
    n = sum(1 for p in serata if p["gol_fatti"] == p["gol_subiti"])
    s = len(serata) - v - n
    stato = "gia' confermata" if confermata else "DA CONFERMARE"
    print(f"\nSerata del {inizio:%d/%m} — {len(serata)} partite dalle {inizio:%H:%M} "
          f"alle {fine:%H:%M} — {v}V {n}P {s}S  [{stato}]\n")

    nomi = sorted({r["nome"] for p in serata for r in p["righe"]})
    print(f"  {'':18}" + "".join(f"{p['quando']:%H:%M}".rjust(7) for p in serata))
    for nome in nomi:
        riga = f"  {nome[:17]:18}"
        for p in serata:
            r = next((x for x in p["righe"] if x["nome"] == nome), None)
            riga += (ruoli.SIGLE.get(r["gruppo"], "?") if r else "·").rjust(7)
        print(riga)

    note = sospetti(serata, cfg)
    if note:
        print("\n  Da chiarire:")
        for t in note:
            print(f"    - {t}")
    else:
        print("\n  Niente di anomalo nella composizione, ma un fuori ruolo puo' non lasciare")
        print("    traccia nei dati: se qualcosa non torna nella griglia, dimmelo.")
    if not confermata:
        print(f"\n  Se la griglia e' giusta, in roles.json -> serate_confermate: \"{inizio:%Y-%m-%d %H:%M}\"")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="lentoni.db")
    ap.add_argument("--club", type=int, default=None)
    ap.add_argument("--tutte", action="store_true")
    ap.add_argument("--serata", default=None, help="giorno di inizio, formato gg/mm")
    args = ap.parse_args()

    club_id = args.club
    if club_id is None:
        import json
        club_id = json.loads(open("club.json", encoding="utf-8").read())["attivo"]["club_id"]

    cfg = ruoli.carica()
    serate = raggruppa_in_serate(leggi(args.db, club_id, cfg))
    if not serate:
        print("Nessuna partita in archivio.")
        return 0

    def chiave(s):
        return f"{s[0]['quando']:%Y-%m-%d %H:%M}"

    if args.serata:
        scelte = [s for s in serate if f"{s[0]['quando']:%d/%m}" == args.serata]
    elif args.tutte:
        scelte = [s for s in serate if chiave(s) not in cfg["confermate"]]
    else:
        aperte = [s for s in serate if chiave(s) not in cfg["confermate"]]
        scelte = aperte[-1:] if aperte else []

    if not scelte:
        chiuse = len(cfg["chiuse"])
        coda = (f" ({len(cfg['verificate'])} confermate, "
                f"{chiuse} chiuse senza verifica)") if chiuse else ""
        print(f"Nessuna serata da confermare{coda}.")
        return 0

    for s in scelte:
        stampa(s, cfg, chiave(s) in cfg["confermate"])
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
