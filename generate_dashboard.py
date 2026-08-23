#!/usr/bin/env python3
"""
generate_dashboard.py — Legge lentoni.db e genera dashboard.html:
un'interfaccia grafica standalone (un solo file, nessun server richiesto)
con grafici e tabelle sui dati del club.

Uso:
    python generate_dashboard.py --db lentoni.db --out dashboard.html

Basta poi aprire dashboard.html con doppio click in qualsiasi browser.
Rigeneralo ogni volta che il DB viene aggiornato (fetch_and_update.py
lo fa automaticamente in coda).

Le sezioni ricalcano quelle di un tipico sito di tracking Pro Clubs
(club overview, player ratings, form graph, match history, awards/
records, roasts, squad chemistry, head-to-head tra membri della rosa,
season recap), costruite interamente dai dati già presenti nel DB
locale — nessuna chiamata di rete aggiuntiva richiesta.
"""
import argparse
import json
import sqlite3
from pathlib import Path


QUI = Path(__file__).resolve().parent


def fetch_all(cur, sql, params=()):
    cur.execute(sql, params)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


DEFAULT_CLUB = {"club_id": 2703620, "titolo": "FC 26", "piattaforma": "common-gen5"}


def carica_club(script_dir=None):
    """Quale club mostrare. Vedi club.json per il perche'.

    Ogni titolo EA crea un club nuovo: l'archivio li tiene tutti, ma la dashboard ne
    mostra uno alla volta. Senza questo filtro due titoli finirebbero sommati nella
    stessa rosa e nelle stesse classifiche, in silenzio.
    """
    base = Path(script_dir) if script_dir else Path(__file__).resolve().parent
    path = base / "club.json"
    if not path.exists():
        print(f"  attenzione: {path.name} non trovato, uso il club predefinito")
        return dict(DEFAULT_CLUB)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        attivo = raw.get("attivo") or {}
        club_id = int(attivo["club_id"])
        return {
            "club_id": club_id,
            "titolo": attivo.get("titolo") or "",
            "piattaforma": attivo.get("piattaforma") or "",
            "storico": raw.get("storico") or [],
        }
    except Exception as exc:  # noqa: BLE001 - meglio il predefinito che non pubblicare
        print(f"  attenzione: club.json non interpretabile ({exc.__class__.__name__}), uso il predefinito")
        return dict(DEFAULT_CLUB)


PIATTAFORME = {
    "common-gen5": "PS5 / Xbox Series · PC",
    "common-gen4": "PS4 / Xbox One",
    "nx": "Nintendo Switch",
}


def etichetta_piattaforma(codice):
    """Il codice EA in una forma leggibile, senza perdere l'originale se sconosciuto."""
    if not codice:
        return "-"
    return PIATTAFORME.get(codice, codice)


def controlla_identita(cur, club_id):
    """Segnala quando la stessa persona compare con due nomi diversi.

    Tutto il progetto identifica i giocatori dal NOME: nella pagina il nome e' la chiave
    69 volte, roles.json e' indicizzato per nome, e l'id numerico che EA assegna a ogni
    persona viene usato solo per deduplicare le vecchie righe ricostruite.

    Se qualcuno cambia il nome PSN, quindi, lo storico si spezza in due persone diverse:
    la nuova compare senza ruolo tra i "da assegnare", e le medie di entrambe diventano
    sbagliate. Tutto in silenzio. Riscrivere l'identita' sull'id EA vorrebbe dire toccare
    ogni chiave del progetto per un guasto che non e' ancora successo; segnalarlo il
    giorno stesso costa dieci righe e lascia il tempo di rimediare.

    Gli id 'recovered_*' sono sintetici, nati dalla ricostruzione manuale del 06/08/2026:
    vanno ignorati, altrimenti segnalerebbero ogni giocatore per sempre.
    """
    righe = fetch_all(
        cur,
        """SELECT ea_player_id, GROUP_CONCAT(DISTINCT player_name) AS nomi
           FROM match_player_stats
           WHERE club_id = ? AND ea_player_id NOT LIKE 'recovered\\_%' ESCAPE '\\'
           GROUP BY ea_player_id
           HAVING COUNT(DISTINCT player_name) > 1""",
        (club_id,),
    )
    for r in righe:
        print(f"  ATTENZIONE: l'id EA {r['ea_player_id']} compare con piu' nomi: {r['nomi']}."
              f" Probabile cambio di nome: lo storico risultera' spezzato in due giocatori"
              f" e il ruolo in roles.json non verra' piu' riconosciuto.")
    return [dict(r) for r in righe]


