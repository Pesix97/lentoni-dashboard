#!/usr/bin/env python3
"""
ingest.py — Popola/aggiorna il database SQLite del club a partire dai
JSON grezzi scaricati dalle API pubbliche (non ufficiali) di EA
(proclubs.ea.com/api/fc/...).

Uso:
    python ingest.py --raw-dir raw --db lentoni.db

Non fa alcuna chiamata di rete: si limita a leggere i file JSON già
scaricati in raw/ e a scrivere/aggiornare il database SQLite.
I file attesi in raw/ sono:
    club_search.json      -> risposta di allTimeLeaderboard/search
    overall_stats.json    -> risposta di clubs/overallStats
    club_info.json         -> risposta di clubs/info (crest/kit)
    members_stats.json    -> risposta di members/stats
    matches_league.json   -> risposta di clubs/matches (matchType=leagueMatch)
    matches_playoff.json  -> risposta di clubs/matches (matchType=playoffMatch)
    matches_friendly.json -> risposta di clubs/matches (matchType=friendlyMatch)

Ogni tabella conserva sia colonne strutturate (per le query comuni) sia
una colonna raw_json con il record sorgente completo e non modificato,
cosi' nessun campo restituito da EA viene mai perso anche se non e'
stato esplicitamente mappato in una colonna.
"""
import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from potatura import pota

SCHEMA = """
CREATE TABLE IF NOT EXISTS club_info (
    club_id         INTEGER PRIMARY KEY,
    name            TEXT,
    platform        TEXT,
    region_id       INTEGER,
    team_id         INTEGER,
    crest_asset_id  TEXT,
    crest_color     TEXT,
    kit_color1      TEXT,
    kit_color2      TEXT,
    kit_color3      TEXT,
    kit_color4      TEXT,
    stad_name       TEXT,
    raw_json        TEXT
);

CREATE TABLE IF NOT EXISTS club_stats_history (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    club_id                 INTEGER NOT NULL,
    fetched_at              TEXT NOT NULL,
    wins                    INTEGER,
    losses                  INTEGER,
    ties                    INTEGER,
    games_played            INTEGER,
    games_played_playoff    INTEGER,
    goals                   INTEGER,
    goals_against           INTEGER,
    skill_rating            INTEGER,
    promotions              INTEGER,
    relegations             INTEGER,
    best_division           INTEGER,
    best_finish_group       INTEGER,
    wstreak                 INTEGER,
    unbeatenstreak          INTEGER,
    reputationtier          INTEGER,
    league_appearances      INTEGER,
    finishes_div1_group1    INTEGER,
    finishes_div2_group1    INTEGER,
    finishes_div3_group1    INTEGER,
    finishes_div4_group1    INTEGER,
    finishes_div5_group1    INTEGER,
    finishes_div6_group1    INTEGER,
    last_matches_compact    TEXT,
    raw_json                TEXT
);

CREATE TABLE IF NOT EXISTS member_stats_history (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    club_id             INTEGER NOT NULL,
    fetched_at          TEXT NOT NULL,
    player_name         TEXT,
    pro_name            TEXT,
    favorite_position   TEXT,
    pro_pos             TEXT,
    pro_style           TEXT,
    pro_height          INTEGER,
    pro_nationality     INTEGER,
    games_played        INTEGER,
    win_rate            INTEGER,
    goals               INTEGER,
    assists             INTEGER,
    rating_ave          REAL,
    pass_success_rate   INTEGER,
    tackle_success_rate INTEGER,
    shot_success_rate   INTEGER,
    passes_made         INTEGER,
    tackles_made        INTEGER,
    man_of_the_match    INTEGER,
    red_cards           INTEGER,
    clean_sheets_def    INTEGER,
    clean_sheets_gk     INTEGER,
    pro_overall         INTEGER,
    prev_goals_trend    TEXT,
    raw_json            TEXT
);

CREATE TABLE IF NOT EXISTS matches (
    match_id            TEXT NOT NULL,
    club_id             INTEGER NOT NULL,
    match_type          TEXT NOT NULL,
    ts                  INTEGER,
    played_at           TEXT,
    opponent_club_id    INTEGER,
    opponent_name       TEXT,
    goals_for           INTEGER,
    goals_against       INTEGER,
    result_code         TEXT,
    win                 INTEGER,
    loss                INTEGER,
    tie                 INTEGER,
    raw_json            TEXT,
    PRIMARY KEY (match_id, club_id)
);

CREATE TABLE IF NOT EXISTS match_player_stats (
    match_id        TEXT NOT NULL,
    club_id         INTEGER NOT NULL,
    ea_player_id    TEXT NOT NULL,
    player_name     TEXT,
    pos             TEXT,
    archetype_id    TEXT,
    goals           INTEGER,
    assists         INTEGER,
    rating          REAL,
    shots           INTEGER,
    passes_made     INTEGER,
    pass_attempts   INTEGER,
    tackles_made    INTEGER,
    tackle_attempts INTEGER,
    saves           INTEGER,
    cleansheetsgk   INTEGER,
    cleansheetsdef  INTEGER,
    -- Gol subiti dalla squadra mentre il giocatore era in campo. E' la sola metrica
    -- difensiva che EA valorizzi davvero: i tre campi cleansheets* arrivano SEMPRE a zero
    -- (verificato il 29/08/2026 sul grezzo, 1 prestazione su 671), mentre questo ha valori
    -- veri da 0 a 8. Aggiunto per avere lo storico pronto al passaggio a FC 27, quando i
    -- ruoli saranno stabili dal primo giorno e la difesa si potra' finalmente valutare.
    goals_conceded  INTEGER,
    red_cards       INTEGER,
    mom             INTEGER,
    seconds_played  INTEGER,
    raw_json        TEXT,
    PRIMARY KEY (match_id, club_id, ea_player_id)
);
"""


