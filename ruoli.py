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


def ora_italiana(quando):
    """Da un istante UTC all'ora italiana vera, ora legale compresa.

    Prima era una somma fissa di due ore. Funziona da marzo a ottobre e sbaglia tutto il
    resto dell'anno: il 24/12 alle 22:10 UTC in Italia sono le 23:10 del 24, non le 00:10
    del 25. Oltre all'ora sbagliata, le partite di fine serata sarebbero finite datate al
    giorno dopo.

    Se il sistema non ha il database dei fusi si ripiega sulla regola europea scritta a
    mano, che e' stabile dal 1996: ora legale dall'ultima domenica di marzo all'ultima di
    ottobre.
    """
    from datetime import datetime, timedelta, timezone
    if isinstance(quando, str):
        quando = datetime.fromisoformat(quando.replace("Z", "+00:00"))
    if quando.tzinfo is None:
        quando = quando.replace(tzinfo=timezone.utc)
    try:
        from zoneinfo import ZoneInfo
        return quando.astimezone(ZoneInfo("Europe/Rome")).replace(tzinfo=None)
    except Exception:  # noqa: BLE001 - senza tzdata si usa la regola scritta a mano
        def ultima_domenica(anno, mese):
            d = datetime(anno, mese + 1, 1, tzinfo=timezone.utc) - timedelta(days=1)
            return d - timedelta(days=(d.weekday() + 1) % 7)
        inizio = ultima_domenica(quando.year, 3).replace(hour=1)
        fine = ultima_domenica(quando.year, 10).replace(hour=1)
        legale = inizio <= quando < fine
        return (quando + timedelta(hours=2 if legale else 1)).replace(tzinfo=None)


def chiave_serata(primo_istante_utc):
    """L'identificatore di una serata, ancorato a UTC.

    Costruirlo sull'ora locale sembrava piu' leggibile, ma legava le conferme gia' date
    al fuso in vigore quel giorno: correggere l'ora legale avrebbe cambiato ogni chiave e
    fatto riaprire tutte le serate confermate. In UTC la chiave non si muove mai.
    """
    from datetime import datetime, timezone
    t = primo_istante_utc
    if isinstance(t, str):
        t = datetime.fromisoformat(t.replace("Z", "+00:00"))
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return f"{t.astimezone(timezone.utc):%Y-%m-%dT%H:%MZ}"


def _conteggi(voci):
    """Da una lista di serate chiuse a {chiave: quante partite aveva alla chiusura}.

    Accetta anche le stringhe nude del formato vecchio: valgono "chiusa senza sapere
    quante partite aveva", cioe' non verra' mai riaperta. Meglio dichiararlo che
    trattarle come zero, che le riaprirebbe tutte.
    """
    out = {}
    for v in voci or []:
        if isinstance(v, str):
            out[v] = None
        elif isinstance(v, dict) and "serata" in v:
            out[v["serata"]] = v.get("partite")
    return out


def da_chiedere(cfg, chiave, quante):
    """True se questa serata va ancora sottoposta a chi ha giocato."""
    chiuse = dict(cfg["confermate"])
    for s in cfg["chiuse"]:
        chiuse[s["serata"]] = s.get("partite")
    if chiave not in chiuse:
        return True
    alla_chiusura = chiuse[chiave]
    if alla_chiusura is None:
        return False
    # La serata e' cresciuta dopo essere stata chiusa: le partite arrivate dopo non le
    # ha guardate nessuno, quindi torna in coda.
    return quante > alla_chiusura


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
        # Confermata e chiusa non sono la stessa cosa - la prima e' stata verificata da
        # chi ha giocato, la seconda no - ma per chi deve decidere se riproporre una
        # serata valgono uguale: in entrambi i casi non c'e' piu' niente da chiedere.
        #
        # Di ognuna si tiene anche QUANTE partite aveva quando e' stata chiusa. Serve
        # perche' EA pubblica i risultati con ore di ritardo: il 23/08/2026 una serata e'
        # stata confermata con sei partite e la settima e' arrivata dopo, gia' dentro una
        # serata "chiusa". Nessuno avrebbe piu' chiesto niente, e i ruoli di quella
        # partita sarebbero rimasti sbagliati per sempre.
        "confermate": _conteggi(raw.get("serate_confermate")),
        "verificate": _conteggi(raw.get("serate_confermate")),
        "chiuse": [s for s in (raw.get("serate_chiuse") or []) if isinstance(s, dict)],
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