def assottiglia(storico, giorni_pieni=7, giorni_giornalieri=60):
    """Riduce le istantanee vecchie senza toccare quelle recenti.

    Ogni istantanea dei giocatori pesa circa 6 KB nella pagina pubblicata, e ne viene
    salvata una a ogni cambiamento: nelle notti di gioco sono sette o otto. Misurato il
    23/08/2026, questo storico occupava il 31% di index.html, e a tre serate a settimana
    avrebbe portato la pagina oltre i 6 MB in un anno.

    I grafici di crescita non hanno pero' bisogno del dettaglio a venti minuti di tre mesi
    fa: quello serve solo mentre si gioca. Si tengono percio' tutte le istantanee degli
    ultimi giorni, una al giorno per i due mesi precedenti, e una a settimana per il resto.
    Il primo e l'ultimo punto della serie non si toccano mai, cosi' le curve non cambiano
    ne' inizio ne' fine.

    Nessun dato viene perso: il database conserva tutto, si assottiglia solo cio' che
    finisce nella pagina.
    """
    if not storico:
        return storico
    from datetime import datetime, timedelta

    def quando(v):
        return datetime.fromisoformat(str(v).replace("Z", "+00:00").replace("+00:00", ""))

    istanti = sorted({h["fetched_at"] for h in storico})
    if len(istanti) <= 2:
        return storico
    ultimo = quando(istanti[-1])
    tenuti, visti_giorno, viste_settimana = set(), {}, {}
    for i in istanti:
        t = quando(i)
        eta = (ultimo - t).days
        if eta <= giorni_pieni:
            tenuti.add(i)
        elif eta <= giorni_giornalieri:
            visti_giorno[t.strftime("%Y-%m-%d")] = i      # l'ultima del giorno vince
        else:
            viste_settimana[t.strftime("%G-W%V")] = i     # l'ultima della settimana vince
    tenuti |= set(visti_giorno.values()) | set(viste_settimana.values())
    tenuti.add(istanti[0])
    tenuti.add(istanti[-1])
    return [h for h in storico if h["fetched_at"] in tenuti]


