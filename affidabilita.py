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
    python3 affidabilita.py --completa   # tutte le voci, pari/dispari, intervallo al 90%
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


# ---- La misura completa (27/10/2026) ----
#
# La misura qui sopra guarda quattro voci e divide l'archivio in prima e seconda meta'. Due
# limiti: l'efficienza tecnica (30% dell'indice) non c'era, e prima/seconda meta' mescola
# l'affidabilita' con i cambi nel tempo (modulo, ruoli, rosa). Con --completa si misurano
# tutte le voci e anche i pezzi della tecnica, si aggiunge la divisione PARI/DISPARI (due
# campioni intrecciati nel tempo, quindi senza tendenze) e un intervallo al 90% ottenuto
# ricampionando i giocatori: con 14 giocatori e' l'incertezza vera, non una regola a occhio.

PESI_TECNICA = {  # gli stessi di modello/pagina.js: passaggi, contrasti, tiro, gol subiti
    "DIFENSORI": (.25, .40, .05, .30), "CENTROCAMPISTI": (.40, .30, .30, 0),
    "ESTERNI": (.40, .20, .40, 0), "ATTACCANTI": (.45, .10, .45, 0),
    "TREQUARTISTA": (.50, .10, .40, 0),
}


def _su_scala(v, lo, hi):
    return max(0.0, min(1.0, (v - lo) / (hi - lo)))