# Giocatori che sono in realta' la stessa persona ma compaiono con piu'
# gamertag/account EA diversi. Chiave = nome grezzo (minuscolo) come appare
# nei dati EA, valore = nome canonico sotto cui unificare tutte le statistiche.
# Aggiungere qui altre coppie se emergono altri casi simili.
NAME_ALIASES = {
    "pinosix97": "Pesix_97",
}
# REGOLA DEL CLUB, per quando servira': se un giocatore ricompare con un gamertag nuovo ma
# lo stesso id EA, la sua identita' resta quella di prima e si aggiunge qui la coppia
# "nome nuovo (minuscolo)" -> "nome canonico". Vale in particolare per domenico: comunque
# si chiami, e' sempre domenico.
#
# ATTENZIONE quando `generate_dashboard.py` segnala "l'id EA ... compare con piu' nomi"
# durante `test_pipeline.py`: quel messaggio arriva da un test che FABBRICA un cambio di
# nome finto (aggiunge "_nuovo" alla prima riga del database, su una copia) proprio per
# verificare che la guardia lo veda. Non e' un cambio di nome vero. Prima di aggiungere un
# alias, controllare che il nome esista davvero nel database.


def canonical_name(raw_name):
    if not raw_name:
        return raw_name
    return NAME_ALIASES.get(raw_name.lower(), raw_name)


def _weighted_rate(parts):
    """parts: lista di (made, rate_percent). Stima i tentativi da made/rate,
    li somma, e ricalcola il rate combinato. Fallback: rate massimo tra le parti."""
    total_made = 0
    total_attempts = 0.0
    for made, rate in parts:
        total_made += made
        if rate > 0:
            total_attempts += made / (rate / 100.0)
    if total_attempts > 0:
        return round(total_made / total_attempts * 100)
    return max((rate for _, rate in parts), default=0)