def build_data(db_path, club_id=None, esclusi=None, righe_escluse=None,
               voto_sentinella=None):
    if club_id is None:
        club_id = carica_club()["club_id"]
    # Chi ha lasciato il gruppo viene tolto QUI, prima che i dati entrino nella pagina:
    # filtrarlo solo lato browser lascerebbe comunque i suoi nomi e le sue statistiche
    # dentro il file pubblicato.
    esclusi = set(esclusi or [])
    # Singole prestazioni da non conteggiare: quando il CPU ha preso il controllo di un pro,
    # EA attribuisce comunque voto, gol e passaggi alla persona. Si toglie la riga qui, una
    # volta sola, cosi' ogni calcolo che parte dalle partite la ignora senza doversene
    # ricordare: classifiche per reparto, indice di forma, formazione tipo, premi.
    righe_escluse = set(righe_escluse or [])
    # Oltre all'elenco a mano c'e' un caso riconoscibile da solo: il voto sentinella.
    # Misurato il 22/08/2026 sull'intero archivio, i voti si distribuiscono con continuita'
    # da 5.8 in su, e sotto c'e' il vuoto fino a un gruppo di righe tutte a 3.0 esatto, con
    # zero tiri e una manciata di passaggi in un'ora di gioco. Non e' una scala che tocca il
    # fondo: e' il valore che EA scrive quando un voto non c'e'. Vengono tolte come le altre.
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    club_info = fetch_all(cur, "SELECT * FROM club_info WHERE club_id = ? LIMIT 1", (club_id,))
    club_info = club_info[0] if club_info else {}

    history = fetch_all(
        cur,
        """SELECT fetched_at, wins, losses, ties, games_played,
                  games_played_playoff, goals, goals_against, skill_rating,
                  promotions, relegations, best_division, best_finish_group,
                  wstreak, unbeatenstreak, reputationtier, league_appearances,
                  finishes_div1_group1, finishes_div2_group1, finishes_div3_group1,
                  finishes_div4_group1, finishes_div5_group1, finishes_div6_group1
           FROM club_stats_history WHERE club_id = ? ORDER BY fetched_at ASC""",
        (club_id,),
    )
    latest_club = history[-1] if history else {}

    # ultimo snapshot per giocatore (per fetched_at piu' recente)
    roster = fetch_all(
        cur,
        """SELECT m.player_name, m.pro_name, m.favorite_position, m.pro_pos,
                  m.pro_height, m.pro_nationality, m.games_played, m.win_rate,
                  m.goals, m.assists, m.rating_ave, m.pass_success_rate,
                  m.tackle_success_rate, m.shot_success_rate, m.passes_made,
                  m.tackles_made, m.man_of_the_match, m.red_cards,
                  m.clean_sheets_def, m.clean_sheets_gk, m.pro_overall,
                  m.prev_goals_trend
           FROM member_stats_history m
           JOIN (
             SELECT player_name, MAX(fetched_at) AS max_fetched
             FROM member_stats_history
             WHERE club_id = ?
             GROUP BY player_name
           ) latest
           ON m.player_name = latest.player_name AND m.fetched_at = latest.max_fetched
           WHERE m.club_id = ? AND (m.games_played > 0 OR m.pro_name != '')
           ORDER BY m.goals DESC""",
        (club_id, club_id),
    )
    roster = [r for r in roster if r["player_name"] not in esclusi]
    for r in roster:
        try:
            r["prev_goals_trend"] = json.loads(r["prev_goals_trend"]) if r["prev_goals_trend"] else []
        except (TypeError, ValueError):
            r["prev_goals_trend"] = []

    # Serie storica completa per giocatore: un punto per ogni aggiornamento.
    # A differenza delle statistiche calcolate dalle partite (archivio parziale,
    # EA restituisce solo le ultime 10), ogni snapshot e' un totale di carriera
    # completo, quindi le curve di crescita sono sempre esatte.
    member_history = fetch_all(
        cur,
        """SELECT fetched_at, player_name, games_played, goals, assists,
                  rating_ave, man_of_the_match, win_rate, pass_success_rate,
                  tackle_success_rate, shot_success_rate, red_cards
           FROM member_stats_history
           WHERE club_id = ?
           ORDER BY fetched_at ASC, player_name ASC""",
        (club_id,),
    )

    member_history = [h for h in member_history if h["player_name"] not in esclusi]
    member_history = assottiglia(member_history)

    matches = fetch_all(
        cur,
        """SELECT match_id, match_type, played_at, ts, opponent_club_id, opponent_name,
                  goals_for, goals_against, win, loss, tie
           FROM matches WHERE club_id = ? ORDER BY ts DESC""",
        (club_id,),
    )

    match_players = {}
    tolte = 0
    tolte_voto = 0
    for m in matches:
        rows = fetch_all(
            cur,
            # Una sola riga per giocatore per partita. La ricostruzione del DB
            # del 06/08/2026 ha lasciato righe duplicate con ea_player_id
            # "recovered_*": senza questo GROUP BY quelle 10 partite contano
            # doppio in ogni statistica calcolata dalle partite. Con MIN(...)
            # SQLite restituisce le colonne della riga vincente, cioe' quella
            # originale (_pref = 0) quando esiste.
            """SELECT player_name, pos, archetype_id, goals, assists, rating,
                      shots, passes_made, pass_attempts, tackles_made,
                      tackle_attempts, saves, cleansheetsgk, cleansheetsdef,
                      red_cards, mom, seconds_played,
                      MIN(CASE WHEN ea_player_id LIKE 'recovered\\_%' ESCAPE '\\'
                               THEN 1 ELSE 0 END) AS _pref
               FROM match_player_stats WHERE match_id = ? AND club_id = ?
               GROUP BY player_name
               ORDER BY rating DESC""",
            (m["match_id"], club_id),
        )
        for r in rows:
            r.pop("_pref", None)
        tenute = []
        for r in rows:
            if f"{m['match_id']}|{r['player_name']}" in righe_escluse:
                tolte += 1
            elif voto_sentinella is not None and r["rating"] == voto_sentinella:
                tolte_voto += 1
            else:
                tenute.append(r)
        match_players[m["match_id"]] = tenute

    if righe_escluse:
        # Conta le righe davvero rimosse, non le voci elencate: se una si riferisce a una
        # partita non archiviata o a un nome sbagliato non toglie nulla, ed e' bene vederlo.
        print(f"  prestazioni escluse a mano: {tolte} su {len(righe_escluse)} elencate")
    if tolte_voto:
        print(f"  prestazioni senza voto (sentinella {voto_sentinella}): {tolte_voto}")

    salute = calcola_salute_archivio(cur, club_id)
    data_identita = controlla_identita(cur, club_id)

    # La tabella puo' non esistere ancora: avversari.py la crea alla prima esecuzione.
    try:
        avversari = {
            str(r["club_id"]): dict(r)
            for r in cur.execute("SELECT * FROM opponent_clubs").fetchall()
        }
    except sqlite3.OperationalError:
        avversari = {}

    con.close()

    return {
        "club": dict(club_info),
        "latest": dict(latest_club),
        "history": history,
        "roster": roster,
        "memberHistory": member_history,
        "matches": matches,
        "matchPlayers": match_players,
        "saluteArchivio": salute,
        "avversari": avversari,
    }