def misura_completa(db, club_id, minimo=5, ricampionamenti=4000):
    import json
    import random

    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    cfg = ruoli.carica()
    partite = [r["match_id"] for r in con.execute(
        "SELECT match_id FROM matches WHERE club_id = ? ORDER BY ts", (club_id,))]
    vinte = {r["match_id"]: r["win"] for r in con.execute(
        "SELECT match_id, win FROM matches WHERE club_id = ?", (club_id,))}
    righe = {}
    for mid in partite:
        valide = [dict(r) for r in con.execute(
            "SELECT * FROM match_player_stats WHERE match_id = ? AND club_id = ?", (mid, club_id))
            if ruoli.conta(cfg, r["player_name"], r["pos"], str(mid), r["rating"])]
        if len(valide) >= 3:
            righe[mid] = valide
    con.close()
    usate = [m for m in partite if m in righe]
    if len(usate) < 10:
        print("Servono almeno dieci partite utilizzabili per dire qualcosa.")
        return 1
    gruppi = {n: (v.get("gruppo") if isinstance(v, dict) else v)
              for n, v in json.load(open("roles.json", encoding="utf-8"))["giocatori"].items()}

    def aggrega(ids):
        acc = {}
        for mid in ids:
            for x in righe[mid]:
                a = acc.setdefault(x["player_name"], dict(
                    n=0, ga=0, scarto=0, voto=0, mom=0, rossi=0, pm=0, pa=0, tm=0, ta=0,
                    gol=0, tiri=0, gs=0, sec=0, win=0))
                altri = [y["rating"] for y in righe[mid] if y["player_name"] != x["player_name"]]
                a["n"] += 1
                a["ga"] += (x["goals"] or 0) + (x["assists"] or 0)
                a["scarto"] += x["rating"] - sum(altri) / len(altri)
                a["voto"] += x["rating"]
                a["mom"] += 1 if x["mom"] else 0
                a["rossi"] += x["red_cards"] or 0
                a["pm"] += x["passes_made"] or 0
                a["pa"] += x["pass_attempts"] or 0
                a["tm"] += x["tackles_made"] or 0
                a["ta"] += x["tackle_attempts"] or 0
                a["gol"] += x["goals"] or 0
                a["tiri"] += x["shots"] or 0
                a["win"] += vinte.get(mid) or 0
                if x["goals_conceded"] is not None and (x["seconds_played"] or 0) > 0:
                    a["gs"] += x["goals_conceded"]
                    a["sec"] += x["seconds_played"]
        return acc

    def tecnica(a, nome):
        if not a["pa"] or not a["ta"]:
            return None
        p = PESI_TECNICA.get(gruppi.get(nome), PESI_TECNICA["ATTACCANTI"])
        tiro = a["gol"] / a["tiri"] * 100 if a["tiri"] else 30
        gs = a["gs"] * 5400 / a["sec"] if a["sec"] else 2.5
        return 100 * (p[0] * _su_scala(a["pm"] / a["pa"] * 100, 60, 90)
                      + p[1] * _su_scala(a["tm"] / a["ta"] * 100, 5, 50)
                      + p[2] * _su_scala(tiro, 10, 50) + p[3] * _su_scala(gs, 4, 0))

    voci = {
        "gol + assist a partita":  lambda a, n: a["ga"] / a["n"],
        "media voto":              lambda a, n: a["voto"] / a["n"],
        "scarto voto vs compagni": lambda a, n: a["scarto"] / a["n"],
        "% migliore in campo":     lambda a, n: a["mom"] / a["n"],
        "efficienza tecnica":      tecnica,
        "  passaggi riusciti %":   lambda a, n: a["pm"] / a["pa"] if a["pa"] else None,
        "  contrasti riusciti %":  lambda a, n: a["tm"] / a["ta"] if a["ta"] else None,
        "  tiri trasformati %":    lambda a, n: a["gol"] / a["tiri"] if a["tiri"] else None,
        "  gol subiti ogni 90'":   lambda a, n: a["gs"] * 5400 / a["sec"] if a["sec"] else None,
        "rossi a partita":         lambda a, n: a["rossi"] / a["n"],
        "% vittorie con lui":      lambda a, n: a["win"] / a["n"],
    }

    def coppie(a1, a2, f):
        out = []
        for nome in a1:
            if nome in a2 and a1[nome]["n"] >= minimo and a2[nome]["n"] >= minimo:
                x, y = f(a1[nome], nome), f(a2[nome], nome)
                if x is not None and y is not None:
                    out.append((x, y))
        return out

    def intervallo(c, rnd):
        vals = sorted(r for r in (correlazione([rnd.choice(c) for _ in c])
                                  for _ in range(ricampionamenti)) if r is not None)
        return vals[int(.05 * len(vals))], vals[int(.95 * len(vals)) - 1]

    meta = len(usate) // 2
    a_meta = (aggrega(usate[:meta]), aggrega(usate[meta:]))
    a_pari = (aggrega(usate[0::2]), aggrega(usate[1::2]))
    rnd = random.Random(0)
    print()
    print(f"Club {club_id}: {len(usate)} partite utilizzabili su {len(partite)}, "
          f"minimo {minimo} presenze per parte.")
    print()
    print(f"  {'voce':27}{'1a/2a meta':>11}{'pari/disp':>11}{'90% pari/disp':>18}{'giocatori':>10}")
    for nome, f in voci.items():
        r1 = correlazione(coppie(*a_meta, f))
        c2 = coppie(*a_pari, f)
        r2 = correlazione(c2)
        ic = "" if r2 is None else "{:+.2f} .. {:+.2f}".format(*intervallo(c2, rnd))
        fmt = lambda v: "  n/d" if v is None else f"{v:+.2f}"
        print(f"  {nome:27}{fmt(r1):>11}{fmt(r2):>11}{ic:>18}{len(c2):>10}")
    print()
    print("  Un valore negativo non e' 'affidabile al contrario': e' rumore, o una misura")
    print("  di squadra che si ridistribuisce fra chi gioca.")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="lentoni.db")
    ap.add_argument("--club", type=int, default=None)
    ap.add_argument("--min-per-meta", type=int, default=5,
                    help="presenze minime in ciascuna meta' per entrare nel confronto")
    ap.add_argument("--serata", action="store_true",
                    help="misura solo se la squadra cala nel corso della serata")
    ap.add_argument("--completa", action="store_true",
                    help="tutte le voci, anche la tecnica, con divisione pari/dispari e intervallo")
    args = ap.parse_args()

    club_id = args.club
    if club_id is None:
        import json
        club_id = json.load(open("club.json", encoding="utf-8"))["attivo"]["club_id"]

    if args.serata:
        calo_serata(args.db, club_id)
        return 0
    if args.completa:
        return misura_completa(args.db, club_id, args.min_per_meta)

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
