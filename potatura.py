#!/usr/bin/env python3
"""Toglie dal database il testo grezzo che nessuno legge piu'.

IL PROBLEMA, MISURATO IL 28/08/2026.

Il 77% del database era `raw_json`: il record originale di EA, salvato per intero accanto
alle colonne vere. Nasceva da un principio giusto - non perdere nessun campo di EA, perche'
al momento dell'ingest non si sa quale servira' domani - ma il conto era questo:

    matches               1160 KB   32%   nessuno lo legge
    member_stats_history   954 KB   27%   letto solo l'ultimo
    match_player_stats     583 KB   16%   nessuno lo legge
    club_stats_history      51 KB    1%   letto solo l'ultimo

E il database intero viene committato ad ogni giro che porta novita'. Misurato sulla
cronologia vera: 194 KB per versione, 46 versioni in sette giorni. Con FC 27 e 800 partite
a stagione ogni versione peserebbe ~1,5 MB, cioe' ~70 MB alla settimana e qualche GB
nell'arco della stagione - oltre i limiti di GitHub, per dati che nessuno apre mai.

PERCHE' TOGLIERLO NON TRADISCE IL PRINCIPIO.

Il principio era "non perdere nessun campo di EA", e resta rispettato in due modi:

1. le colonne vere restano tutte: si tolgono le COPIE, non i dati;
2. ogni versione passata del database e' un commit di git. Il testo grezzo di ieri e'
   recuperabile da li' se un giorno servisse davvero. Non e' cancellato, e' archiviato
   dove non pesa sui commit di domani.

COSA SI TIENE, E PERCHE' PROPRIO QUELLO.

`TIENI_PARTITE = 15` non e' un numero tondo scelto a caso: EA espone le ultime **dieci**
partite, quindi quindici coprono con margine tutto cio' che e' ancora vivo alla fonte. Per
quelle il grezzo puo' ancora servire a capire un ingest andato storto mentre lo si puo'
ancora rifare.

L'ULTIMO SCATTO NON SI TOCCA MAI, ed e' la parte delicata. `ingest.py` decide se salvare un
nuovo scatto confrontando il payload con quello precedente: se gli si toglie il grezzo
dell'ultimo, il confronto fallisce sempre e il database si riempie di scatti identici -
esattamente il contrario di quello che si vuole ottenere. Il codice regge comunque (tratta
il NULL come "diverso" e salva) ma il danno sarebbe silenzioso, cioe' del tipo peggiore.
"""

import sqlite3
import sys

# Piu' della finestra di EA, che e' dieci. Sotto quel numero si perderebbe il grezzo di
# partite ancora rileggibili alla fonte, che e' l'unico caso in cui servirebbe.
TIENI_PARTITE = 15


def pota(con, tieni_partite=TIENI_PARTITE):
    """Azzera il grezzo superfluo. Restituisce i byte liberati, per tabella."""
    if tieni_partite < 10:
        raise ValueError(
            f"tieni_partite={tieni_partite} e' sotto la finestra di dieci partite di EA: "
            "si perderebbe il grezzo di partite ancora rileggibili alla fonte")

    cur = con.cursor()
    liberati = {}

    def misura(tabella, dove, parametri=()):
        prima = cur.execute(
            f"SELECT COALESCE(SUM(LENGTH(raw_json)), 0) FROM {tabella} WHERE {dove}",
            parametri).fetchone()[0]
        if prima:
            cur.execute(f"UPDATE {tabella} SET raw_json = NULL WHERE {dove}", parametri)
            liberati[tabella] = liberati.get(tabella, 0) + prima

    for tabella in ("matches", "match_player_stats"):
        misura(tabella, "raw_json IS NOT NULL AND match_id NOT IN "
                        "(SELECT match_id FROM matches ORDER BY played_at DESC LIMIT ?)",
               (tieni_partite,))

    # Gli scatti: si tiene solo il piu' recente, che e' quello con cui ingest.py confronta.
    misura("club_stats_history",
           "raw_json IS NOT NULL AND id != (SELECT MAX(id) FROM club_stats_history)")
    misura("member_stats_history",
           "raw_json IS NOT NULL AND fetched_at != "
           "(SELECT MAX(fetched_at) FROM member_stats_history)")

    con.commit()
    return liberati


def main():
    percorso = sys.argv[1] if len(sys.argv) > 1 else "lentoni.db"
    con = sqlite3.connect(percorso)
    liberati = pota(con)
    if not liberati:
        print("  niente da potare")
    for tabella, byte in sorted(liberati.items(), key=lambda x: -x[1]):
        print(f"  {tabella:24} {byte / 1024:>8.0f} KB liberati")
    con.execute("VACUUM")
    con.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