def calcola_salute_archivio(cur, club_id):
    """Quante partite EA dice che il club ha giocato, contro quante ne abbiamo archiviate.

    EA espone il dettaglio per giocatore solo delle ultime 10 partite: se tra un
    aggiornamento e l'altro se ne giocano di piu', quelle in eccesso spariscono per
    sempre. Il contatore "gamesPlayed" invece e' cumulativo e non perde nulla, quindi
    la differenza tra i due dice esattamente quante partite sono andate perse.

    Il divario recente e' quello che conta: qualche partita mancante nelle ultime ore
    e' normale (EA pubblica i risultati con ore di ritardo), mentre un divario che
    resta anche dopo un giorno significa che le abbiamo perse davvero.
    """
    snaps = cur.execute(
        "SELECT fetched_at, games_played FROM club_stats_history "
        "WHERE club_id = ? AND games_played IS NOT NULL ORDER BY fetched_at",
        (club_id,),
    ).fetchall()
    totale_archiviate = cur.execute(
        "SELECT COUNT(*) FROM matches WHERE club_id = ?", (club_id,)
    ).fetchone()[0]
    vuoto = {
        "archiviate": totale_archiviate, "attese": None, "divario": None,
        "divarioRecente": None, "daQuando": None, "giocateEA": None,
    }
    if len(snaps) < 2:
        return vuoto

    primo, ultimo = snaps[0], snaps[-1]
    attese = (ultimo["games_played"] or 0) - (primo["games_played"] or 0)
    archiviate_dopo = cur.execute(
        "SELECT COUNT(*) FROM matches WHERE club_id = ? AND played_at >= ?",
        (club_id, primo["fetched_at"]),
    ).fetchone()[0]

    # Divario recente: ultime 48 ore, l'unico su cui si possa ancora intervenire.
    limite = cur.execute(
        "SELECT datetime(?, '-48 hours')", (ultimo["fetched_at"],)
    ).fetchone()[0]
    recenti = [r for r in snaps if r["fetched_at"] >= limite]
    divario_recente = None
    if len(recenti) >= 2:
        attese_rec = (recenti[-1]["games_played"] or 0) - (recenti[0]["games_played"] or 0)
        arch_rec = cur.execute(
            "SELECT COUNT(*) FROM matches WHERE club_id = ? AND played_at >= ?",
            (club_id, recenti[0]["fetched_at"]),
        ).fetchone()[0]
        divario_recente = max(0, attese_rec - arch_rec)

    return {
        "archiviate": totale_archiviate,
        "attese": attese,
        "archiviateDaPrimoSnapshot": archiviate_dopo,
        "divario": max(0, attese - archiviate_dopo),
        "divarioRecente": divario_recente,
        "daQuando": primo["fetched_at"],
        "giocateEA": ultimo["games_played"],
    }


# Soglia minima di partite giocate per comparire in rosa, classifiche, premi e Indice di Forza.
MIN_GAMES = 30

MODELLO = QUI / "modello"


def carica_modello():
    """Rimette insieme la pagina dai tre pezzi in modello/.

    Fino al 23/08/2026 il modello era una stringa di 3711 righe dentro questo file, con
    dentro 2903 righe di JavaScript. Il problema non era la lunghezza: dentro una stringa
    Python nessun editor sa che quello e' JavaScript, quindi un tag mai chiuso, una
    parentesi in piu' o un ${} sbagliato non venivano segnalati da niente. I tre bug
    trovati quel giorno erano tutti di quel tipo.

    Separandoli, pagina.js e' un file .js vero: l'editor lo controlla, node lo puo'
    leggere direttamente. Il risultato non cambia di un byte - index.html resta un unico
    file autonomo - e la separazione e' stata verificata confrontando gli hash prima e
    dopo lo spostamento.
    """
    pagina = (MODELLO / "pagina.html").read_text(encoding="utf-8")
    return (pagina
            .replace("__STILE__", (MODELLO / "stile.css").read_text(encoding="utf-8"))
            .replace("__SCRIPT__", (MODELLO / "pagina.js").read_text(encoding="utf-8")))