def merge_member_group(canon_name, members):
    """Unisce piu' voci grezze (stesso giocatore reale, alias diversi) in
    un'unica voce con statistiche sommate/ricalcolate. Se il gruppo ha una
    sola voce, la restituisce cosi' com'e' (solo rinominata)."""
    if len(members) == 1:
        merged = dict(members[0])
        merged["name"] = canon_name
        return merged

    def gi(m, k):
        return as_int(m.get(k))

    def gf(m, k):
        return as_float(m.get(k))

    total_gp = sum(gi(m, "gamesPlayed") for m in members)
    total_goals = sum(gi(m, "goals") for m in members)
    total_assists = sum(gi(m, "assists") for m in members)
    total_csd = sum(gi(m, "cleanSheetsDef") for m in members)
    total_csgk = sum(gi(m, "cleanSheetsGK") for m in members)
    total_passes = sum(gi(m, "passesMade") for m in members)
    total_tackles = sum(gi(m, "tacklesMade") for m in members)
    total_mom = sum(gi(m, "manOfTheMatch") for m in members)
    total_red = sum(gi(m, "redCards") for m in members)

    rating_ave = (
        sum(gf(m, "ratingAve") * gi(m, "gamesPlayed") for m in members) / total_gp
        if total_gp else 0.0
    )
    win_rate = round(
        sum(gi(m, "winRate") * gi(m, "gamesPlayed") for m in members) / total_gp
    ) if total_gp else 0

    pass_success = _weighted_rate([(gi(m, "passesMade"), gi(m, "passSuccessRate")) for m in members])
    tackle_success = _weighted_rate([(gi(m, "tacklesMade"), gi(m, "tackleSuccessRate")) for m in members])
    shot_success = _weighted_rate([(gi(m, "goals"), gi(m, "shotSuccessRate")) for m in members])

    # Il profilo "pro" (posizione, altezza, nazionalita', overall, trend recente...)
    # viene preso dalla voce con piu' partite giocate, cioe' l'identita' principale.
    primary = max(members, key=lambda m: gi(m, "gamesPlayed"))
    merged = dict(primary)

    merged["name"] = canon_name
    merged["gamesPlayed"] = str(total_gp)
    merged["goals"] = str(total_goals)
    merged["assists"] = str(total_assists)
    merged["cleanSheetsDef"] = str(total_csd)
    merged["cleanSheetsGK"] = str(total_csgk)
    merged["passesMade"] = str(total_passes)
    merged["tacklesMade"] = str(total_tackles)
    merged["manOfTheMatch"] = str(total_mom)
    merged["redCards"] = str(total_red)
    merged["ratingAve"] = f"{rating_ave:.2f}"
    merged["winRate"] = str(win_rate)
    merged["passSuccessRate"] = str(pass_success)
    merged["tackleSuccessRate"] = str(tackle_success)
    merged["shotSuccessRate"] = str(shot_success)
    merged["_mergedFrom"] = [m.get("name") for m in members]
    return merged


def load_json(path: Path):
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return None
    return json.loads(text)


