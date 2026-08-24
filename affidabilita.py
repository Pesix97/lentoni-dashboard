#!/usr/bin/env python3
"""Quanto e' affidabile ogni metrica dell'Indice di Forza?

Una statistica individuale vale qualcosa solo se si conferma: chi era sopra la media nella
prima meta' dell'archivio dovrebbe esserlo anche nella seconda. Se non succede, quella
metrica sta misurando rumore, e pesarla nell'indice significa ordinare i giocatori a caso.

Misurato il 24/08/2026 su 59 partite:

    gol + assist            +0.63     l'unica cosa che persiste
    scarto vs compagni      +0.19     debole, ma il doppio del voto grezzo
    media voto              +0.07     praticamente rumore
    premio migliore         +0.08     rumore

L'Indice di Forza dava allora il 40% del peso alla media voto e il 20% a gol+assist: era
pesato quasi al contrario. Nessuno se n'era accorto perche' quei pesi sembrano ragionevoli
a chiunque li legga - ed e' esattamente il motivo per cui vanno misurati invece che scelti.

Lo "scarto rispetto ai compagni" e' il voto del giocatore meno la media dei compagni NELLA
STESSA PARTITA. Cancella la forza dell'avversario, l'andamento della squadra quella sera e
la stanchezza di fine sessione: il fatto che la sua affidabilita' sia il doppio di quella
del voto grezzo dice che quel contesto era davvero rumore.

ATTENZIONE ALL'INCERTEZZA. Con dieci giocatori l'errore su una correlazione e' circa
±0.33: il +0.63 e' indicativo, non provato. In piu' fra le due meta' il club ha cambiato
modulo di continuo, e la prima meta' precede la pulizia di ruoli ed esclusioni. Per questo
a agosto si e' deciso di NON riscrivere subito i pesi, ma di rieseguire questa misura
quando l'archivio sara' il doppio.

Uso:
    python3 affidabilita.py [--db lentoni.db] [--min-per-meta 5]
    python3 affidabilita.py --serata     # la squadra cala nel corso della serata?
"""

import argparse
import sqlite3
import sys

import ruoli


def correlazione(coppie):
    """Correlazione di Pearson fra due liste appaiate. None se non calcolabile."""
    if len(coppie) < 3:
        return None
    xs = [a for a, _ in coppie]
    ys = [b for _, b in coppie]
    mx = sum(xs) / len(xs)
    my = sum(ys) / len(ys)
    cov = sum((x - mx) * (y - my) for x, y in coppie)
    den = (sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys)) ** 0.5
    return cov / den if den else None


def carica(db, club_id):
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    cfg = ruoli.carica()
    partite = [r["match_id"] for r in con.execute(
        "SELECT match_id FROM matches WHERE club_id = ? ORDER BY ts", (club_id,))]
    righe = {}
    for mid in partite:
        valide = [r for r in con.execute(
            "SELECT player_name, pos, rating, goals, assists, mom "
            "FROM match_player_stats WHERE match_id = ? AND club_id = ?", (mid, club_id))
            if ruoli.conta(cfg, r["player_name"], r["pos"], str(mid), r["rating"])]
        # Sotto i tre giocatori lo scarto rispetto ai compagni non ha senso.
        if len(valide) >= 3:
            righe[mid] = valide
    con.close()
    return partite, righe


METRICHE = {
    "gol + assist": lambda x, altri: (x["goals"] or 0) + (x["assists"] or 0),
    "scarto vs compagni": lambda x, altri: x["rating"] - sum(altri) / len(altri),
    "media voto": lambda x, altri: x["rating"],
    "premio migliore in campo": lambda x, altri: 1 if x["mom"] else 0,
}