HTML_TEMPLATE = carica_modello()


DEFAULT_ROLE_GROUPS = {
    "order": ["DIFENSORI", "CENTROCAMPISTI", "ESTERNI", "ATTACCANTI", "PORTIERI"],
    "labels": {"DIFENSORI": "Difensori", "CENTROCAMPISTI": "Centrocampisti",
               "ESTERNI": "Esterni", "ATTACCANTI": "Attaccanti", "PORTIERI": "Portieri"},
    "macro": {"defender": "DIFENSORI", "midfielder": "CENTROCAMPISTI",
              "forward": "ATTACCANTI", "goalkeeper": "PORTIERI"},
    "players": {},
    "eaLabels": {},
    "exPlayers": [],
    "exceptions": {},
}


def load_role_groups(script_dir=None):
    """Wrapper difensivo: roles.json e' scritto a mano, un refuso non deve fermare tutto."""
    try:
        return _load_role_groups(script_dir)
    except Exception as exc:  # noqa: BLE001 - qualsiasi errore qui e' preferibile a non pubblicare
        print(f"  attenzione: roles.json non interpretabile ({exc.__class__.__name__}: {exc}), "
              f"uso i ruoli EA come ripiego")
        return dict(DEFAULT_ROLE_GROUPS)


def _load_role_groups(script_dir=None):
    """Legge roles.json (mappa ruoli scritta a mano) accanto a questo script.

    EA espone solo quattro etichette e non distingue un COC da un CC, quindi il ruolo
    reale puo' arrivare solo da un file mantenuto a mano. Se il file manca o e' rotto la
    dashboard si genera comunque: le classifiche per ruolo ripiegano sull'etichetta EA.
    """
    base = Path(script_dir) if script_dir else Path(__file__).resolve().parent
    path = base / "roles.json"
    cfg = dict(DEFAULT_ROLE_GROUPS)
    if not path.exists():
        print(f"  attenzione: {path.name} non trovato, uso i ruoli EA come ripiego")
        return cfg
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError) as exc:
        print(f"  attenzione: {path.name} illeggibile ({exc}), uso i ruoli EA come ripiego")
        return cfg
    cfg["order"] = raw.get("ordine") or cfg["order"]
    cfg["labels"] = raw.get("etichette") or cfg["labels"]
    cfg["macro"] = raw.get("macro_ea") or cfg["macro"]
    players = raw.get("giocatori") or {}
    valid = set(cfg["order"])
    macro_valide = set(cfg["macro"].keys())
    cleaned, etichette, ignored = {}, {}, []
    for name, valore in players.items():
        # Due forme accettate, cosi' il file resta leggibile anche a mano:
        #   "ilmille": "CENTROCAMPISTI"
        #   "Pesix_97": {"gruppo": "ATTACCANTI", "etichetta_ea": "midfielder"}
        if isinstance(valore, dict):
            group = valore.get("gruppo")
            et = valore.get("etichetta_ea")
        else:
            group, et = valore, None
        if group not in valid:
            ignored.append(f"{name}={group}")
            continue
        cleaned[name] = group
        if et:
            if et in macro_valide:
                etichette[name] = et
            else:
                ignored.append(f"{name}.etichetta_ea={et}")
    if ignored:
        print(f"  attenzione: gruppi non validi in {path.name}, ignorati: {', '.join(ignored)}")
    cfg["players"] = cleaned
    cfg["eaLabels"] = etichette
    cfg["exPlayers"] = [n for n in (raw.get("ex_giocatori") or []) if isinstance(n, str)]

    # Eccezioni per singola partita. Servono dove l'etichetta EA e' ambigua: EA scrive
    # "midfielder" sia per un COC sia per un CC, quindi per un giocatore schierato COC di
    # solito non c'e' modo di distinguere le partite in cui ha davvero fatto il centrocampista.
    # Qui si elencano a mano, una riga per partita.
    exceptions = {}
    for item in raw.get("eccezioni_partita") or []:
        try:
            mid = str(item["match_id"]); who = item["giocatore"]; grp = item["gruppo"]
        except (KeyError, TypeError):
            print(f"  attenzione: eccezione malformata in {path.name}, ignorata: {item!r}")
            continue
        if grp not in valid:
            print(f"  attenzione: gruppo non valido nell'eccezione {who}@{mid}, ignorata: {grp}")
            continue
        exceptions[f"{mid}|{who}"] = grp
    cfg["exceptions"] = exceptions
    if exceptions:
        print(f"  eccezioni di ruolo per partita caricate: {len(exceptions)}")

    # Prestazioni da non conteggiare affatto. Diverse dalle eccezioni: quelle correggono il
    # reparto, queste dicono che la riga non appartiene alla persona (CPU al controllo dopo
    # una disconnessione, tipicamente). La riga viene tolta dai dati prima che finiscano
    # nella pagina, quindi non serve pubblicare la lista.
    esclusioni = set()
    for item in raw.get("esclusioni_partita") or []:
        try:
            mid = str(item["match_id"]); who = item["giocatore"]
        except (KeyError, TypeError):
            print(f"  attenzione: esclusione malformata in {path.name}, ignorata: {item!r}")
            continue
        esclusioni.add(f"{mid}|{who}")
    cfg["excludedRows"] = sorted(esclusioni)

    # Il voto sentinella si legge da qui invece di essere scritto nel codice: se un domani
    # EA cambiasse il valore, o se si volesse spegnere la regola, basta questo file.
    # Assente o nullo = nessun filtro automatico, che e' il ripiego prudente: meglio
    # pubblicare una riga in piu' che nasconderne una vera senza accorgersene.
    voto = raw.get("voto_sentinella")
    try:
        cfg["sentinelRating"] = float(voto) if voto is not None else None
    except (TypeError, ValueError):
        print(f"  attenzione: voto_sentinella non numerico in {path.name}, ignorato: {voto!r}")
        cfg["sentinelRating"] = None
    return cfg


