#!/usr/bin/env python3
"""Test della pipeline: le verifiche che finora rifacevo a mano ogni volta.

Ognuno di questi test nasce da un problema vero incontrato durante lo sviluppo, non da
un esercizio di stile. Il commento sopra ciascuno dice quale.

Si eseguono con:  python3 -m unittest test_pipeline -v
Nessuna dipendenza esterna: girano sui runner GitHub cosi' come sono.
"""

import json
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from hashlib import md5
from pathlib import Path

QUI = Path(__file__).resolve().parent
CLUB = 2703620


def md5file(p):
    return md5(Path(p).read_bytes()).hexdigest()


def esegui(script, *args):
    r = subprocess.run([sys.executable, str(QUI / script), *args],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise AssertionError(f"{script} fallito:\n{r.stdout}\n{r.stderr}")
    return r.stdout


class BaseConArchivio(unittest.TestCase):
    """Ogni test lavora su una copia usa e getta del database e dei dati grezzi."""

    @classmethod
    def setUpClass(cls):
        if not (QUI / "lentoni.db").exists():
            raise unittest.SkipTest("lentoni.db non presente")

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.db = self.tmp / "prova.db"
        shutil.copy(QUI / "lentoni.db", self.db)
        self.raw = self.tmp / "raw"
        self.raw.mkdir()
        self._ricostruisci_raw()

    def _ricostruisci_raw(self):
        """Ricrea i file grezzi dal database invece di leggerli da raw/.

        raw/ non e' sotto controllo di versione (contiene campi che EA cambia ad ogni
        chiamata), quindi sul runner quei file non esistono. Ma il database conserva in
        'raw_json' la risposta originale di ogni entita': da li' si ricostruisce un
        fixture identico a quello vero, senza rete e senza dipendere dall'ambiente.
        """
        con = sqlite3.connect(self.db)
        con.row_factory = sqlite3.Row
        scrivi = lambda n, o: (self.raw / n).write_text(
            json.dumps(o, ensure_ascii=False), encoding="utf-8")

        club = con.execute(
            "SELECT raw_json FROM club_stats_history WHERE club_id=? AND raw_json IS NOT NULL "
            "ORDER BY id DESC LIMIT 1", (CLUB,)).fetchone()
        scrivi("overall_stats.json", [json.loads(club["raw_json"])] if club else [])

        ultimo = con.execute(
            "SELECT MAX(fetched_at) FROM member_stats_history WHERE club_id=?", (CLUB,)).fetchone()[0]
        membri = [json.loads(r["raw_json"]) for r in con.execute(
            "SELECT raw_json FROM member_stats_history WHERE club_id=? AND fetched_at=? "
            "AND raw_json IS NOT NULL", (CLUB, ultimo))]
        scrivi("members_stats.json", {"members": membri, "positionCount": {}})

        info = con.execute("SELECT raw_json FROM club_info WHERE club_id=?", (CLUB,)).fetchone()
        dati_club = {}
        if info and info["raw_json"]:
            grezzo = json.loads(info["raw_json"])
            dati_club = grezzo.get("club_info") or {}
        scrivi("club_info.json", dati_club)

        partite = [json.loads(r["raw_json"]) for r in con.execute(
            "SELECT raw_json FROM matches WHERE club_id=? AND raw_json IS NOT NULL "
            "ORDER BY ts DESC LIMIT 10", (CLUB,))]
        scrivi("matches_league.json", partite)
        scrivi("matches_playoff.json", [])
        scrivi("matches_friendly.json", [])

        # club_search.json e' l'unico file di raw/ versionato: serve per platform e region_id
        sorgente = QUI / "raw" / "club_search.json"
        if sorgente.exists():
            shutil.copy(sorgente, self.raw / "club_search.json")
        con.close()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


class TestIngest(BaseConArchivio):

    def test_ingest_e_idempotente(self):
        """Rieseguire l'ingest sugli stessi dati non deve cambiare un byte.

        Serve perche' il workflow gira ogni venti minuti: se l'ingest scrivesse comunque
        qualcosa, ogni giro produrrebbe un commit anche senza aver giocato. E' successo
        davvero, con gli snapshot salvati ad ogni esecuzione e con i campi volatili di EA
        (teamId, kitId) che cambiano ad ogni chiamata.
        """
        esegui("ingest.py", "--raw-dir", str(self.raw), "--db", str(self.db))
        primo = md5file(self.db)
        esegui("ingest.py", "--raw-dir", str(self.raw), "--db", str(self.db))
        secondo = md5file(self.db)
        esegui("ingest.py", "--raw-dir", str(self.raw), "--db", str(self.db))
        terzo = md5file(self.db)
        self.assertEqual(primo, secondo, "il secondo ingest ha modificato il database")
        self.assertEqual(secondo, terzo, "il terzo ingest ha modificato il database")

    def test_nessun_giocatore_duplicato_nella_stessa_partita(self):
        """Un giocatore non puo' comparire due volte nella stessa partita.

        La chiave primaria e' (match_id, club_id, ea_player_id): due id diversi che
        puntano alla stessa persona sfuggono al vincolo. E' successo con le righe
        'recovered_*' della ricostruzione manuale, che hanno gonfiato del 40% le
        statistiche di dieci giocatori senza che nulla lo segnalasse.
        """
        esegui("ingest.py", "--raw-dir", str(self.raw), "--db", str(self.db))
        con = sqlite3.connect(self.db)
        doppi = con.execute(
            "SELECT match_id, player_name, COUNT(*) c FROM match_player_stats "
            "GROUP BY 1, 2 HAVING c > 1"
        ).fetchall()
        con.close()
        self.assertEqual(doppi, [], f"giocatori duplicati in una partita: {doppi[:3]}")

    def test_la_guardia_regge_a_una_riga_ricostruita(self):
        """Inserendo a mano una riga con id sintetico, l'ingest deve sostituirla.

        La partita va scelta tra quelle presenti nel feed corrente di EA: la guardia
        agisce mentre si reinseriscono i dati, quindi non tocca le partite piu' vecchie
        della finestra di 10 che EA restituisce. Quelle sono state ripulite una volta a
        mano e non possono piu' sporcarsi.
        """
        nel_feed = {str(m["matchId"]) for m in
                    json.loads((self.raw / "matches_league.json").read_text(encoding="utf-8"))}
        self.assertTrue(nel_feed, "feed delle partite vuoto")
        con = sqlite3.connect(self.db)
        segnaposto = ", ".join("?" * len(nel_feed))
        riga = con.execute(
            "SELECT match_id, player_name FROM match_player_stats "
            "WHERE ea_player_id NOT LIKE 'recovered_' || '%' "
            "AND match_id IN (" + segnaposto + ") LIMIT 1",
            tuple(nel_feed),
        ).fetchone()
        if not riga:
            con.close()
            self.skipTest("nessuna partita del feed presente in archivio")
        mid, nome = riga
        con.execute(
            "INSERT INTO match_player_stats (match_id, club_id, ea_player_id, player_name, pos) "
            "VALUES (?,?,?,?,?)", (mid, CLUB, "recovered_test", nome, "midfielder"))
        con.commit()
        prima = con.execute(
            "SELECT COUNT(*) FROM match_player_stats WHERE match_id=? AND player_name=?",
            (mid, nome)).fetchone()[0]
        con.close()
        self.assertEqual(prima, 2, "il doppione di prova non e' stato inserito")

        esegui("ingest.py", "--raw-dir", str(self.raw), "--db", str(self.db))

        con = sqlite3.connect(self.db)
        dopo = con.execute(
            "SELECT COUNT(*) FROM match_player_stats WHERE match_id=? AND player_name=?",
            (mid, nome)).fetchone()[0]
        con.close()
        self.assertEqual(dopo, 1, "la guardia non ha rimosso la riga ricostruita")


class TestDashboard(BaseConArchivio):

    def _genera(self, out):
        esegui("generate_dashboard.py", "--db", str(self.db), "--out", str(out))
        return Path(out).read_text(encoding="utf-8")

    def _dati(self, html):
        inizio = html.index("const DATA = ") + len("const DATA = ")
        fine = html.index(";\n", inizio)
        return json.loads(html[inizio:fine])

    def test_un_secondo_club_non_contamina_la_dashboard(self):
        """Con due titoli in archivio, la dashboard mostra solo il club attivo.

        Dal 2026-08-21 l'archivio e' pensato per contenere piu' titoli (FC 26, FC 27...).
        Senza il filtro per club_id le due stagioni finirebbero sommate nella stessa rosa
        e nelle stesse classifiche, in silenzio: nessun errore, solo numeri sbagliati.
        """
        atteso = self._dati(self._genera(self.tmp / "prima.html"))

        con = sqlite3.connect(self.db)
        finto = 9999999
        for t in ("club_stats_history", "member_stats_history"):
            cols = [r[1] for r in con.execute(f"PRAGMA table_info({t})") if r[1] != "id"]
            sel = ", ".join("?" if c == "club_id" else c for c in cols)
            con.execute(f"INSERT INTO {t} ({', '.join(cols)}) "
                        f"SELECT {sel} FROM {t} WHERE club_id=?", (finto, CLUB))
        pref = "'X' || match_id"
        for t in ("matches", "match_player_stats"):
            cols = [r[1] for r in con.execute(f"PRAGMA table_info({t})")]
            sel = ", ".join(pref if c == "match_id" else ("?" if c == "club_id" else c)
                           for c in cols)
            con.execute(f"INSERT INTO {t} ({', '.join(cols)}) "
                        f"SELECT {sel} FROM {t} WHERE club_id=?", (finto, CLUB))
        con.commit()
        totale = con.execute("SELECT COUNT(*) FROM matches").fetchone()[0]
        con.close()
        self.assertGreater(totale, len(atteso["matches"]), "il club finto non e' stato inserito")

        ottenuto = self._dati(self._genera(self.tmp / "dopo.html"))
        self.assertEqual(len(ottenuto["matches"]), len(atteso["matches"]))
        self.assertEqual(len(ottenuto["roster"]), len(atteso["roster"]))
        self.assertEqual(len(ottenuto["history"]), len(atteso["history"]))
        self.assertEqual(ottenuto["latest"].get("skill_rating"),
                         atteso["latest"].get("skill_rating"))

    def test_roles_json_malformato_non_blocca_la_pubblicazione(self):
        """roles.json si modifica a mano: un refuso non deve fermare l'aggiornamento.

        Il caricamento deve ripiegare sui ruoli EA e generare comunque la dashboard,
        altrimenti un errore di battitura interromperebbe la pipeline ad ogni giro.
        """
        originale = (QUI / "roles.json").read_text(encoding="utf-8")
        rotto = json.loads(originale)
        rotto["giocatori"] = {"Tizio": ["questo", "non", "va"]}
        try:
            (QUI / "roles.json").write_text(json.dumps(rotto), encoding="utf-8")
            html = self._genera(self.tmp / "rotto.html")
            self.assertIn('id="ruoli"', html)
            self.assertIn('"skill_rating"', html)
        finally:
            (QUI / "roles.json").write_text(originale, encoding="utf-8")

    def test_la_dashboard_contiene_i_dati_essenziali(self):
        """Gli stessi controlli che giro.sh fa prima di pubblicare."""
        html = self._genera(self.tmp / "ok.html")
        dati = self._dati(html)
        self.assertGreater(dati["latest"].get("skill_rating", 0), 0)
        self.assertGreater(len(dati["matches"]), 0)
        self.assertIn('id="ruoli"', html)
        self.assertIn("saluteArchivio", dati)

    def test_salute_archivio_coerente(self):
        """Le partite archiviate non possono essere piu' di quelle giocate secondo EA."""
        dati = self._dati(self._genera(self.tmp / "salute.html"))
        sa = dati["saluteArchivio"]
        if sa.get("attese") is None:
            self.skipTest("servono almeno due snapshot")
        self.assertGreaterEqual(sa["attese"], sa["archiviateDaPrimoSnapshot"],
                                "archiviate piu' partite di quelle giocate: conteggio incoerente")
        self.assertGreaterEqual(sa["divario"], 0)


class TestConfigurazione(unittest.TestCase):

    def test_club_json_valido(self):
        c = json.loads((QUI / "club.json").read_text(encoding="utf-8"))
        self.assertIn("attivo", c)
        self.assertIsInstance(c["attivo"]["club_id"], int)
        self.assertTrue(c["attivo"].get("piattaforma"))

    def test_roles_json_valido(self):
        """Ogni giocatore deve avere un gruppo valido e un'etichetta EA riconosciuta."""
        r = json.loads((QUI / "roles.json").read_text(encoding="utf-8"))
        gruppi = set(r["ordine"])
        macro = set(r["macro_ea"].keys())
        for nome, v in r["giocatori"].items():
            with self.subTest(giocatore=nome):
                gruppo = v["gruppo"] if isinstance(v, dict) else v
                self.assertIn(gruppo, gruppi, f"gruppo sconosciuto per {nome}")
                if isinstance(v, dict) and v.get("etichetta_ea"):
                    self.assertIn(v["etichetta_ea"], macro,
                                  f"etichetta EA sconosciuta per {nome}")

    def test_eccezioni_partita_ben_formate(self):
        r = json.loads((QUI / "roles.json").read_text(encoding="utf-8"))
        gruppi = set(r["ordine"])
        for e in r.get("eccezioni_partita", []):
            with self.subTest(eccezione=e):
                self.assertIn("match_id", e)
                self.assertIn("giocatore", e)
                self.assertIn(e.get("gruppo"), gruppi)


if __name__ == "__main__":
    unittest.main(verbosity=2)