def calo_serata(db, club_id, mescolate=3000):
    """La squadra cala nel corso della serata? Misurato il 24/08/2026: no.

    Domanda che sembra ovvia e non lo e'. La scheda "Come regge la serata" la dava per
    scontata: confrontava le prime due partite con quelle dalla quinta in poi. Ma la quinta
    partita esiste solo nelle serate lunghe, mentre l'inizio c'e' in tutte - due popolazioni
    diverse messe a confronto.

    Qui la pendenza si calcola DENTRO ogni serata, sottraendo la media della serata stessa:
    cosi' una serata storta per conto suo non sposta niente. Poi le posizioni vengono
    rimescolate a caso dentro ogni serata: se la pendenza vera non si distingue da quelle
    finte, non c'e' nessun calo da raccontare.

    Al 24/08/2026, su 10 serate: pendenza +0.013 voto per partita, valore piu' estremo nel
    70% dei rimescolamenti. La scheda e' stata tolta.
    """
    import random
    from collections import defaultdict

    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    partite = {r["match_id"]: r["played_at"] for r in con.execute(
        "SELECT match_id, played_at FROM matches WHERE club_id = ? AND played_at IS NOT NULL",
        (club_id,))}
    quando = {ruoli.ora_italiana(v): k for k, v in partite.items()}
    gruppi = ruoli.serate(sorted(quando))
    posizione = {}
    for g in gruppi:
        for i, t in enumerate(g):
            posizione[quando[t]] = i + 1

    cfg = ruoli.carica()
    voti = defaultdict(list)
    for r in con.execute("SELECT match_id, player_name, pos, rating "
                         "FROM match_player_stats WHERE club_id = ?", (club_id,)):
        if ruoli.conta(cfg, r["player_name"], r["pos"], str(r["match_id"]), r["rating"]):
            voti[r["match_id"]].append(r["rating"])
    con.close()

    def med(v):
        return sum(v) / len(v) if v else None

    def pendenza(punti):
        sx = sum(x * x for x, _ in punti)
        return sum(x * y for x, y in punti) / sx if sx else None

    def punti(mescola=None):
        out = []
        for g in gruppi:
            ids = [quando[t] for t in g if quando[t] in voti]
            if len(ids) < 3:      # sotto le tre partite una pendenza non vuol dire niente
                continue
            medie = [med(voti[m]) for m in ids]
            base = med(medie)
            ps = [posizione[m] for m in ids]
            if mescola:
                mescola.shuffle(ps)
            pmed = sum(ps) / len(ps)
            out += [(p - pmed, v - base) for p, v in zip(ps, medie)]
        return out

    veri = punti()
    if len(veri) < 10:
        print("\nServono piu' serate per misurare il calo.")
        return
    b = pendenza(veri)
    rnd = random.Random(0)
    finti = sorted(pendenza(punti(rnd)) for _ in range(mescolate))
    estremi = sum(1 for f in finti if abs(f) >= abs(b))
    lo, hi = finti[mescolate // 40], finti[-mescolate // 40 - 1]

    print(f"\nCalo nel corso della serata — {len(gruppi)} serate, {len(veri)} partite")
    print(f"  pendenza vera         {b:+.3f} voto per partita giocata")
    print(f"  caso puro (95%)       da {lo:+.3f} a {hi:+.3f}")
    print(f"  p                     {estremi / mescolate:.3f}"
          f"   ({estremi} rimescolamenti su {mescolate} altrettanto estremi)")
    print("  → " + ("nessun calo distinguibile dal caso." if lo <= b <= hi
                    else "il calo esce dall'intervallo del caso: vale la pena guardarlo."))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="lentoni.db")
    ap.add_argument("--club", type=int, default=None)
    ap.add_argument("--min-per-meta", type=int, default=5,
                    help="presenze minime in ciascuna meta' per entrare nel confronto")
    ap.add_argument("--serata", action="store_true",
                    help="misura solo se la squadra cala nel corso della serata")
    args = ap.parse_args()

    club_id = args.club
    if club_id is None:
        import json
        club_id = json.load(open("club.json", encoding="utf-8"))["attivo"]["club_id"]

    if args.serata:
        calo_serata(args.db, club_id)
        return 0

    partite, righe = carica(args.db, club_id)
    if len(righe) < 10:
        print("Servono almeno dieci partite utilizzabili per dire qualcosa.")
        return 1

    meta = len(partite) // 2
    prima = set(partite[:meta])

    print(f"\nArchivio: {len(righe)} partite utilizzabili su {len(partite)}, "
          f"divise in due meta' da {meta}.\n")
    print(f"  {'metrica':30}{'affidabilita':>14}{'giocatori':>12}")

    risultati = {}
    for nome, f in METRICHE.items():
        acc = {}
        for mid, gruppo in righe.items():
            for x in gruppo:
                altri = [y["rating"] for y in gruppo if y["player_name"] != x["player_name"]]
                v = f(x, altri)
                acc.setdefault(x["player_name"], ([], []))[0 if mid in prima else 1].append(v)
        coppie = [(sum(a) / len(a), sum(b) / len(b)) for a, b in acc.values()
                  if len(a) >= args.min_per_meta and len(b) >= args.min_per_meta]
        r = correlazione(coppie)
        risultati[nome] = r
        print(f"  {nome:30}{('  n/d' if r is None else f'{r:+.2f}'):>14}{len(coppie):>12}")

    print(f"\n  Incertezza: con pochi giocatori l'errore su queste correlazioni e' grande")
    print(f"  (circa ±0.33 con dieci). Vanno lette come indicazioni, non come misure fini.")

    ordinate = [(n, r) for n, r in risultati.items() if r is not None]
    if ordinate:
        ordinate.sort(key=lambda kv: -kv[1])
        print(f"\n  Piu' affidabile: {ordinate[0][0]} ({ordinate[0][1]:+.2f})")
        print(f"  Meno affidabile: {ordinate[-1][0]} ({ordinate[-1][1]:+.2f})")
        print("\n  I pesi dell'Indice di Forza dovrebbero seguire quest'ordine.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