def elenco_serate(matches):
    """Le partite raggruppate in serate di gioco, dalla più recente.

    Il raggruppamento sta qui e non nel JavaScript perché la regola dello stacco - oltre
    tre ore di pausa comincia un'altra serata - è la stessa che usano serata.py e la
    marcatura delle serate da confermare. Averla in due posti significa vederla cambiare
    in uno solo. La pagina riceve solo gli elenchi di match_id e ricostruisce il resto
    con i dati che ha già.
    """
    try:
        import ruoli as _r
        from datetime import datetime, timedelta
        quando = {}
        for m in matches:
            if not m.get("played_at"):
                continue
            quando[_r.ora_italiana(m["played_at"])] = (m["match_id"], m["played_at"])
        gruppi = _r.serate(sorted(quando))
        cfg = _r.carica()
        out = []
        for g in gruppi:
            chiave = _r.chiave_serata(quando[g[0]][1])
            out.append({
                "chiave": chiave,
                "giorno": f"{g[0]:%d/%m}",
                "giornoFine": f"{g[-1]:%d/%m}",
                "inizio": f"{g[0]:%H:%M}",
                "fine": f"{g[-1]:%H:%M}",
                "daConfermare": _r.da_chiedere(cfg, chiave, len(g)),
                "matchIds": [quando[t][0] for t in g],
            })
        # La prima serata dell'archivio quasi certamente non e' intera: le partite
        # precedenti non sono mai state catturate, perche' EA ne espone solo dieci alla
        # volta e l'archivio e' cominciato a raccolta gia' avviata. Dichiararlo evita di
        # far passare un frammento per una sessione completa.
        if out:
            out[0]["inizioIncerto"] = True
        out.reverse()
        return out
    except Exception as exc:  # noqa: BLE001 - una sezione in meno, non una pagina rotta
        print(f"  attenzione: elenco serate non costruito ({exc.__class__.__name__}: {exc})")
        return []


