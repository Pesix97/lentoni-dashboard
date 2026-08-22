#!/usr/bin/env python3
"""Lettura di roles.json e risposta a una sola domanda: in che reparto conta questa
prestazione?

Esiste come modulo a se' perche' quella domanda viene posta da due parti diverse: dalla
dashboard, in JavaScript, dentro la pagina generata; e dagli script di controllo, in
Python. Due implementazioni della stessa regola divergono prima o poi, e divergono in
silenzio. test_pipeline confronta le due su tutte le righe dell'archivio, cosi' se un
giorno si allontanano lo si scopre subito invece che dai numeri sbagliati.

Le regole, in ordine di precedenza:
  1. una eccezione dichiarata per quella partita vince su tutto
  2. per chi non e' in rosa vale l'etichetta EA tradotta in reparto
  3. se l'etichetta della partita e' quella abituale del giocatore, vale il suo reparto
  4. altrimenti ha giocato fuori ruolo, e conta il reparto dell'etichetta EA
"""

import json
from pathlib import Path

QUI = Path(__file__).resolve().parent


def carica(percorso=None):
    """Legge roles.json e restituisce la configurazione gia' indicizzata."""
    p = Path(percorso) if percorso else QUI / "roles.json"
    raw = json.loads(p.read_text(encoding="utf-8"))
    giocatori = raw.get("giocatori") or {}
    return {
        "gruppi": {n: d["gruppo"] for n, d in giocatori.items() if isinstance(d, dict)},
        "etichette": {n: d.get("etichetta_ea") for n, d in giocatori.items()
                      if isinstance(d, dict)},
        "macro": raw.get("macro_ea") or {},
        "ordine": raw.get("ordine") or [],
        "eccezioni": {f"{e['match_id']}|{e['giocatore']}": e["gruppo"]
                      for e in (raw.get("eccezioni_partita") or [])},
        "esclusioni": {f"{e['match_id']}|{e['giocatore']}"
                       for e in (raw.get("esclusioni_partita") or [])},
        "ex": set(raw.get("ex_giocatori") or []),
        "sentinella": raw.get("voto_sentinella"),
        "confermate": list(raw.get("serate_confermate") or []),
        "coc": {n for n, d in giocatori.items()
                if isinstance(d, dict) and d.get("gruppo") == "ATTACCANTI"
                and d.get("etichetta_ea") == "midfielder"},
    }


def gruppo(cfg, nome, pos, match_id):
    """Il reparto in cui questa singola prestazione va conteggiata."""
    chiave = f"{match_id}|{nome}"
    if chiave in cfg["eccezioni"]:
        return cfg["eccezioni"][chiave]
    if nome not in cfg["gruppi"]:
        return cfg["macro"].get(pos)
    if pos == cfg["etichette"].get(nome):
        return cfg["gruppi"][nome]
    return cfg["macro"].get(pos)


def conta(cfg, nome, pos, match_id, rating):
    """False se la prestazione non va conteggiata affatto."""
    if nome in cfg["ex"]:
        return False
    if f"{match_id}|{nome}" in cfg["esclusioni"]:
        return False
    if cfg["sentinella"] is not None and rating == cfg["sentinella"]:
        return False
    return True


def serate(quando):
    """Raggruppa una sequenza ordinata di orari in serate di gioco.

    Oltre tre ore di pausa comincia un'altra sessione: dentro una serata le partite si
    susseguono ogni venti minuti circa, tra una serata e l'altra passa quasi un giorno,
    quindi la soglia non e' delicata. Serve perche' le domande sui ruoli si fanno per
    serata e non per partita: nove partite di una notte sono quasi sempre una o due
    decisioni ripetute, non nove decisioni diverse.
    """
    import datetime as _dt
    gruppi, corrente = [], []
    for t in quando:
        if corrente and t - corrente[-1] > _dt.timedelta(hours=3):
            gruppi.append(corrente)
            corrente = []
        corrente.append(t)
    if corrente:
        gruppi.append(corrente)
    return gruppi


SIGLE = {
    "DIFENSORI": "DIF",
    "CENTROCAMPISTI": "CC",
    "ESTERNI": "EST",
    "ATTACCANTI": "ATT",
    "PORTIERI": "POR",
}