def as_int(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def as_float(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def ingest_club_info(cur, club_search, club_info_resp):
    club_id = None
    name = platform = None
    region_id = team_id = None
    crest_asset_id = crest_color = None
    kit_colors = [None, None, None, None]
    stad_name = None

    if club_search:
        entry = club_search[0]
        info = entry.get("clubInfo", {})
        club_id = as_int(info.get("clubId", entry.get("clubId")), None)
        name = info.get("name")
        platform = entry.get("platform")
        region_id = info.get("regionId")
        team_id = info.get("teamId")
        kit = info.get("customKit", {})
        crest_asset_id = kit.get("crestAssetId")
        crest_color = kit.get("crestColor")
        kit_colors = [kit.get(f"kitColor{i}") for i in range(1, 5)]
        stad_name = kit.get("stadName")

    # club_info.json (clubs/info) puo' avere dati piu' freschi/completi sul kit
    if club_info_resp:
        # la risposta e' un dict {clubId: {...}}
        entry = None
        if isinstance(club_info_resp, dict):
            entry = next(iter(club_info_resp.values()), None)
        if entry:
            club_id = club_id or as_int(entry.get("clubId"), None)
            name = name or entry.get("name")
            region_id = region_id or entry.get("regionId")
            team_id = team_id or entry.get("teamId")
            kit = entry.get("customKit", {})
            crest_asset_id = crest_asset_id or kit.get("crestAssetId")
            crest_color = crest_color or kit.get("crestColor")
            if not any(kit_colors):
                kit_colors = [kit.get(f"kitColor{i}") for i in range(1, 5)]
            stad_name = stad_name or kit.get("stadName")

    if club_id is None:
        return None

    raw_combined = json.dumps({"club_search": club_search, "club_info": club_info_resp}, ensure_ascii=False)

    # EA restituisce alcuni campi che cambiano ad ogni chiamata pur non significando
    # nulla: "teamId" e "customKit.kitId" oscillano (visti passare da 1343 a 52 tra due
    # richieste consecutive a distanza di minuti). Riscrivere la riga per colpa loro
    # sporcherebbe il database ad ogni esecuzione, e su GitHub Actions equivarrebbe a un
    # commit ogni due ore anche senza aver giocato. Confrontiamo quindi ignorandoli.
    def _senza_volatili(testo):
        try:
            dati = json.loads(testo)
        except (TypeError, ValueError):
            return testo
        def pulisci(nodo):
            if isinstance(nodo, dict):
                return {k: pulisci(v) for k, v in nodo.items() if k not in ("teamId", "kitId")}
            if isinstance(nodo, list):
                return [pulisci(v) for v in nodo]
            return nodo
        return json.dumps(pulisci(dati), sort_keys=True, ensure_ascii=False)

    esistente = cur.execute(
        "SELECT raw_json FROM club_info WHERE club_id = ?", (club_id,)
    ).fetchone()
    if esistente and esistente[0] is not None:
        if _senza_volatili(esistente[0]) == _senza_volatili(raw_combined):
            return club_id

    cur.execute(
        """INSERT INTO club_info
           (club_id, name, platform, region_id, team_id, crest_asset_id,
            crest_color, kit_color1, kit_color2, kit_color3, kit_color4,
            stad_name, raw_json)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(club_id) DO UPDATE SET
             name=excluded.name, platform=excluded.platform,
             region_id=excluded.region_id, team_id=excluded.team_id,
             crest_asset_id=excluded.crest_asset_id, crest_color=excluded.crest_color,
             kit_color1=excluded.kit_color1, kit_color2=excluded.kit_color2,
             kit_color3=excluded.kit_color3, kit_color4=excluded.kit_color4,
             stad_name=excluded.stad_name, raw_json=excluded.raw_json""",
        (
            club_id, name, platform, region_id, team_id, crest_asset_id,
            crest_color, *kit_colors, stad_name, raw_combined,
        ),
    )
    return club_id


def ingest_overall_stats(cur, overall_stats, club_id, fetched_at):
    if not overall_stats:
        return
    s = overall_stats[0]

    last_matches_compact = json.dumps({
        "results": [s.get(f"lastMatch{i}") for i in range(10)],
        "opponents": [s.get(f"lastOpponent{i}") for i in range(10)],
    })

    # Uno snapshot ha senso solo se qualcosa e' cambiato. Girando ogni due ore, la
    # maggior parte delle esecuzioni trova dati identici ai precedenti: salvarli
    # comunque gonfierebbe il database (e i commit del repository) e riempirebbe i
    # grafici dell'andamento di punti sovrapposti. Verificato che EA restituisce
    # payload identici byte per byte quando non si gioca.
    payload = json.dumps(s, ensure_ascii=False)
    ultimo = cur.execute(
        "SELECT raw_json FROM club_stats_history WHERE club_id = ? ORDER BY id DESC LIMIT 1",
        (club_id,),
    ).fetchone()
    if ultimo and ultimo[0] == payload:
        return False

    # Il contatore di carriera di EA puo' solo salire: le partite giocate non si scordano.
    # Uno scatto con un valore piu' basso del precedente non e' un dato, e' un dato vecchio -
    # e accettarlo rovina la misura della salute archivio, che confronta il primo e l'ultimo
    # scatto per sapere quante partite sono state giocate.
    #
    # Successo davvero il 29/08/2026: un ingest lanciato a mano con i file in raw/ ormai
    # vecchi ha inserito uno scatto con 646 partite quando l'archivio era gia' a 728, e la
    # salute e' passata da "98 su 133" a "98 su 51". Nessun errore, nessun avviso: solo un
    # numero diventato falso. Sul runner puo' capitare lo stesso se la fonte restituisce una
    # risposta arretrata dalla sua cache.
    giocate = as_int(s.get("gamesPlayed"), None)
    if giocate is not None:
        precedente = cur.execute(
            "SELECT MAX(games_played) FROM club_stats_history WHERE club_id = ?", (club_id,)
        ).fetchone()[0]
        if precedente is not None and giocate < precedente:
            print(f"Scatto ignorato: EA dice {giocate} partite ma ne avevamo gia' viste "
                  f"{precedente}. Risposta arretrata, non un dato nuovo.")
            return False

    cur.execute(
        """INSERT INTO club_stats_history
           (club_id, fetched_at, wins, losses, ties, games_played,
            games_played_playoff, goals, goals_against, skill_rating,
            promotions, relegations, best_division, best_finish_group,
            wstreak, unbeatenstreak, reputationtier, league_appearances,
            finishes_div1_group1, finishes_div2_group1, finishes_div3_group1,
            finishes_div4_group1, finishes_div5_group1, finishes_div6_group1,
            last_matches_compact, raw_json)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            club_id,
            fetched_at,
            as_int(s.get("wins")),
            as_int(s.get("losses")),
            as_int(s.get("ties")),
            as_int(s.get("gamesPlayed")),
            as_int(s.get("gamesPlayedPlayoff")),
            as_int(s.get("goals")),
            as_int(s.get("goalsAgainst")),
            as_int(s.get("skillRating")),
            as_int(s.get("promotions")),
            as_int(s.get("relegations")),
            as_int(s.get("bestDivision")),
            as_int(s.get("bestFinishGroup")),
            as_int(s.get("wstreak")),
            as_int(s.get("unbeatenstreak")),
            as_int(s.get("reputationtier")),
            as_int(s.get("leagueAppearances")),
            as_int(s.get("finishesInDivision1Group1")),
            as_int(s.get("finishesInDivision2Group1")),
            as_int(s.get("finishesInDivision3Group1")),
            as_int(s.get("finishesInDivision4Group1")),
            as_int(s.get("finishesInDivision5Group1")),
            as_int(s.get("finishesInDivision6Group1")),
            last_matches_compact,
            payload,
        ),
    )
    return True


def ingest_member_stats(cur, members_stats, club_id, fetched_at):
    if not members_stats:
        return

    # Raggruppa per nome canonico (applica NAME_ALIASES) cosi' i giocatori
    # con piu' account/gamertag vengono uniti in un'unica riga con statistiche
    # sommate, invece di comparire come membri separati.
    groups = {}
    for m in members_stats.get("members", []):
        canon = canonical_name(m.get("name"))
        groups.setdefault(canon, []).append(m)

    merged_members = [merge_member_group(canon, group) for canon, group in groups.items()]

    # Come per lo snapshot del club: se la fotografia della rosa e' identica a quella
    # gia' salvata, non ha senso duplicarla. Il confronto e' sull'insieme completo dei
    # payload, cosi' basta che cambi un solo giocatore perche' venga registrata tutta.
    validi = [m for m in merged_members
              if not (m.get("gamesPlayed", "0") in ("0", 0) and not m.get("name"))]
    firma_nuova = sorted(json.dumps(m, ensure_ascii=False) for m in validi)
    ultimo_fetch = cur.execute(
        "SELECT MAX(fetched_at) FROM member_stats_history WHERE club_id = ?", (club_id,)
    ).fetchone()[0]
    if ultimo_fetch:
        precedenti = [r[0] for r in cur.execute(
            "SELECT raw_json FROM member_stats_history WHERE club_id = ? AND fetched_at = ?",
            (club_id, ultimo_fetch),
        )]
        if all(p is not None for p in precedenti) and sorted(precedenti) == firma_nuova:
            return False

    for m in merged_members:
        if m.get("gamesPlayed", "0") in ("0", 0) and not m.get("name"):
            continue

        prev_goals_trend = json.dumps(
            [as_int(m.get("prevGoals"))] + [as_int(m.get(f"prevGoals{i}")) for i in range(1, 11)]
        )

        cur.execute(
            """INSERT INTO member_stats_history
               (club_id, fetched_at, player_name, pro_name, favorite_position,
                pro_pos, pro_style, pro_height, pro_nationality,
                games_played, win_rate, goals, assists, rating_ave,
                pass_success_rate, tackle_success_rate, shot_success_rate,
                passes_made, tackles_made,
                man_of_the_match, red_cards, clean_sheets_def, clean_sheets_gk,
                pro_overall, prev_goals_trend, raw_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                club_id,
                fetched_at,
                m.get("name"),
                m.get("proName"),
                m.get("favoritePosition"),
                m.get("proPos"),
                m.get("proStyle"),
                as_int(m.get("proHeight"), None),
                as_int(m.get("proNationality"), None),
                as_int(m.get("gamesPlayed")),
                as_int(m.get("winRate")),
                as_int(m.get("goals")),
                as_int(m.get("assists")),
                as_float(m.get("ratingAve")),
                as_int(m.get("passSuccessRate")),
                as_int(m.get("tackleSuccessRate")),
                as_int(m.get("shotSuccessRate")),
                as_int(m.get("passesMade")),
                as_int(m.get("tacklesMade")),
                as_int(m.get("manOfTheMatch")),
                as_int(m.get("redCards")),
                as_int(m.get("cleanSheetsDef")),
                as_int(m.get("cleanSheetsGK")),
                as_int(m.get("proOverall")),
                prev_goals_trend,
                json.dumps(m, ensure_ascii=False),
            ),
        )

    return True


def ingest_matches(cur, matches, club_id, match_type):
    if not matches:
        return 0
    inserted = 0
    for match in matches:
        match_id = str(match.get("matchId"))
        ts = match.get("timestamp")
        played_at = (
            datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
            if ts
            else None
        )
        clubs = match.get("clubs", {})
        own = clubs.get(str(club_id))
        if own is None:
            continue
        opp_id = next((cid for cid in clubs if cid != str(club_id)), None)
        opp = clubs.get(opp_id, {}) if opp_id else {}
        opp_details = opp.get("details", {})

        cur.execute(
            """INSERT OR IGNORE INTO matches
               (match_id, club_id, match_type, ts, played_at,
                opponent_club_id, opponent_name, goals_for, goals_against,
                result_code, win, loss, tie, raw_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                match_id,
                club_id,
                match_type,
                ts,
                played_at,
                as_int(opp_id, None) if opp_id else None,
                opp_details.get("name"),
                as_int(own.get("goals")),
                as_int(own.get("goalsAgainst")),
                own.get("result"),
                as_int(own.get("wins")),
                as_int(own.get("losses")),
                as_int(own.get("ties")),
                json.dumps(match, ensure_ascii=False),
            ),
        )
        if cur.rowcount:
            inserted += 1

        players = match.get("players", {}).get(str(club_id), {})
        for ea_id, p in players.items():
            # Guardia anti-duplicati. La chiave primaria e' (match_id, club_id, ea_player_id):
            # due id diversi che puntano alla stessa persona reale sfuggono al vincolo e la
            # fanno contare due volte in ogni statistica calcolata dalle partite. Succede con le
            # righe 'recovered_*' della ricostruzione manuale del 06/08/2026 e potrebbe succedere
            # con due account EA uniti da NAME_ALIASES. Teniamo una riga sola per giocatore per
            # partita, preferendo sempre l'id EA reale a quello sintetico.
            player_name_canon = canonical_name(p.get("playername"))
            cur.execute(
                "SELECT ea_player_id FROM match_player_stats "
                "WHERE match_id = ? AND club_id = ? AND player_name = ?",
                (match_id, club_id, player_name_canon),
            )
            existing_ids = [row[0] for row in cur.fetchall() if row[0] != ea_id]
            if existing_ids:
                if any(not eid.startswith("recovered_") for eid in existing_ids):
                    # C'e' gia' una riga con un id EA reale: questa sarebbe un doppione.
                    continue
                # Le uniche righe presenti sono ricostruite a mano: le sostituiamo con il dato vero.
                cur.execute(
                    "DELETE FROM match_player_stats "
                    "WHERE match_id = ? AND club_id = ? AND player_name = ? "
                    "AND ea_player_id LIKE 'recovered_%'",
                    (match_id, club_id, player_name_canon),
                )
            cur.execute(
                """INSERT OR IGNORE INTO match_player_stats
                   (match_id, club_id, ea_player_id, player_name, pos,
                    archetype_id, goals, assists, rating, shots, passes_made,
                    pass_attempts, tackles_made, tackle_attempts, saves,
                    cleansheetsgk, cleansheetsdef, goals_conceded, red_cards, mom,
                    seconds_played, raw_json)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    match_id,
                    club_id,
                    ea_id,
                    player_name_canon,
                    p.get("pos"),
                    p.get("archetypeid"),
                    as_int(p.get("goals")),
                    as_int(p.get("assists")),
                    as_float(p.get("rating")),
                    as_int(p.get("shots")),
                    as_int(p.get("passesmade")),
                    as_int(p.get("passattempts")),
                    as_int(p.get("tacklesmade")),
                    as_int(p.get("tackleattempts")),
                    as_int(p.get("saves")),
                    as_int(p.get("cleansheetsgk")),
                    as_int(p.get("cleansheetsdef")),
                    as_int(p.get("goalsconceded")),
                    as_int(p.get("redcards")),
                    as_int(p.get("mom")),
                    as_int(p.get("secondsPlayed")),
                    json.dumps(p, ensure_ascii=False),
                ),
            )
    return inserted


# Colonne aggiunte dopo che il database esisteva gia'. Lo SCHEMA qui sopra usa
# CREATE TABLE IF NOT EXISTS, quindi su un archivio gia' creato non verrebbe applicato: una
# colonna nuova resterebbe assente per sempre e l'INSERT fallirebbe ad ogni giro.
#
# Ogni voce e' (tabella, colonna, tipo). Aggiungerne una qui e' tutto quello che serve.
MIGRAZIONI = [
    ("match_player_stats", "goals_conceded", "INTEGER"),
]


def migra(cur):
    """Aggiunge le colonne mancanti a un database gia' esistente."""
    aggiunte = []
    for tabella, colonna, tipo in MIGRAZIONI:
        esistenti = {r[1] for r in cur.execute(f"PRAGMA table_info({tabella})")}
        if not esistenti:
            continue  # tabella non ancora creata: ci pensa lo SCHEMA
        if colonna not in esistenti:
            cur.execute(f"ALTER TABLE {tabella} ADD COLUMN {colonna} {tipo}")
            aggiunte.append(f"{tabella}.{colonna}")
    if aggiunte:
        print(f"Colonne aggiunte al database esistente: {', '.join(aggiunte)}")
    return aggiunte


def recupera_dal_grezzo(cur, colonna, chiave_ea):
    """Riempie una colonna nuova usando il grezzo delle prestazioni che ce l'hanno ancora.

    Le righe gia' in archivio non vengono riscritte dall'ingest (INSERT OR IGNORE), quindi
    una colonna aggiunta oggi resterebbe vuota su tutto lo storico. Il grezzo pero' e'
    ancora li' per le partite recenti - `potatura.py` lo conserva per le ultime quindici -
    e da li' il dato si recupera senza chiamare EA.

    Non e' un rimedio completo per definizione: piu' vecchia e' la partita, meno probabile
    e' che il suo grezzo esista ancora. Serve a non partire da zero.
    """
    righe = cur.execute(
        f"SELECT match_id, club_id, ea_player_id, raw_json FROM match_player_stats "
        f"WHERE {colonna} IS NULL AND raw_json IS NOT NULL"
    ).fetchall()
    recuperate = 0
    for match_id, club_id, ea_id, grezzo in righe:
        try:
            valore = as_int(json.loads(grezzo).get(chiave_ea))
        except Exception:
            continue
        cur.execute(
            f"UPDATE match_player_stats SET {colonna} = ? "
            f"WHERE match_id = ? AND club_id = ? AND ea_player_id = ?",
            (valore, match_id, club_id, ea_id),
        )
        recuperate += 1
    if recuperate:
        print(f"Recuperate dal grezzo: {recuperate} prestazioni con {colonna}")
    return recuperate


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-dir", default="raw")
    ap.add_argument("--db", default="lentoni.db")
    args = ap.parse_args()

    raw_dir = Path(args.raw_dir)
    fetched_at = datetime.now(timezone.utc).isoformat()

    con = sqlite3.connect(args.db)
    cur = con.cursor()
    cur.executescript(SCHEMA)
    if "match_player_stats.goals_conceded" in migra(cur):
        recupera_dal_grezzo(cur, "goals_conceded", "goalsconceded")

    club_search = load_json(raw_dir / "club_search.json")
    club_info_resp = load_json(raw_dir / "club_info.json")
    club_id = ingest_club_info(cur, club_search, club_info_resp)
    if club_id is None:
        overall = load_json(raw_dir / "overall_stats.json")
        if overall:
            club_id = as_int(overall[0].get("clubId"), None)
    if club_id is None:
        raise SystemExit("Impossibile determinare club_id: manca club_search.json o overall_stats.json")

    overall_stats = load_json(raw_dir / "overall_stats.json")
    nuovo_club = ingest_overall_stats(cur, overall_stats, club_id, fetched_at)

    members_stats = load_json(raw_dir / "members_stats.json")
    nuovi_membri = ingest_member_stats(cur, members_stats, club_id, fetched_at)

    total_new_matches = 0
    for match_type, fname in [
        ("leagueMatch", "matches_league.json"),
        ("playoffMatch", "matches_playoff.json"),
        ("friendlyMatch", "matches_friendly.json"),
    ]:
        matches = load_json(raw_dir / fname)
        total_new_matches += ingest_matches(cur, matches, club_id, match_type)

    con.commit()

    # La potatura del grezzo, subito dopo la scrittura. Sta qui e non in giro.sh perche'
    # deve valere per QUALSIASI modo di alimentare il database, anche a mano: se dipendesse
    # dallo script del ciclo, un ingest lanciato a parte rigonfierebbe il file in silenzio.
    # Vedi potatura.py: era il 77% del database, e nessuno lo leggeva.
    liberati = pota(con)
    if liberati:
        print(f"Grezzo potato: {sum(liberati.values()) / 1024:.0f} KB liberati")

    n_club_snap = cur.execute("SELECT COUNT(*) FROM club_stats_history WHERE club_id=?", (club_id,)).fetchone()[0]
    n_member_snap = cur.execute("SELECT COUNT(*) FROM member_stats_history WHERE club_id=?", (club_id,)).fetchone()[0]
    n_matches = cur.execute("SELECT COUNT(*) FROM matches WHERE club_id=?", (club_id,)).fetchone()[0]
    con.close()

    print(f"Club ID: {club_id}")
    print(f"Snapshot club: {'nuovo salvato' if nuovo_club else 'invariato, non salvato'}")
    print(f"Snapshot membri: {'nuovo salvato' if nuovi_membri else 'invariato, non salvato'}")
    print(f"Snapshot club salvati finora: {n_club_snap}")
    print(f"Snapshot membri salvati finora: {n_member_snap}")
    print(f"Nuove partite inserite in questa run: {total_new_matches}")
    print(f"Totale partite nel DB: {n_matches}")


if __name__ == "__main__":
    main()