def serate_da_confermare(matches):
    """Le serate di gioco per cui nessuno ha ancora confermato i ruoli.

    Le partite giocate fuori ruolo non lasciano traccia nei dati (verificato il
    22/08/2026: tiri, contrasti e passaggi coincidono con quelli delle partite normali),
    quindi la classificazione di una serata resta un'ipotesi finche' qualcuno non la
    conferma. Segnalarlo sulla pagina evita che l'ipotesi si travesta da certezza:
    se una mattina nessuno risponde, i numeri restano visibilmente provvisori.
    """
    try:
        import ruoli as _r
        from datetime import datetime, timedelta
        # da_chiedere() tratta insieme le serate verificate e quelle chiuse senza verifica
        # - su entrambe non c'e' piu' niente da chiedere - ma riapre quelle cresciute dopo
        # la chiusura, perche' EA pubblica in ritardo e le partite arrivate dopo non le ha
        # guardate nessuno.
        cfg = _r.carica()
        coppie = sorted((_r.ora_italiana(m["played_at"]), m["played_at"])
                        for m in matches if m.get("played_at"))
        utc_di = dict(coppie)
        quando = [c[0] for c in coppie]
        aperte = []
        for gruppo in _r.serate(quando):
            if not _r.da_chiedere(cfg, _r.chiave_serata(utc_di[gruppo[0]]), len(gruppo)):
                continue
            aperte.append({"giorno": f"{gruppo[0]:%d/%m %H:%M}", "partite": len(gruppo)})
        return aperte
    except Exception as exc:  # noqa: BLE001 - un avviso mancante non deve fermare la pagina
        print(f"  attenzione: serate non calcolate ({exc.__class__.__name__})")
        return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="lentoni.db")
    ap.add_argument("--out", default="dashboard.html")
    args = ap.parse_args()

    club = carica_club()
    ruoli = load_role_groups()
    data = build_data(args.db, club_id=club["club_id"],
                      esclusi=ruoli.get("exPlayers"),
                      righe_escluse=ruoli.get("excludedRows"),
                      voto_sentinella=ruoli.get("sentinelRating"))
    # Le liste di esclusione hanno gia' fatto il loro lavoro qui sopra: non vengono
    # pubblicate nella pagina, cosi' chi ha lasciato il club non compare da nessuna
    # parte nel file, nemmeno tra i dati grezzi, e le righe non valide sono gia' sparite.
    data["roleGroups"] = {k: v for k, v in ruoli.items()
                          if k not in ("exPlayers", "excludedRows", "sentinelRating")}
    data["serateAperte"] = serate_da_confermare(data["matches"])
    data["serate"] = elenco_serate(data["matches"])
    data["titolo"] = club.get("titolo") or ""
    club_name = (data["club"].get("name") or "Club").title()
    # La piattaforma viene da club.json, non da raw/club_search.json. Quel file e' una
    # fotografia presa a mano del club di FC 26: al passaggio a un titolo nuovo avrebbe
    # continuato a dichiarare la piattaforma di quello vecchio, contraddicendo la regola
    # per cui club.json e' l'unico file da toccare. La piattaforma la conosciamo gia': e'
    # il parametro che passiamo a ogni chiamata.
    platform = etichetta_piattaforma(club.get("piattaforma")
                                     or data["club"].get("platform"))
    division = data["latest"].get("best_division") or "-"
    updated_at = data["history"][-1]["fetched_at"] if data["history"] else "-"

    html = (
        HTML_TEMPLATE
        .replace("__CLUB_NAME__", club_name)
        .replace("__PLATFORM__", str(platform))
        .replace("__DIVISION__", str(division))
        .replace("__UPDATED_AT__", str(updated_at))
        .replace("__MIN_GAMES__", str(MIN_GAMES))
        .replace("__DATA_JSON__", json.dumps(data, ensure_ascii=False))
    )

    Path(args.out).write_text(html, encoding="utf-8")
    print(f"Dashboard generata: {args.out}")
    print(f"  club: {club_name} ({club['club_id']}, {club.get('titolo') or 'titolo non indicato'}) | snapshot storico: {len(data['history'])} | roster: {len(data['roster'])} | partite: {len(data['matches'])}")

    sa = data.get("saluteArchivio") or {}
    if sa.get("attese") is not None:
        print(f"  salute archivio: {sa['archiviateDaPrimoSnapshot']}/{sa['attese']} partite archiviate "
              f"dal {sa['daQuando'][:10]} (divario storico {sa['divario']})")
        if sa.get("divarioRecente"):
            print(f"  ATTENZIONE: {sa['divarioRecente']} partite delle ultime 48 ore non sono in archivio. "
                  f"Se il numero non scende entro il prossimo giro, sono andate perse.")


if __name__ == "__main__":
    main()
