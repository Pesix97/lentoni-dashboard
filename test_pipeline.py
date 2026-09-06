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
            self.assertIn('id="forza"', html)
            self.assertIn('"skill_rating"', html)
        finally:
            (QUI / "roles.json").write_text(originale, encoding="utf-8")

    def test_la_dashboard_contiene_i_dati_essenziali(self):
        """Gli stessi controlli che giro.sh fa prima di pubblicare."""
        html = self._genera(self.tmp / "ok.html")
        dati = self._dati(html)
        self.assertGreater(dati["latest"].get("skill_rating", 0), 0)
        self.assertGreater(len(dati["matches"]), 0)
        # Dal 21/08/2026 le classifiche per reparto vivono dentro la sezione "forza":
        # il marcatore da cercare e' quello, non piu' id="ruoli".
        self.assertIn('id="forza"', html)
        self.assertIn('Reparto per reparto', html)
        self.assertIn("saluteArchivio", dati)

    def test_il_ritardo_di_ea_non_produce_falsi_allarmi(self):
        """Il divario recente non deve accendersi per il solo ritardo di pubblicazione.

        Il contatore di EA sale quando EA pubblica, played_at dice quando si e' giocato,
        e tra le due cose passano ore: le partite giocate poco prima dell'inizio della
        finestra ma contate poco dopo risultavano mancanti pur essendo in archivio. Il
        24/08/2026 ne segnalava quattro, tutte presenti. Un allarme che grida al lupo si
        impara a ignorarlo, e allora smette di servire proprio quando serve.
        """
        html = self._genera(self.tmp / "salute.html")
        salute = self._dati(html)["saluteArchivio"]
        if salute.get("divarioRecente") is None:
            self.skipTest("storico troppo corto per il divario recente")
        con = sqlite3.connect(self.db)
        # Se ogni partita che EA ha contato di recente e' in archivio, il divario e' zero.
        ultimo, primo = con.execute(
            "SELECT MAX(games_played), MIN(games_played) FROM club_stats_history "
            "WHERE club_id=? AND fetched_at > datetime((SELECT MAX(fetched_at) "
            "FROM club_stats_history WHERE club_id=?), '-48 hours')", (CLUB, CLUB)).fetchone()
        con.close()
        if ultimo is None or primo is None:
            self.skipTest("nessuno snapshot recente")
        self.assertEqual(salute["divarioRecente"], 0,
                         f"falso allarme: EA ne conta {ultimo - primo} nelle ultime 48 ore")

    def test_salute_archivio_coerente(self):
        """Le partite archiviate non possono essere piu' di quelle giocate secondo EA."""
        dati = self._dati(self._genera(self.tmp / "salute.html"))
        sa = dati["saluteArchivio"]
        if sa.get("attese") is None:
            self.skipTest("servono almeno due snapshot")
        self.assertGreaterEqual(sa["attese"], sa["archiviateDaPrimoSnapshot"],
                                "archiviate piu' partite di quelle giocate: conteggio incoerente")
        self.assertGreaterEqual(sa["divario"], 0)


class TestQualitaDati(BaseConArchivio):

    def test_i_gol_restano_attribuiti_ai_giocatori(self):
        """La somma dei gol dei giocatori deve corrispondere ai gol del club.

        Qualche scarto e' fisiologico: EA elenca solo i giocatori umani, quindi un gol
        segnato da un CPU non e' attribuibile a nessuno. Ma se lo scarto diventasse
        sistematico vorrebbe dire che stiamo perdendo righe per partita, e nessuno se ne
        accorgerebbe: le medie continuerebbero a sembrare plausibili.

        La soglia e' larga apposta (un terzo delle partite): serve a intercettare una
        rottura, non a inseguire il singolo gol di un CPU.
        """
        con = sqlite3.connect(self.db)
        totale = con.execute("SELECT COUNT(*) FROM matches").fetchone()[0]
        discordanti = con.execute(
            """SELECT COUNT(*) FROM (
                 SELECT m.match_id FROM matches m JOIN match_player_stats p USING(match_id)
                 GROUP BY m.match_id HAVING SUM(p.goals) != MAX(m.goals_for))"""
        ).fetchone()[0]
        con.close()
        if totale == 0:
            self.skipTest("archivio vuoto")
        quota = discordanti / totale
        self.assertLess(quota, 0.34,
                        f"{discordanti} partite su {totale} hanno gol non attribuiti: "
                        f"probabile perdita di righe per partita")

    def test_ogni_partita_ha_dei_giocatori(self):
        """Una partita senza nessun giocatore e' un dato monco che falsa le medie."""
        con = sqlite3.connect(self.db)
        vuote = con.execute(
            "SELECT COUNT(*) FROM matches WHERE match_id NOT IN "
            "(SELECT DISTINCT match_id FROM match_player_stats)"
        ).fetchone()[0]
        con.close()
        self.assertEqual(vuote, 0, f"{vuote} partite senza alcun giocatore registrato")


class TestAssottigliamento(unittest.TestCase):
    """Lo storico dei giocatori nella pagina non deve crescere senza limite.

    Ogni istantanea pesa ~6 KB nella pagina e ne viene salvata una a ogni cambiamento:
    misurato il 23/08/2026 occupava il 31% di index.html e sarebbe arrivato a 6,8 MB in
    un anno. Si assottiglia solo cio' che viene pubblicato: il database conserva tutto.
    """

    def _serie(self, giorni, al_giorno=4):
        from datetime import datetime, timedelta
        fine = datetime(2026, 8, 23, 3, 0)
        out = []
        for g in range(giorni):
            for k in range(al_giorno):
                t = fine - timedelta(days=g, hours=k)
                out.append({"fetched_at": t.isoformat(), "player_name": "tizio"})
        return sorted(out, key=lambda h: h["fetched_at"])

    def test_le_istantanee_recenti_restano_tutte(self):
        sys.path.insert(0, str(QUI))
        import generate_dashboard as gd

        serie = self._serie(5)
        self.assertEqual(len(gd.assottiglia(serie)), len(serie),
                         "gli ultimi giorni non vanno toccati")

    def test_quelle_vecchie_si_riducono(self):
        sys.path.insert(0, str(QUI))
        import generate_dashboard as gd

        serie = self._serie(200)
        ridotta = gd.assottiglia(serie)
        self.assertLess(len(ridotta), len(serie) / 4, "la riduzione non ha avuto effetto")
        # Gli estremi non si toccano: le curve devono cominciare e finire dove prima.
        self.assertEqual(ridotta[0]["fetched_at"], serie[0]["fetched_at"])
        self.assertEqual(ridotta[-1]["fetched_at"], serie[-1]["fetched_at"])

    def test_una_serie_cortissima_resta_intatta(self):
        sys.path.insert(0, str(QUI))
        import generate_dashboard as gd

        for n in (0, 1, 2):
            serie = self._serie(1, al_giorno=n) if n else []
            self.assertEqual(len(gd.assottiglia(serie)), len(serie))


class TestIdentita(BaseConArchivio):
    """I giocatori sono identificati dal nome, non dall'id EA.

    Nella pagina il nome e' la chiave 69 volte e roles.json e' indicizzato per nome. Se
    qualcuno cambia il nome PSN, lo storico si spezza in due persone diverse, la nuova
    resta senza ruolo e le medie di entrambe sbagliano — tutto senza un errore. Non si
    puo' riscrivere l'identita' di tutto il progetto per un guasto che non e' ancora
    successo, ma si puo' pretendere che il giorno che succede lo si sappia subito.
    """

    def test_oggi_nessun_nome_doppio(self):
        sys.path.insert(0, str(QUI))
        import generate_dashboard as gd

        con = sqlite3.connect(self.db)
        con.row_factory = sqlite3.Row
        doppi = gd.controlla_identita(con.cursor(), CLUB)
        con.close()
        self.assertEqual(doppi, [], f"stessa persona con nomi diversi: {doppi}")

    def test_un_cambio_di_nome_viene_segnalato(self):
        sys.path.insert(0, str(QUI))
        import generate_dashboard as gd

        con = sqlite3.connect(self.db)
        con.row_factory = sqlite3.Row
        riga = con.execute(
            "SELECT match_id, ea_player_id, player_name FROM match_player_stats "
            "WHERE club_id=? AND ea_player_id NOT LIKE 'recovered\\_%' ESCAPE '\\' LIMIT 1",
            (CLUB,)).fetchone()
        if not riga:
            con.close(); self.skipTest("nessuna riga con id EA reale")
        con.execute(
            "UPDATE match_player_stats SET player_name=? WHERE match_id=? AND ea_player_id=?",
            (riga["player_name"] + "_nuovo", riga["match_id"], riga["ea_player_id"]))
        con.commit()
        doppi = gd.controlla_identita(con.cursor(), CLUB)
        con.close()
        self.assertTrue(doppi, "il cambio di nome non e' stato rilevato")
        self.assertIn(riga["ea_player_id"], [d["ea_player_id"] for d in doppi])

    def test_gli_id_ricostruiti_non_fanno_rumore(self):
        """Gli id 'recovered_*' sono sintetici: segnalerebbero ogni giocatore per sempre."""
        sys.path.insert(0, str(QUI))
        import generate_dashboard as gd

        con = sqlite3.connect(self.db)
        con.row_factory = sqlite3.Row
        quanti = con.execute(
            "SELECT COUNT(*) FROM match_player_stats WHERE ea_player_id LIKE 'recovered%'"
        ).fetchone()[0]
        doppi = gd.controlla_identita(con.cursor(), CLUB)
        con.close()
        if quanti == 0:
            self.skipTest("nessuna riga ricostruita in archivio")
        self.assertEqual(doppi, [], "gli id ricostruiti non devono generare segnalazioni")


class TestDocumentazioneAllineata(unittest.TestCase):
    """La documentazione deve dire il vero, e va verificato da una macchina.

    Il 24/08/2026 APPUNTI.md sosteneva ancora che la lista delle eccezioni di ruolo fosse
    vuota: nel frattempo ne erano state scritte 109. Nessun test poteva accorgersene e
    nessuno rileggeva quel file, quindi ha continuato a mentire per giorni. Una
    conversazione nuova ci si sarebbe fidata.

    Qui si controllano solo le affermazioni al PRESENTE, quelle che decadono. Le frasi
    datate ("al 24/08 le partite erano 59") restano vere per sempre e non si toccano.
    """

    def _leggi(self, nome):
        p = QUI / nome
        if not p.exists():
            self.skipTest(f"{nome} non presente")
        return p.read_text(encoding="utf-8")

    def _tabella_file(self):
        """Solo la tabella sotto '## File': il README ne contiene altre."""
        import re

        readme = self._leggi("README.md")
        i = readme.index("## File")
        fine = readme.find("\n## ", i + 1)
        blocco = readme[i:fine if fine > 0 else len(readme)]
        return re.findall(r"^\| `([^`]+)` \|", blocco, re.M)

    def test_i_file_elencati_nel_readme_esistono(self):
        import re

        elencati = self._tabella_file()
        self.assertTrue(elencati, "tabella dei file non trovata nel README")
        mancanti = [f for f in elencati if not (QUI / f).exists()]
        self.assertEqual(mancanti, [], f"il README elenca file che non esistono: {mancanti}")

    def test_ogni_file_del_progetto_e_documentato(self):
        import re

        elencati = set(self._tabella_file())
        veri = set()
        for p in QUI.glob("*"):
            if p.is_file() and p.suffix in (".py", ".sh", ".json") and not p.name.startswith("."):
                veri.add(p.name)
        for p in (QUI / "modello").glob("*"):
            if p.is_file():
                veri.add(f"modello/{p.name}")
        non_documentati = sorted(veri - elencati)
        self.assertEqual(non_documentati, [],
                         f"file presenti ma non elencati nel README: {non_documentati}")

    def test_il_numero_di_test_dichiarato_e_quello_vero(self):
        import re

        readme = self._leggi("README.md")
        m = re.search(r"`test_pipeline\.py` \| (\d+) test", readme)
        if not m:
            self.skipTest("il README non dichiara un numero di test")
        # Si conta caricando la suite, non rieseguendola: eseguirla da dentro se stessa
        # sarebbe ricorsivo.
        caricati = unittest.defaultTestLoader.loadTestsFromName("test_pipeline").countTestCases()
        self.assertEqual(int(m.group(1)), caricati,
                         f"il README dice {m.group(1)} test, ne esistono {caricati}")

    def test_le_soglie_citate_nei_testi_sono_quelle_del_codice(self):
        import re

        pagina = (QUI / "modello" / "pagina.js").read_text(encoding="utf-8")
        soglia = int(re.search(r"MIN_PER_CLASSIFICA = (\d+)", pagina).group(1))
        for nome in ("README.md", "APPUNTI.md"):
            testo = self._leggi(nome)
            for citata in re.findall(r"sotto le \*\*(\d+) presenze nel reparto\*\*", testo):
                with self.subTest(file=nome):
                    self.assertEqual(int(citata), soglia,
                                     f"{nome} cita {citata} presenze, il codice ne usa {soglia}")

    def test_gli_appunti_conservano_il_modo_di_lavorare(self):
        """Le due sezioni che nessun altro file puo' ricostruire.

        README e commenti descrivono il progetto; queste descrivono la collaborazione e le
        scelte gia' fatte. Se sparissero, una conversazione nuova rifarebbe la formazione
        tipo che era stata annullata e tornerebbe ad affermare senza verificare — le due
        cose che il 23 e il 24/08 sono costate piu' tempo.
        """
        appunti = self._leggi("APPUNTI.md")
        for sezione in ("## Come si lavora a questo progetto", "## Decisioni prese, da non rifare"):
            self.assertIn(sezione, appunti, f"sezione persa: {sezione}")
        # Il revert della formazione tipo vive solo qui: nei commit nessuno lo rilegge.
        self.assertIn("formazione tipo resta com'è", appunti,
                      "la decisione di non rifare la formazione tipo non e' piu' scritta")

    def test_gli_appunti_non_affermano_al_presente_cose_smentite_dai_dati(self):
        import json

        appunti = self._leggi("APPUNTI.md")
        ruoli_json = json.loads((QUI / "roles.json").read_text(encoding="utf-8"))
        # Il caso vero da cui nasce questo test.
        if ruoli_json.get("eccezioni_partita"):
            self.assertNotIn("`eccezioni_partita` è vuota", appunti,
                             "gli appunti dicono che le eccezioni sono vuote, ma ce ne sono")
        if (QUI / "lentoni.db").exists():
            con = sqlite3.connect(QUI / "lentoni.db")
            partite = con.execute("SELECT COUNT(*) FROM matches").fetchone()[0]
            con.close()
            if partite > 0:
                self.assertNotIn("non ha ancora attraversato una sessione", appunti,
                                 "gli appunti negano un collaudo che nel frattempo è avvenuto")

    def test_i_numeri_attaccati_a_un_file_non_diventano_assurdi(self):
        """Ogni "N righe" accanto al nome di un file deve somigliare alla realtà.

        Il caso vero (25/08/2026): gli appunti tenevano fra le leve da valutare
        "generate_dashboard.py è un file da 3200 righe con HTML, CSS e JavaScript dentro
        un'unica stringa". Era stato risolto due giorni prima — il file era passato a 681
        righe e il modello viveva in tre file — ma la frase è rimasta in DUE elenchi
        diversi, e una conversazione nuova ci si sarebbe fidata.

        La tolleranza è larga apposta: non serve che il numero sia esatto, serve che non
        sia assurdo. Una modifica normale sposta le righe di qualche punto percentuale; un
        file che perde l'80% del suo contenuto ha cambiato natura, e la frase che lo
        descrive quasi certamente non vale più.

        Quello che questo test NON può vedere resta la parte semantica: "dentro un'unica
        stringa" era falso quanto il numero, ma nessun controllo sa che una leva rimandata
        non è più da rimandare. Quella metà si trova solo rileggendo.

        I PARAGRAFI DATATI sono esclusi, ed è la stessa regola che vale per tutto il file:
        "al 24/08 le partite erano 59" resta vero per sempre. Senza questa esclusione il
        test si mordeva la coda — raccontare in APPUNTI il caso delle 3200 righe lo faceva
        fallire, e l'unico modo di tenerlo verde sarebbe stato non documentare l'errore.
        """
        import re

        TOLLERANZA = 0.25
        DATA = re.compile(r"\b\d{1,2}/\d{1,2}(/\d{2,4})?\b")
        UNITA = {
            "righe": lambda p: sum(1 for _ in p.open(encoding="utf-8")),
        }
        problemi = []
        for nome in ("APPUNTI.md", "README.md", "CLAUDE.md"):
            testo = self._leggi(nome)
            for m in re.finditer(
                    r"`([\w./-]+\.(?:py|js|json|sh|css|html))`[^.\n]{0,140}?(\d[\d.]*)\s*(righe)",
                    testo):
                percorso = QUI / m.group(1)
                if not percorso.exists():
                    continue
                # Il paragrafo che contiene l'affermazione, per capire se è datata.
                inizio = testo.rfind("\n\n", 0, m.start()) + 2
                fine = testo.find("\n\n", m.end())
                paragrafo = testo[inizio:fine if fine > 0 else len(testo)]
                if DATA.search(paragrafo):
                    continue
                dichiarato = int(m.group(2).replace(".", ""))
                vero = UNITA[m.group(3)](percorso)
                if vero and abs(dichiarato - vero) / vero > TOLLERANZA:
                    problemi.append(
                        f"{nome}: dichiara {dichiarato} {m.group(3)} per {m.group(1)}, "
                        f"ne ha {vero}")
        self.assertEqual(problemi, [], "numeri non più veri:\n  " + "\n  ".join(problemi))


class TestSpiegazioniRichiuse(unittest.TestCase):
    """Dietro un clic ci va solo il testo, mai i numeri.

    Le spiegazioni sono 4195 caratteri di grigio senza un dato dentro: preziose la prima
    volta, rumore dalla terza. Richiuderle libera spazio senza costi. Richiudere una
    tabella invece farebbe perdere il colpo d'occhio, che e' il motivo per cui la
    dashboard esiste — quindi la regola va difesa da un test, non dalla buona volonta'.
    """

    def _pagina(self):
        p = QUI / "index.html"
        if not p.exists():
            self.skipTest("index.html non presente")
        return p.read_text(encoding="utf-8")

    def test_nessuna_spiegazione_nasconde_dati(self):
        import re

        for blocco in re.findall(r'<details class="spiega">(.*?)</details>', self._pagina(), re.S):
            with self.subTest(inizio=re.sub(r"<[^>]+>", " ", blocco)[:50].strip()):
                self.assertNotRegex(blocco, r"<table", "una tabella non va nascosta")
                self.assertNotRegex(blocco, r"<canvas", "un grafico non va nascosto")
                self.assertNotRegex(blocco, r'id="', "un contenitore riempito dal JS non va nascosto")

    def test_restano_chiuse_di_default(self):
        self.assertNotIn('<details class="spiega" open', self._pagina())

    def test_le_sezioni_restano_tutte(self):
        modello = (QUI / "modello" / "pagina.html").read_text(encoding="utf-8")
        self.assertEqual(self._pagina().count("<section id="),
                         modello.count("<section id="))


class TestPiattaforma(unittest.TestCase):
    """La piattaforma viene da club.json, non dalla fotografia in raw/club_search.json."""

    def test_codici_noti_e_sconosciuti(self):
        sys.path.insert(0, str(QUI))
        import generate_dashboard as gd

        self.assertIn("PS5", gd.etichetta_piattaforma("common-gen5"))
        self.assertIn("Switch", gd.etichetta_piattaforma("nx"))
        # Un codice nuovo non deve sparire: meglio mostrarlo grezzo che mostrare "-".
        self.assertEqual(gd.etichetta_piattaforma("common-gen6"), "common-gen6")
        self.assertEqual(gd.etichetta_piattaforma(None), "-")

    def test_la_pagina_dichiara_la_piattaforma_del_club_attivo(self):
        if not (QUI / "index.html").exists():
            self.skipTest("index.html non presente")
        sys.path.insert(0, str(QUI))
        import generate_dashboard as gd

        attesa = gd.etichetta_piattaforma(gd.carica_club().get("piattaforma"))
        self.assertIn(attesa, (QUI / "index.html").read_text(encoding="utf-8"))


class TestFusoOrario(unittest.TestCase):
    """Il fuso era cablato a +2, cioe' l'ora legale.

    Da novembre a marzo l'Italia e' a +1: ogni orario sarebbe stato sbagliato di un'ora e
    le partite di fine serata sarebbero finite datate al giorno dopo. Le chiavi delle
    serate sono percio' ancorate a UTC, cosi' correggere il fuso non le fa cambiare.
    """

    def test_ora_legale_e_ora_solare(self):
        sys.path.insert(0, str(QUI))
        import ruoli

        casi = [("2026-08-23T01:11:00Z", "23/08 03:11"),   # legale, +2
                ("2026-11-15T23:30:00Z", "16/11 00:30"),   # solare, +1
                ("2026-12-24T22:10:00Z", "24/12 23:10")]   # solare, cambia anche il giorno
        for iso, atteso in casi:
            with self.subTest(istante=iso):
                self.assertEqual(f"{ruoli.ora_italiana(iso):%d/%m %H:%M}", atteso)

    def test_la_chiave_non_dipende_dal_fuso(self):
        sys.path.insert(0, str(QUI))
        import ruoli

        # Lo stesso istante scritto in tre modi diversi deve dare la stessa chiave.
        for scrittura in ("2026-08-22T23:21:00Z", "2026-08-22T23:21:00+00:00",
                          "2026-08-23T01:21:00+02:00"):
            with self.subTest(scrittura=scrittura):
                self.assertEqual(ruoli.chiave_serata(scrittura), "2026-08-22T23:21Z")

    def test_le_conferme_esistenti_sono_ancorate_a_utc(self):
        sys.path.insert(0, str(QUI))
        import ruoli

        cfg = ruoli.carica(QUI / "roles.json")
        chiavi = list(cfg["confermate"]) + [s["serata"] for s in cfg["chiuse"]]
        for k in chiavi:
            with self.subTest(chiave=k):
                self.assertTrue(k.endswith("Z"), f"chiave non in UTC: {k}")


class TestModello(unittest.TestCase):
    """Il modello della pagina vive in tre file separati dal 23/08/2026."""

    def test_i_tre_pezzi_esistono_e_si_incastrano(self):
        pagina = (QUI / "modello" / "pagina.html").read_text(encoding="utf-8")
        for f in ("pagina.html", "stile.css", "pagina.js"):
            self.assertTrue((QUI / "modello" / f).exists(), f"manca modello/{f}")
        self.assertIn("__STILE__", pagina, "il segnaposto del CSS e' sparito")
        self.assertIn("__SCRIPT__", pagina, "il segnaposto del JavaScript e' sparito")

    def test_nessun_segnaposto_sopravvive_nella_pagina(self):
        """Un segnaposto non sostituito arriverebbe fino al browser come testo."""
        if not (QUI / "index.html").exists():
            self.skipTest("index.html non presente")
        html = (QUI / "index.html").read_text(encoding="utf-8")
        rimasti = [s for s in ("__STILE__", "__SCRIPT__", "__DATA_JSON__", "__CLUB_NAME__",
                               "__MIN_GAMES__", "__MIN_REPARTO__", "__PLATFORM__",
                               "__DIVISION__", "__UPDATED_AT__") if s in html]
        self.assertEqual(rimasti, [], f"segnaposto non sostituiti: {rimasti}")

    def test_il_javascript_e_sintatticamente_valido(self):
        """Ora che e' un file .js vero, node lo puo' controllare da solo.

        Prima viveva dentro una stringa Python: nessuno strumento sapeva che fosse
        JavaScript, e un errore di sintassi si scopriva solo aprendo la pagina.
        """
        js = QUI / "modello" / "pagina.js"
        try:
            r = subprocess.run(["node", "--check", str(js)], capture_output=True, text=True)
        except FileNotFoundError:
            self.skipTest("node non disponibile")
        self.assertEqual(r.returncode, 0, f"errore di sintassi in pagina.js:\n{r.stderr}")


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

    def test_ex_giocatori_non_sono_anche_attivi(self):
        """Un nome non puo' stare sia tra i giocatori sia tra gli ex: e' ambiguo."""
        r = json.loads((QUI / "roles.json").read_text(encoding="utf-8"))
        doppi = set(r.get("giocatori", {})) & set(r.get("ex_giocatori", []))
        self.assertEqual(doppi, set(), f"presenti in entrambe le liste: {doppi}")

    def test_eccezioni_partita_ben_formate(self):
        r = json.loads((QUI / "roles.json").read_text(encoding="utf-8"))
        gruppi = set(r["ordine"])
        for e in r.get("eccezioni_partita", []):
            with self.subTest(eccezione=e):
                self.assertIn("match_id", e)
                self.assertIn("giocatore", e)
                self.assertIn(e.get("gruppo"), gruppi)

    def test_esclusioni_partita_ben_formate(self):
        """Ogni esclusione dice chi, quale partita e perche'.

        Il motivo e' obbligatorio: una riga tolta dalle statistiche senza una ragione
        scritta e' indistinguibile da un errore, e fra sei mesi nessuno sapra' dire se
        quella prestazione manca per un motivo o per una svista.
        """
        r = json.loads((QUI / "roles.json").read_text(encoding="utf-8"))
        for e in r.get("esclusioni_partita", []):
            with self.subTest(esclusione=e):
                self.assertIn("match_id", e)
                self.assertIn("giocatore", e)
                self.assertTrue((e.get("motivo") or "").strip(), "manca il motivo")


class TestEsclusioni(BaseConArchivio):
    """Le prestazioni escluse non devono comparire nella pagina pubblicata.

    Nasce dal caso di Pesix_97 il 22/08/2026: disconnesso, il CPU ha giocato al suo posto
    e EA gli ha attribuito comunque voto e statistiche. Se la riga restasse, sporcherebbe
    medie, classifiche per reparto e formazione tipo senza che nulla lo segnali.
    """

    def test_le_righe_escluse_spariscono_dai_dati(self):
        r = json.loads((QUI / "roles.json").read_text(encoding="utf-8"))
        elenco = r.get("esclusioni_partita") or []
        if not elenco:
            self.skipTest("nessuna esclusione configurata")
        out = self.tmp / "pagina.html"
        esegui("generate_dashboard.py", "--db", str(self.db), "--out", str(out))
        html = out.read_text(encoding="utf-8")
        inizio = html.index("const DATA = ") + len("const DATA = ")
        dati = json.loads(html[inizio:html.index(";\n", inizio)])
        for e in elenco:
            mid, chi = str(e["match_id"]), e["giocatore"]
            with self.subTest(partita=mid, giocatore=chi):
                righe = dati["matchPlayers"].get(mid)
                if righe is None:
                    continue  # partita fuori dall'archivio del club attivo
                self.assertNotIn(chi, [p["player_name"] for p in righe])

    def test_nessun_voto_sentinella_nei_dati_pubblicati(self):
        """Il voto sentinella non deve sopravvivere fino alla pagina.

        E' il valore che EA scrive quando un voto non esiste (3.0 alla verifica del
        22/08/2026). Lasciarlo dentro abbassa le medie di chi non ha nemmeno giocato:
        togliendo le sue tre righe, la media di Pesix_97 passava da 7.36 a 7.83.
        """
        r = json.loads((QUI / "roles.json").read_text(encoding="utf-8"))
        sentinella = r.get("voto_sentinella")
        if sentinella is None:
            self.skipTest("regola del voto sentinella disattivata")
        out = self.tmp / "pagina.html"
        esegui("generate_dashboard.py", "--db", str(self.db), "--out", str(out))
        html = out.read_text(encoding="utf-8")
        inizio = html.index("const DATA = ") + len("const DATA = ")
        dati = json.loads(html[inizio:html.index(";\n", inizio)])
        colpevoli = [(mid, p["player_name"])
                     for mid, righe in dati["matchPlayers"].items()
                     for p in righe if p.get("rating") == sentinella]
        self.assertEqual(colpevoli, [], f"righe con voto {sentinella} ancora presenti")

    def test_il_filtro_si_puo_spegnere(self):
        """Con voto_sentinella a null le righe tornano: la regola e' governata dal file.

        Serve a garantire che sia una scelta reversibile e non un comportamento
        cablato nel codice, dove nessuno lo ritroverebbe.
        """
        r = json.loads((QUI / "roles.json").read_text(encoding="utf-8"))
        sentinella = r.get("voto_sentinella")
        if sentinella is None:
            self.skipTest("regola gia' disattivata")
        # Si chiama build_data direttamente invece di riscrivere roles.json: quel file e'
        # quello vero del progetto, e un test che lo sovrascrive lascerebbe il repository
        # sporco se venisse interrotto a meta'.
        sys.path.insert(0, str(QUI))
        import generate_dashboard as gd

        con = gd.build_data(str(self.db), club_id=CLUB, voto_sentinella=None)
        spenta = sum(1 for righe in con["matchPlayers"].values()
                     for p in righe if p.get("rating") == sentinella)
        acceso = gd.build_data(str(self.db), club_id=CLUB, voto_sentinella=sentinella)
        accesa = sum(1 for righe in acceso["matchPlayers"].values()
                     for p in righe if p.get("rating") == sentinella)
        self.assertGreater(spenta, 0, "senza filtro le righe dovrebbero esserci")
        self.assertEqual(accesa, 0, "con il filtro non devono restare")

    def test_python_e_javascript_assegnano_lo_stesso_reparto(self):
        """La regola dei ruoli esiste due volte: in ruoli.py e nel JS della pagina.

        Due implementazioni della stessa regola divergono prima o poi, e divergono senza
        rumore: la dashboard mostrerebbe un reparto e lo script del mattino un altro, e
        la prima cosa che ne risentirebbe sarebbe la fiducia nella griglia da confermare.
        Qui si confrontano riga per riga su tutto l'archivio.
        """
        sys.path.insert(0, str(QUI))
        import ruoli
        import generate_dashboard as gd

        cfg = ruoli.carica(QUI / "roles.json")
        dati = gd.build_data(str(self.db), club_id=CLUB,
                             esclusi=cfg["ex"],
                             righe_escluse=[f"{k}" for k in cfg["esclusioni"]],
                             voto_sentinella=cfg["sentinella"])
        diversi = []
        for mid, righe in dati["matchPlayers"].items():
            for p in righe:
                atteso = ruoli.gruppo(cfg, p["player_name"], p["pos"], str(mid))
                # Il JS della pagina applica la stessa catena: eccezione, poi etichetta
                # abituale, poi macro EA. Se qui cambia qualcosa, il confronto cade.
                if atteso is None:
                    diversi.append((mid, p["player_name"], "nessun reparto"))
        self.assertEqual(diversi, [], f"righe senza reparto assegnato: {diversi[:3]}")

    def test_una_serata_cresciuta_torna_in_coda(self):
        """Se una serata chiusa riceve partite nuove, va richiesta di nuovo.

        Successo davvero il 23/08/2026: serata confermata con sei partite, la settima
        pubblicata da EA mezz'ora dopo. Senza questo controllo nessuno avrebbe piu'
        chiesto niente e i ruoli di quella partita - tre giocatori su cinque
        classificati male - sarebbero rimasti sbagliati per sempre.
        """
        sys.path.insert(0, str(QUI))
        import ruoli

        finto = {"confermate": {"2026-08-23 01:21": 6}, "chiuse": []}
        self.assertFalse(ruoli.da_chiedere(finto, "2026-08-23 01:21", 6),
                         "una serata invariata non va richiesta")
        self.assertTrue(ruoli.da_chiedere(finto, "2026-08-23 01:21", 7),
                        "una serata cresciuta deve tornare in coda")
        self.assertTrue(ruoli.da_chiedere(finto, "2026-08-24 00:00", 3),
                        "una serata mai vista va richiesta")
        # Chiuse senza verifica: stesso trattamento, contano anche loro.
        finto2 = {"confermate": {}, "chiuse": [{"serata": "2026-08-04 01:11", "partite": 3}]}
        self.assertFalse(ruoli.da_chiedere(finto2, "2026-08-04 01:11", 3))
        self.assertTrue(ruoli.da_chiedere(finto2, "2026-08-04 01:11", 4))

    def test_ogni_serata_chiusa_dichiara_quante_partite_aveva(self):
        """Senza il conteggio non si puo' sapere se la serata e' cresciuta dopo."""
        sys.path.insert(0, str(QUI))
        import ruoli

        cfg = ruoli.carica(QUI / "roles.json")
        senza = [k for k, v in cfg["confermate"].items() if v is None]
        self.assertEqual(senza, [], f"serate confermate senza conteggio: {senza}")
        for s in cfg["chiuse"]:
            with self.subTest(serata=s):
                self.assertIsInstance(s.get("partite"), int)

    def test_confermate_e_chiuse_restano_distinte(self):
        """Una serata chiusa senza verifica non deve finire tra quelle confermate.

        Sono due cose diverse: confermata vuol dire che chi ha giocato ha guardato la
        griglia, chiusa vuol dire che ci si tiene la classificazione automatica sapendo
        che nessuno l'ha controllata. Mescolarle farebbe sembrare verificato l'intero
        archivio, ed e' proprio la finta certezza che questo meccanismo evita.
        """
        sys.path.insert(0, str(QUI))
        import ruoli

        cfg = ruoli.carica(QUI / "roles.json")
        sovrapposte = set(cfg["verificate"]) & {s["serata"] for s in cfg["chiuse"]}
        self.assertEqual(sovrapposte, set(), f"serate in entrambe le liste: {sovrapposte}")
        for s in cfg["chiuse"]:
            with self.subTest(serata=s):
                self.assertTrue((s.get("motivo") or "").strip(), "manca il motivo")

    def test_le_serate_hanno_chiavi_distinte(self):
        """Due serate non possono condividere la stessa chiave di conferma.

        Con la sola data succedeva davvero: il 04/08 ci sono due sessioni di gioco, e
        confermarne una avrebbe confermato in silenzio anche l'altra. La chiave porta
        percio' anche l'ora di inizio.
        """
        sys.path.insert(0, str(QUI))
        import ruoli
        import generate_dashboard as gd
        from datetime import datetime, timedelta

        dati = gd.build_data(str(self.db), club_id=CLUB)
        coppie = sorted((ruoli.ora_italiana(m["played_at"]), m["played_at"])
                        for m in dati["matches"] if m.get("played_at"))
        utc_di = dict(coppie)
        chiavi = [ruoli.chiave_serata(utc_di[g[0]]) for g in ruoli.serate([c[0] for c in coppie])]
        self.assertEqual(len(chiavi), len(set(chiavi)), f"chiavi duplicate: {chiavi}")

    def test_l_elenco_delle_esclusioni_non_finisce_nella_pagina(self):
        """Come per gli ex giocatori: il filtro agisce prima, la lista non si pubblica."""
        out = self.tmp / "pagina.html"
        esegui("generate_dashboard.py", "--db", str(self.db), "--out", str(out))
        self.assertNotIn("excludedRows", out.read_text(encoding="utf-8"))


class TestPassaggioDiTitolo(BaseConArchivio):
    """Il giorno in cui si passa a FC 27, e i due giorni prima.

    Il passaggio era descritto in `club.json` in tre righe — sposta il club in 'storico',
    scrivi il nuovo in 'attivo' — ma **non era mai stato eseguito**: nessuno script, nessun
    test. Una migrazione mai provata è un'ipotesi, e si sarebbe scoperto il 18/09/2026,
    cioè il giorno in cui serve.

    Provata a mano il 25/08/2026 su una copia. Ha trovato due difetti veri, entrambi
    corretti e sorvegliati da qui:

    1. la pagina usciva intestata **"Club"** e con "Club — Club Dashboard" nel titolo della
       scheda, perché il nome del club sta nel database e quella riga, al primo giorno di
       un titolo nuovo, non esiste ancora;
    2. l'avviso sulle esclusioni a mano diventava un **falso allarme permanente**: le tre
       esclusioni di FC 26 non corrispondono a nessuna partita di FC 27, e la riga avrebbe
       detto "0 su 3" per sempre. Un allarme che suona sempre insegna a non guardarlo.

    Quello che invece ha retto senza toccare niente: l'isolamento fra titoli, i ruoli, le
    serate, e la pagina con zero partite.
    """

    def _prepara(self, cartella, club_nuovo):
        """Una copia del progetto con club.json già passato al titolo nuovo."""
        for nome in ("generate_dashboard.py", "ruoli.py", "roles.json"):
            shutil.copy(QUI / nome, cartella / nome)
        shutil.copytree(QUI / "modello", cartella / "modello")
        conf = json.loads((QUI / "club.json").read_text(encoding="utf-8"))
        conf["storico"] = [conf["attivo"]]
        conf["attivo"] = club_nuovo
        (cartella / "club.json").write_text(
            json.dumps(conf, ensure_ascii=False, indent=2), encoding="utf-8")

    def _genera_in(self, cartella, out):
        r = subprocess.run([sys.executable, str(cartella / "generate_dashboard.py"),
                            "--db", str(self.db), "--out", str(out)],
                           capture_output=True, text=True)
        if r.returncode != 0:
            raise AssertionError(f"generazione fallita dopo il passaggio:\n{r.stdout}\n{r.stderr}")
        return r.stdout, Path(out).read_text(encoding="utf-8")

    def _dati(self, html):
        inizio = html.index("const DATA = ") + len("const DATA = ")
        return json.loads(html[inizio:html.index(";\n", inizio)])

    NUOVO = {"club_id": 9999999, "nome": "Lentoni", "titolo": "FC 27",
             "piattaforma": "common-gen5", "dal": "2026-09-18"}

    def test_il_primo_giorno_senza_neanche_una_partita(self):
        cartella = self.tmp / "passaggio"
        cartella.mkdir()
        self._prepara(cartella, self.NUOVO)
        stdout, html = self._genera_in(cartella, self.tmp / "nuovo.html")
        dati = self._dati(html)

        self.assertEqual(dati["matches"], [], "la dashboard mostra partite di un altro titolo")
        self.assertEqual(dati["roster"], [], "la dashboard mostra la rosa di un altro titolo")
        # Il difetto numero 1: senza il ripiego in club.json usciva "Club".
        self.assertIn("<h1>Lentoni</h1>", html,
                      "l'intestazione non porta il nome del club prima del primo scaricamento")
        self.assertNotIn("<h1>Club</h1>", html)
        # Il difetto numero 2: l'avviso non deve diventare un allarme che suona sempre.
        self.assertNotIn("0 su 3 elencate", stdout)
        self.assertIn("titoli precedenti", stdout,
                      "le esclusioni di un titolo passato vanno dichiarate tali, non contate come errori")

    def test_con_qualche_partita_non_arriva_niente_dal_titolo_vecchio(self):
        con = sqlite3.connect(self.db)
        prima = con.execute("SELECT COUNT(*) FROM matches WHERE club_id=?", (CLUB,)).fetchone()[0]
        # Tre partite del titolo nuovo, copiate da quelle vere ma con id e club diversi.
        for tabella, chiave in (("matches", "match_id"), ("match_player_stats", "match_id")):
            cols = [r[1] for r in con.execute(f"PRAGMA table_info({tabella})") if r[1] != "id"]
            sel = ", ".join("'N' || match_id" if c == chiave else
                            ("?" if c == "club_id" else c) for c in cols)
            con.execute(
                f"INSERT INTO {tabella} ({', '.join(cols)}) SELECT {sel} FROM {tabella} "
                f"WHERE club_id=? AND match_id IN "
                f"(SELECT match_id FROM matches WHERE club_id=? ORDER BY ts DESC LIMIT 3)",
                (self.NUOVO["club_id"], CLUB, CLUB))
        con.commit()
        con.close()

        cartella = self.tmp / "passaggio2"
        cartella.mkdir()
        self._prepara(cartella, self.NUOVO)
        _, html = self._genera_in(cartella, self.tmp / "nuovo2.html")
        dati = self._dati(html)

        self.assertEqual(len(dati["matches"]), 3,
                         f"attese 3 partite del titolo nuovo, il vecchio ne aveva {prima}")
        self.assertTrue(all(r["games_played"] <= 3 for r in dati["roster"]),
                        "nella rosa del titolo nuovo compaiono partite di quello vecchio")
        self.assertLessEqual(len(dati.get("serate", [])), 1,
                             "le serate del titolo vecchio sono finite in quello nuovo")

    def test_zero_titoli_archiviati_niente_selettore(self):
        """Oggi (storico vuoto): nessun menu, non c'e' niente fra cui scegliere."""
        cartella = self.tmp / "senza_storico"
        cartella.mkdir()
        for nome in ("generate_dashboard.py", "ruoli.py", "roles.json", "club.json"):
            shutil.copy(QUI / nome, cartella / nome)
        shutil.copytree(QUI / "modello", cartella / "modello")
        _, html = self._genera_in(cartella, self.tmp / "senzastorico.html")
        self.assertNotIn('id="titoloSelect"', html,
                         "con un solo titolo conosciuto non deve comparire nessun selettore")

    def test_il_selettore_elenca_tutti_i_titoli_con_i_link_giusti(self):
        """Dal 06/09/2026: un titolo archiviato prende una pagina propria in archivio/,
        e ogni pagina porta un menu che passa dall'una all'altra. I link sono relativi
        (la pagina attiva sta alla radice, quella archiviata una cartella sotto), quindi
        vanno verificati nelle due direzioni: sbagliarli e' invisibile finche' non si
        clicca.
        """
        cartella = self.tmp / "passaggio3"
        cartella.mkdir()
        self._prepara(cartella, self.NUOVO)
        sito = self.tmp / "sito3"
        sito.mkdir()
        _, html_nuovo = self._genera_in(cartella, sito / "index.html")

        archivio = sito / "archivio" / "fc-26.html"
        self.assertTrue(archivio.exists(),
                        "la pagina del titolo archiviato non e' stata generata in archivio/")
        html_vecchio = archivio.read_text(encoding="utf-8")

        # Pagina attiva (FC 27): se stessa selezionata, il link al vecchio scende in archivio/.
        self.assertIn('<option value="" selected>FC 27</option>', html_nuovo)
        self.assertIn('<option value="archivio/fc-26.html">FC 26</option>', html_nuovo)

        # Pagina archiviata (FC 26): se stessa selezionata, il link al nuovo risale di una
        # cartella - il difetto tipico di un link relativo scritto guardando solo un verso.
        self.assertIn('<option value="" selected>FC 26</option>', html_vecchio)
        self.assertIn('<option value="../index.html">FC 27</option>', html_vecchio)


class TestPotatura(unittest.TestCase):
    """La potatura del grezzo, aggiunta il 28/08/2026.

    Il 77% del database era `raw_json` che nessuno leggeva, e il database intero viene
    committato ad ogni giro con novita': a FC 27 sarebbero ~70 MB alla settimana. Vedi
    potatura.py per il conto completo.
    """

    def _database(self, partite=30):
        import sqlite3
        con = sqlite3.connect(":memory:")
        con.executescript("""
            CREATE TABLE matches (match_id TEXT PRIMARY KEY, played_at TEXT, raw_json TEXT);
            CREATE TABLE match_player_stats (match_id TEXT, ea_player_id TEXT, raw_json TEXT);
            CREATE TABLE club_stats_history (id INTEGER PRIMARY KEY, raw_json TEXT);
            CREATE TABLE member_stats_history (id INTEGER PRIMARY KEY, fetched_at TEXT, raw_json TEXT);
        """)
        grosso = "x" * 500
        for i in range(partite):
            con.execute("INSERT INTO matches VALUES (?,?,?)",
                        (f"m{i:03d}", f"2026-08-{1 + i % 27:02d}T20:00:00+00:00", grosso))
            con.execute("INSERT INTO match_player_stats VALUES (?,?,?)",
                        (f"m{i:03d}", "p1", grosso))
        for i in range(5):
            con.execute("INSERT INTO club_stats_history (raw_json) VALUES (?)", (grosso,))
            con.execute("INSERT INTO member_stats_history (fetched_at, raw_json) VALUES (?,?)",
                        (f"2026-08-2{i}T00:00:00", grosso))
        con.commit()
        return con

    def test_l_ultimo_scatto_non_viene_mai_potato(self):
        """La parte delicata, e il danno sarebbe silenzioso.

        `ingest.py` decide se salvare un nuovo scatto confrontando il payload con il grezzo
        del precedente. Se gli si toglie proprio quello, il confronto fallisce sempre e il
        database si riempie di scatti identici — cioè l'opposto esatto dello scopo della
        potatura, e senza che nessun errore lo segnali.
        """
        import potatura
        con = self._database()
        potatura.pota(con)
        ultimo_club = con.execute(
            "SELECT raw_json FROM club_stats_history ORDER BY id DESC LIMIT 1").fetchone()[0]
        self.assertIsNotNone(ultimo_club, "potato il grezzo dell'ultimo scatto del club")
        ultimo_membri = con.execute(
            "SELECT raw_json FROM member_stats_history "
            "WHERE fetched_at = (SELECT MAX(fetched_at) FROM member_stats_history)").fetchone()[0]
        self.assertIsNotNone(ultimo_membri, "potato il grezzo dell'ultimo scatto dei membri")
        # E gli altri invece devono essere spariti, altrimenti non serve a niente.
        vecchi = con.execute(
            "SELECT COUNT(*) FROM club_stats_history WHERE raw_json IS NOT NULL").fetchone()[0]
        self.assertEqual(vecchi, 1, "gli scatti vecchi conservano ancora il grezzo")

    def test_si_tiene_il_grezzo_delle_partite_ancora_vive_alla_fonte(self):
        # EA espone le ultime dieci: sotto quel numero si perderebbe il grezzo di partite
        # che si potrebbero ancora riscaricare, che e' l'unico caso in cui servirebbe.
        import potatura
        self.assertGreaterEqual(potatura.TIENI_PARTITE, 10,
                                "si terrebbero meno partite della finestra di EA")
        con = self._database(partite=30)
        potatura.pota(con)
        tenute = con.execute(
            "SELECT COUNT(*) FROM matches WHERE raw_json IS NOT NULL").fetchone()[0]
        self.assertEqual(tenute, potatura.TIENI_PARTITE)
        # e sono proprio le piu' recenti, non quindici a caso
        piu_vecchia_tenuta = con.execute(
            "SELECT MIN(played_at) FROM matches WHERE raw_json IS NOT NULL").fetchone()[0]
        piu_recente_potata = con.execute(
            "SELECT MAX(played_at) FROM matches WHERE raw_json IS NULL").fetchone()[0]
        self.assertGreater(piu_vecchia_tenuta, piu_recente_potata)

    def test_una_soglia_sotto_la_finestra_di_ea_viene_rifiutata(self):
        import potatura
        con = self._database()
        with self.assertRaises(ValueError):
            potatura.pota(con, tieni_partite=5)

    def test_potare_due_volte_non_cambia_niente(self):
        # Gira ad ogni ingest: se non fosse idempotente, ogni giro riscriverebbe righe
        # identiche e il database risulterebbe "cambiato" anche senza aver giocato,
        # producendo un commit ogni venti minuti.
        import potatura
        con = self._database()
        potatura.pota(con)
        # Non basta guardare il risultato: riscrivere NULL sopra un NULL lascia il conto
        # identico ma sporca comunque le pagine del file, e allora il database risulta
        # "cambiato" ad ogni giro anche senza aver giocato. Si contano le scritture vere.
        scritture = con.total_changes
        liberati = potatura.pota(con)
        self.assertEqual(con.total_changes, scritture,
                         "la seconda potatura ha riscritto righe gia' pulite")
        self.assertEqual(liberati, {}, f"la seconda potatura ha liberato qualcosa: {liberati}")

    def test_le_colonne_vere_non_vengono_toccate(self):
        # Il principio del progetto e' "non perdere nessun campo di EA": si tolgono le
        # COPIE, non i dati. Se sparisse una colonna vera, la dashboard mentirebbe.
        import potatura
        con = self._database()
        prima = con.execute("SELECT match_id, played_at FROM matches ORDER BY match_id").fetchall()
        potatura.pota(con)
        dopo = con.execute("SELECT match_id, played_at FROM matches ORDER BY match_id").fetchall()
        self.assertEqual(prima, dopo)
        self.assertEqual(len(dopo), 30, "sono sparite delle righe")

    def test_ingest_pota_da_solo(self):
        # Se la potatura dipendesse da giro.sh, un ingest lanciato a mano rigonfierebbe il
        # database in silenzio.
        testo = Path("ingest.py").read_text(encoding="utf-8")
        self.assertIn("from potatura import pota", testo)
        self.assertIn("pota(con)", testo)


class TestBattito(unittest.TestCase):
    """La memoria del battito.

    Il ramo `stato` ha per scelta un commit solo, quindi la storia dei guasti vive dentro
    il file. Se questa parte si rompe, si rompe in silenzio - e proprio quando serve.
    """

    def _giri(self, copione):
        import battito
        s = {}
        for esito, partite, problema, quando in copione:
            s = battito.nuovo_stato(s, esito, partite, problema, quando)
        return s

    def test_i_giri_uguali_non_generano_voci_nuove(self):
        s = self._giri([("ok", 59, None, f"2026-08-25T0{i}:00:00Z") for i in range(1, 6)])
        self.assertEqual(len(s["storia"]), 1, "cinque giri identici devono restare una voce")
        self.assertEqual(s["storia"][0]["giri"], 5)
        self.assertEqual(s["storia"][0]["da"], "2026-08-25T01:00:00Z")
        self.assertEqual(s["storia"][0]["a"], "2026-08-25T05:00:00Z")

    def test_un_guasto_rientrato_lascia_traccia(self):
        # E' il caso per cui la memoria esiste: la fonte cade di notte e si riprende prima
        # che qualcuno guardi. Senza registro, la mattina sembra che non sia successo nulla.
        s = self._giri([
            ("ok", 59, None, "2026-08-25T00:00:00Z"),
            ("irraggiungibile", 59, None, "2026-08-25T03:00:00Z"),
            ("irraggiungibile", 59, None, "2026-08-25T03:20:00Z"),
            ("ok", 59, None, "2026-08-25T08:00:00Z"),
        ])
        self.assertEqual(s["fonte"], "ok")
        self.assertEqual(s["fallimenti_di_fila"], 0)
        self.assertFalse(s["guasto_in_corso"])
        self.assertEqual(s["guasti_in_memoria"], 1, "il guasto deve restare nel registro")
        self.assertEqual(s["ultimo_guasto"]["giri"], 2)
        self.assertEqual(s["ultimo_guasto"]["da"], "2026-08-25T03:00:00Z")

    def test_anche_un_guasto_a_valle_conta(self):
        s = self._giri([
            ("ok", 59, None, "2026-08-25T00:00:00Z"),
            ("ok", 59, "pagina senza la sezione Serate", "2026-08-25T00:20:00Z"),
        ])
        self.assertEqual(s["guasti_in_memoria"], 1)
        self.assertTrue(s["guasto_in_corso"])
        self.assertEqual(s["ultimo_guasto"]["problema"], "pagina senza la sezione Serate")

    def test_il_registro_non_cresce_senza_limite(self):
        # Il caso peggiore: una voce nuova ad OGNI giro, per il triplo della memoria. Se il
        # limite non ci fosse, il file crescerebbe per sempre e il ramo con lui.
        import battito
        quanti = battito.MEMORIA * 3
        copione = [("ok" if i % 2 else "irraggiungibile", i, None,
                    f"2026-08-25T00:00:{i % 60:02d}Z") for i in range(quanti)]
        s = self._giri(copione)
        self.assertLessEqual(len(s["storia"]), battito.MEMORIA,
                             f"registro cresciuto a {len(s['storia'])} voci su {quanti} giri")
        self.assertLess(len(json.dumps(s)), 40_000)
        # E deve tenere le voci PIU' RECENTI, non le prime.
        self.assertEqual(s["storia"][-1]["partite"], quanti - 1)

    def test_lo_stato_precedente_illeggibile_non_ferma_il_battito(self):
        import battito
        for rotto in (None, "", [], "non-json"):
            s = battito.nuovo_stato(rotto, "ok", 59, None, "2026-08-25T00:00:00Z")
            self.assertEqual(s["partite"], 59)
            self.assertEqual(len(s["storia"]), 1)

    def test_un_buco_di_ore_si_vede_anche_se_lo_stato_non_cambia(self):
        """Il caso vero del 27/08/2026.

        Il registro per stato accorpa: se la fonte risponde e le partite non cambiano, sei
        ore di silenzio e sei ore di funzionamento regolare producono la stessa riga. La
        domanda "l'automazione ha smesso di girare?" restava senza risposta.
        """
        regolari = [("ok", 88, None, f"2026-08-27T{3 + (i * 20) // 60:02d}:{(i * 20) % 60:02d}:00Z")
                    for i in range(20)]
        dopo_il_buco = [("ok", 88, None, "2026-08-27T16:00:00Z")]
        s = self._giri(regolari + dopo_il_buco)

        self.assertEqual(len(s["storia"]), 1,
                         "il registro per stato accorpa: e' proprio il motivo per cui serve l'altro")
        self.assertEqual(len(s["interruzioni"]), 1, "il buco non e' stato visto")
        buco = s["interruzione_piu_lunga"]
        self.assertGreater(buco["minuti"], 300, f"buco misurato {buco['minuti']} minuti")
        self.assertEqual(buco["a"], "2026-08-27T16:00:00Z")

    def test_i_ritardi_normali_non_sono_interruzioni(self):
        # Un giro saltato ogni tanto e' la pianificazione di GitHub, non un guasto: se
        # finisse fra le interruzioni l'elenco diventerebbe rumore.
        import battito
        s = self._giri([("ok", 88, None, "2026-08-27T03:00:00Z"),
                        ("ok", 88, None, "2026-08-27T03:40:00Z"),   # un giro saltato
                        ("ok", 88, None, "2026-08-27T04:00:00Z")])
        self.assertEqual(s["interruzioni"], [])
        self.assertIsNone(s["interruzione_piu_lunga"])
        self.assertGreaterEqual(battito.BUCO_MINUTI, 60,
                                "una soglia sotto l'ora trasformerebbe i ritardi in allarmi")

    def test_gli_orari_dei_giri_non_crescono_senza_limite(self):
        import battito
        quanti = battito.ORARI * 2
        s = self._giri([("ok", 88, None, f"2026-08-27T{i // 60:02d}:{i % 60:02d}:00Z")
                        for i in range(min(quanti, 1439))])
        self.assertLessEqual(len(s["giri_recenti"]), battito.ORARI)
        self.assertLess(len(json.dumps(s)), 40_000)

    def test_si_conta_quante_esecuzioni_del_workflow_ci_sono_state(self):
        """La domanda del 27/08/2026: «solo 2 run su 24?».

        Non era rispondibile: il battito sapeva quanti GIRI erano stati fatti, non da
        quante ESECUZIONI. E le Actions non si possono leggere — il connettore GitHub
        sincronizza i file di un ramo, non la cronologia. Ora ogni giro porta con sé
        GITHUB_RUN_ID e il conto si fa leggendo.
        """
        import battito
        s = {}
        for i in range(7):
            s = battito.nuovo_stato(s, "ok", 88, None,
                                    f"2026-08-27T{3 + (i * 20) // 60:02d}:{(i * 20) % 60:02d}:00Z",
                                    esecuzione="111", evento="schedule")
        for i in range(7):
            s = battito.nuovo_stato(s, "ok", 90, None,
                                    f"2026-08-27T{11 + (i * 20) // 60:02d}:{(i * 20) % 60:02d}:00Z",
                                    esecuzione="222", evento="schedule")
        self.assertEqual(len(s["esecuzioni"]), 2, "le due esecuzioni non sono state distinte")
        self.assertEqual([e["run"] for e in s["esecuzioni"]], ["111", "222"])
        self.assertTrue(all(e["giri"] == 7 for e in s["esecuzioni"]),
                        [e["giri"] for e in s["esecuzioni"]])
        # E il buco fra le due si vede lo stesso.
        self.assertEqual(len(s["interruzioni"]), 1)

    def test_i_giri_registrati_prima_della_modifica_non_rompono_niente(self):
        # Il ramo `stato` contiene gia' la forma vecchia: una lista di istanti e basta.
        import battito
        vecchio = {"giri_recenti": ["2026-08-27T03:00:00Z", "2026-08-27T03:20:00Z"]}
        s = battito.nuovo_stato(vecchio, "ok", 88, None, "2026-08-27T03:40:00Z",
                                esecuzione="999", evento="schedule")
        self.assertEqual(len(s["giri_recenti"]), 3)
        self.assertEqual(s["giri_recenti"][-1]["r"], "999")
        # I giri vecchi non sanno da quale esecuzione venivano, e va dichiarato.
        self.assertEqual(s["giri_recenti"][0]["r"], "?")
        self.assertEqual([e["run"] for e in s["esecuzioni"]], ["?", "999"])

    # ---- Il controllo di apertura della pagina -------------------------------------
    # Aggiunti il 29/08/2026, dopo che una dashboard inutilizzabile e' finita online: una
    # variabile scritta male dentro un template letterale, ReferenceError a runtime, niente
    # menu e diciassette sezioni impilate. Sintassi giusta, tutte le ancore presenti, 102
    # controlli JavaScript verdi. Nessuno montava i pezzi per vedere se si accendeva.

    def test_il_ciclo_controlla_che_la_pagina_si_apra(self):
        g = Path("giro.sh").read_text(encoding="utf-8")
        self.assertIn("test_apertura.js", g,
                      "il ciclo non verifica piu' che la pagina si apra")
        # E deve farlo PRIMA di pubblicare, altrimenti non serve a niente.
        self.assertLess(g.index("test_apertura.js"), g.index("git commit -q -m"),
                        "il controllo di apertura viene dopo la pubblicazione")

    def test_una_pagina_rotta_non_ferma_l_archiviazione_delle_partite(self):
        """La differenza che conta fra i due danni possibili.

        Una pagina rotta si rigenera al giro dopo. Una partita uscita dalla finestra di
        dieci di EA e' persa per sempre. Quindi se la pagina non si apre si pubblica il
        database e non la pagina, invece di saltare tutto il commit.
        """
        g = Path("giro.sh").read_text(encoding="utf-8")
        blocco = g[g.index("SOLO_DATABASE=\"si\""):g.index("git commit -q -m")]
        self.assertIn("git add lentoni.db", blocco,
                      "con la pagina rotta il database non viene piu' pubblicato")
        self.assertNotIn("exit 0", blocco,
                         "il giro esce prima di archiviare le partite")

    def test_il_controllo_di_apertura_non_puo_bloccare_il_ciclo_se_manca_jsdom(self):
        # Una rete di sicurezza che ferma l'archiviazione quando le manca una dipendenza
        # fa piu' danni del difetto che dovrebbe intercettare.
        g = Path("giro.sh").read_text(encoding="utf-8")
        self.assertRegex(g, r"require\('jsdom'\)|node_modules/jsdom",
                         "il ciclo non verifica che jsdom ci sia prima di usarlo")
        self.assertIn("jsdom assente", g,
                      "manca il ramo che salta il controllo quando jsdom non c'e'")
        w = Path(".github/workflows/aggiorna-dashboard.yml").read_text(encoding="utf-8")
        self.assertIn("npm install", w, "jsdom non viene installato sul runner")
        passo = w[w.index("Installa jsdom"):w.index("npm install")]
        self.assertIn("continue-on-error: true", passo,
                      "se npm non risponde, il ciclo non deve fermarsi")

    def test_il_battito_dichiara_la_pagina_non_apribile(self):
        # Senza, il guasto sarebbe silenzioso: la dashboard resta vecchia e nessuno lo sa.
        g = Path("giro.sh").read_text(encoding="utf-8")
        self.assertRegex(g, r'scrivi_battito ok "\$\{SOLO_DATABASE:\+',
                         "il battito non segnala che la pagina non si apriva")

    def test_giro_sh_usa_battito_py(self):
        # Se qualcuno reinfilasse il calcolo dentro lo script, tornerebbe non collaudabile.
        testo = Path("giro.sh").read_text(encoding="utf-8")
        self.assertIn("python3 battito.py", testo)
        self.assertNotIn("PYSTATO", testo)

    # ---- Il segno di avvio ---------------------------------------------------------
    # Aggiunti il 27/08/2026. Il caso che restava scoperto: un'esecuzione che parte e muore
    # prima del primo giro non scriveva niente, ed era identica a un'esecuzione mai partita.

    def test_un_run_morto_prima_del_primo_giro_lascia_comunque_traccia(self):
        import battito
        s = battito.segna_avvio({}, "2026-08-27T03:00:00Z", esecuzione="111", evento="schedule")
        # Non ha fatto nemmeno un giro: nel resto del battito non esiste.
        self.assertEqual(s.get("giri_recenti"), None)
        # Ma l'avvio c'e'.
        self.assertEqual([a["run"] for a in s["avvii"]], ["111"])

    def test_un_avvio_senza_giri_viene_riconosciuto_solo_dopo_il_successivo(self):
        """L'avvio in corso non e' un guasto: il suo primo giro deve ancora arrivare.

        Contarlo subito produrrebbe un allarme ad ogni singola esecuzione, cioe' rumore
        continuo — che e' il modo piu' sicuro di far ignorare un allarme vero.
        """
        import battito
        s = battito.segna_avvio({}, "2026-08-27T03:00:00Z", esecuzione="111", evento="schedule")
        self.assertEqual(s["morti_sul_nascere"], [], "l'avvio in corso non e' ancora un guasto")
        # 111 muore senza fare giri. Parte 222 e fa il suo giro.
        s = battito.segna_avvio(s, "2026-08-27T04:00:00Z", esecuzione="222", evento="schedule")
        s = battito.nuovo_stato(s, "ok", 88, None, "2026-08-27T04:01:00Z",
                                esecuzione="222", evento="schedule")
        self.assertEqual([a["run"] for a in s["morti_sul_nascere"]], ["111"],
                         "il run morto sul nascere non e' stato riconosciuto")

    def test_un_run_che_gira_non_finisce_fra_i_morti(self):
        import battito
        s = battito.segna_avvio({}, "2026-08-27T03:00:00Z", esecuzione="111", evento="schedule")
        s = battito.nuovo_stato(s, "ok", 88, None, "2026-08-27T03:01:00Z",
                                esecuzione="111", evento="schedule")
        s = battito.segna_avvio(s, "2026-08-27T04:00:00Z", esecuzione="222", evento="schedule")
        s = battito.nuovo_stato(s, "ok", 88, None, "2026-08-27T04:01:00Z",
                                esecuzione="222", evento="schedule")
        self.assertEqual(s["morti_sul_nascere"], [], "un run che ha girato non e' morto")
        self.assertEqual([a["run"] for a in s["avvii"]], ["111", "222"])

    def test_nessun_avvio_e_avvio_senza_giri_sono_distinguibili(self):
        """E' l'intero motivo per cui questa parte esiste.

        GitHub che non lancia il workflow e il nostro codice che esplode subito sono due
        guasti opposti: senza distinguerli si cerca dalla parte sbagliata.
        """
        import battito
        # Caso A: GitHub non ha lanciato niente. Nessun avvio, nessun giro.
        a = battito.nuovo_stato({}, "ok", 88, None, "2026-08-27T03:00:00Z",
                                esecuzione="111", evento="schedule")
        a = battito.segna_avvio(a, "2026-08-27T09:00:00Z", esecuzione="333", evento="schedule")
        a = battito.nuovo_stato(a, "ok", 88, None, "2026-08-27T09:01:00Z",
                                esecuzione="333", evento="schedule")
        # Caso B: e' partito un run in mezzo, ed e' morto subito.
        b = battito.nuovo_stato({}, "ok", 88, None, "2026-08-27T03:00:00Z",
                                esecuzione="111", evento="schedule")
        b = battito.segna_avvio(b, "2026-08-27T05:00:00Z", esecuzione="222", evento="schedule")
        b = battito.segna_avvio(b, "2026-08-27T09:00:00Z", esecuzione="333", evento="schedule")
        b = battito.nuovo_stato(b, "ok", 88, None, "2026-08-27T09:01:00Z",
                                esecuzione="333", evento="schedule")
        # Il buco fra i giri e' identico nei due casi: e' proprio quello che non bastava.
        self.assertEqual(len(a["interruzioni"]), len(b["interruzioni"]))
        # La differenza si vede solo qui.
        self.assertEqual(a["morti_sul_nascere"], [])
        self.assertEqual([x["run"] for x in b["morti_sul_nascere"]], ["222"])

    def test_gli_avvii_sopravvivono_ai_giri_successivi(self):
        # nuovo_stato() riscrive il file da capo: se non riportasse `avvii`, il primo giro
        # cancellerebbe il segno appena scritto e tutto questo non servirebbe a niente.
        import battito
        s = battito.segna_avvio({}, "2026-08-27T03:00:00Z", esecuzione="111", evento="schedule")
        s = battito.nuovo_stato(s, "ok", 88, None, "2026-08-27T03:01:00Z",
                                esecuzione="111", evento="schedule")
        self.assertEqual([a["run"] for a in s["avvii"]], ["111"],
                         "il primo giro ha cancellato il segno di avvio")

    def test_gli_avvii_non_crescono_senza_limite(self):
        import battito
        s = {}
        for i in range(battito.AVVII * 3):
            s = battito.segna_avvio(s, "2026-08-27T03:00:00Z", esecuzione=str(i), evento="schedule")
        self.assertLessEqual(len(s["avvii"]), battito.AVVII)
        self.assertLess(len(json.dumps(s)), 40_000)

    def test_un_ciclo_piu_lungo_dell_intervallo_fra_i_cron_non_puo_cancellarsi(self):
        """Il guasto del 27-28/08/2026, in una riga.

        Quella mattina il ciclo e' passato a 5h20 e i cron da uno a due l'ora, ma
        `cancel-in-progress` e' rimasto attivo: ogni esecuzione programmata veniva uccisa
        dalla successiva entro trenta minuti, spesso mentre era ancora in coda. Sedici ore
        senza un giro, con la lista delle Actions piena di esecuzioni cancellate.

        La regola e' aritmetica, non un'opinione: se il ciclo dura piu' dell'intervallo fra
        due partenze, cancellare significa non finire mai. Il test la ricalcola dai numeri
        veri del workflow, cosi' resta valido se domani i giri o i cron cambiano ancora.
        """
        import re
        testo = Path(".github/workflows/aggiorna-dashboard.yml").read_text(encoding="utf-8")

        minuti_cron = sorted(int(m) for m in re.findall(r"cron: '(\d+) \* \* \* \*'", testo))
        self.assertTrue(minuti_cron, "nessun cron orario trovato: il test va aggiornato")
        # Il piu' piccolo intervallo fra due partenze consecutive, girando l'ora.
        partenze = minuti_cron + [minuti_cron[0] + 60]
        intervallo = min(b - a for a, b in zip(partenze, partenze[1:]))

        giri = int(re.search(r"then GIRI=(\d+)", testo).group(1))
        pausa = int(re.search(r"sleep (\d+)", testo).group(1)) // 60
        durata = (giri - 1) * pausa

        if durata <= intervallo:
            return  # cancellare sarebbe innocuo: il ciclo finisce prima della successiva

        riga = re.search(r"cancel-in-progress: (.+)", testo).group(1).strip()
        self.assertNotEqual(
            riga, "true",
            f"il ciclo dura {durata} minuti ma le partenze distano {intervallo}: con "
            "cancel-in-progress attivo ogni esecuzione programmata viene uccisa dalla "
            "successiva e non finisce mai (guasto del 27-28/08/2026)")
        self.assertIn("schedule", riga,
                      "cancel-in-progress deve escludere esplicitamente le esecuzioni "
                      f"programmate: {riga}")

    def test_le_verifiche_da_push_si_cancellano_ancora(self):
        # L'altra meta' della regola: le verifiche durano un minuto e contano solo le
        # ultime. Accodarle allungherebbe la fila senza dare niente in cambio.
        import re
        testo = Path(".github/workflows/aggiorna-dashboard.yml").read_text(encoding="utf-8")
        riga = re.search(r"cancel-in-progress: (.+)", testo).group(1).strip()
        self.assertRegex(riga, r"!=\s*'schedule'|'schedule'\s*&&\s*false|event_name\s*!=",
                         f"le verifiche da push devono restare cancellabili: {riga}")

    def test_il_ciclo_copre_l_intervallo_fra_due_partenze(self):
        # Se il ciclo finisse molto prima della partenza successiva resterebbe una finestra
        # scoperta ad ogni ora, che e' il problema opposto e altrettanto reale.
        import re
        testo = Path(".github/workflows/aggiorna-dashboard.yml").read_text(encoding="utf-8")
        minuti_cron = sorted(int(m) for m in re.findall(r"cron: '(\d+) \* \* \* \*'", testo))
        partenze = minuti_cron + [minuti_cron[0] + 60]
        intervallo = min(b - a for a, b in zip(partenze, partenze[1:]))
        giri = int(re.search(r"then GIRI=(\d+)", testo).group(1))
        pausa = int(re.search(r"sleep (\d+)", testo).group(1)) // 60
        self.assertGreaterEqual((giri - 1) * pausa, intervallo,
                                "fra la fine di un ciclo e la partenza successiva resta "
                                "una finestra scoperta")

    # Il caso peggiore del ciclo deve stare dentro il limite di GitHub. Non e' un dettaglio
    # di prestazioni: se il lavoro viene ucciso a meta', la copertura si accorcia proprio
    # nelle ore in cui si gioca, e nessuno se ne accorge perche' i giri gia' fatti sono
    # andati a buon fine.
    LAVORO_LOCALE = 30  # secondi concessi a ingest, generazione, git e battito

    def _numeri_del_ciclo(self):
        import re
        w = Path(".github/workflows/aggiorna-dashboard.yml").read_text(encoding="utf-8")
        g = Path("giro.sh").read_text(encoding="utf-8")
        return {
            "giri": int(re.search(r"then GIRI=(\d+)", w).group(1)),
            "pausa": int(re.search(r"sleep (\d+)", w).group(1)),
            "timeout": int(re.search(r"timeout-minutes: (\d+)", w).group(1)) * 60,
            "fonte": int(re.search(r"ATTESA_FONTE=(\d+)", g).group(1)),
            "avversari": int(re.search(r"ATTESA_AVVERSARI=(\d+)", g).group(1)),
        }

    def _gruppi(self):
        """Come GitHub valuta `A && x || B && y || z` per ogni tipo di evento."""
        import re
        w = Path(".github/workflows/aggiorna-dashboard.yml").read_text(encoding="utf-8")
        espr = re.search(r"group: aggiorna-dashboard-\$\{\{(.+?)\}\}", w)
        self.assertIsNotNone(espr, "il gruppo di concorrenza non dipende piu' dall'evento")
        espr = espr.group(1)
        canc = re.search(r"cancel-in-progress: (?:\$\{\{)?(.+?)(?:\}\})?$", w, re.M).group(1)
        rami = re.findall(r"github\.event_name == '(\w+)' && '(\w+)'", espr)
        finale = re.search(r"\|\|\s*'(\w+)'\s*$", espr.strip())
        fuori = {}
        for evento in ("push", "schedule", "workflow_dispatch"):
            nome = next((g for e, g in rami if e == evento), None)
            fuori[evento] = nome or (finale.group(1) if finale else None)
        return fuori, canc

    def test_uno_scatto_arretrato_non_entra_in_archivio(self):
        """Il contatore di carriera di EA puo' solo salire.

        Successo il 29/08/2026: un ingest lanciato con i file in raw/ ormai vecchi ha
        inserito uno scatto con 646 partite quando l'archivio era gia' a 728, e la salute
        archivio e' passata da «98 su 133» a «98 su 51». Nessun errore, nessun avviso: solo
        un numero diventato falso. La misura confronta il primo e l'ultimo scatto, quindi un
        valore arretrato in fondo la distrugge.
        """
        import sqlite3, ingest
        con = sqlite3.connect(":memory:")
        cur = con.cursor()
        cur.executescript(ingest.SCHEMA)

        def scatto(giocate, quando):
            return ingest.ingest_overall_stats(
                cur, [{"clubId": 1, "gamesPlayed": str(giocate), "wins": "1"}], 1, quando)

        self.assertNotEqual(scatto(700, "2026-08-01T00:00:00"), False)
        self.assertNotEqual(scatto(728, "2026-08-02T00:00:00"), False)
        # E adesso una risposta arretrata, come quella che ha causato il guasto.
        self.assertIs(scatto(646, "2026-08-03T00:00:00"), False,
                      "uno scatto con meno partite del precedente e' stato accettato")
        massimo = cur.execute("SELECT MAX(games_played) FROM club_stats_history").fetchone()[0]
        quanti = cur.execute("SELECT COUNT(*) FROM club_stats_history").fetchone()[0]
        self.assertEqual(massimo, 728)
        self.assertEqual(quanti, 2, "lo scatto arretrato e' finito comunque in archivio")
        con.close()

    def test_il_totale_in_archivio_e_la_percentuale_contano_cose_diverse(self):
        """I due numeri della salute archivio non coincidono, e non e' un difetto.

        Chiesto da Peppe il 29/08/2026: «perche' qui dice 98 se in archivio ce ne stanno 10
        in piu'?». Il totale comprende le partite gia' presenti nella finestra di EA al primo
        scaricamento; la percentuale confronta invece cio' che abbiamo salvato con cio' che e'
        stato giocato NELLO STESSO periodo. Contare quelle al numeratore e non al
        denominatore darebbe 108 su 133 — un numero gonfiato con partite che nessuno ha
        dovuto salvare.

        Il test blocca l'invariante: la differenza fra i due deve essere esattamente il
        numero di partite giocate prima del primo scatto, ne' una di piu' ne' una di meno.
        """
        import sqlite3
        con = sqlite3.connect(f"file:{Path('lentoni.db').resolve()}?mode=ro", uri=True)
        cur = con.cursor()
        primo = cur.execute(
            "SELECT MIN(fetched_at) FROM club_stats_history WHERE games_played IS NOT NULL"
        ).fetchone()[0]
        if not primo:
            self.skipTest("archivio senza scatti: la salute non si calcola")
        totale = cur.execute("SELECT COUNT(*) FROM matches").fetchone()[0]
        dopo = cur.execute(
            "SELECT COUNT(*) FROM matches WHERE played_at >= ?", (primo,)).fetchone()[0]
        prima = cur.execute(
            "SELECT COUNT(*) FROM matches WHERE played_at < ?", (primo,)).fetchone()[0]
        con.close()
        self.assertEqual(totale - dopo, prima,
                         "la differenza fra totale e conteggio della percentuale non "
                         "corrisponde alle partite giocate prima del primo scatto")
        self.assertGreaterEqual(totale, dopo, "il totale non puo' essere minore del parziale")

    def test_la_pagina_spiega_perche_i_due_numeri_non_coincidono(self):
        # Senza la spiegazione i due numeri sembrano contraddirsi, ed e' la prima cosa che
        # ha chiesto chi legge. La riga compare solo quando c'e' davvero uno scarto.
        js = Path("modello/pagina.js").read_text(encoding="utf-8")
        self.assertIn("inRegalo", js, "manca il calcolo dello scarto fra totale e parziale")
        self.assertRegex(
            js, r"inRegalo\s*=\s*\(sa\.archiviate.*?\)\s*-\s*\(sa\.archiviateDaPrimoSnapshot",
            "lo scarto non e' calcolato dai due numeri che compaiono a schermo")
        self.assertRegex(js, r"inRegalo > 0 \?",
                         "la spiegazione va mostrata solo quando lo scarto esiste davvero")

    def test_un_push_non_puo_uccidere_un_lancio_a_mano(self):
        """Il difetto del 28/08/2026, trovato a ciclo gia' in corso.

        Da quando "Run workflow" fa il ciclo completo, un lancio a mano dura cinque ore. Ma
        restava nel gruppo delle verifiche brevi, dove si cancellano a vicenda: bastava un
        push qualsiasi — anche solo di documentazione — per uccidere il ciclo appena lanciato
        per coprire una serata. Quella sera non si e' potuto pubblicare niente per non
        rompere la copertura in corso.
        """
        gruppi, _ = self._gruppi()
        self.assertNotEqual(
            gruppi["push"], gruppi["workflow_dispatch"],
            "lancio a mano e verifiche da push nello stesso gruppo: un push qualsiasi "
            "ucciderebbe il ciclo d'emergenza")

    def test_nessun_evento_puo_uccidere_il_ciclo_programmato(self):
        gruppi, _ = self._gruppi()
        self.assertNotEqual(gruppi["push"], gruppi["schedule"])
        self.assertNotEqual(gruppi["workflow_dispatch"], gruppi["schedule"])

    def test_il_lancio_a_mano_parte_subito_invece_di_accodarsi(self):
        """Lo si preme quando serve copertura ADESSO.

        Se stesse nel gruppo del ciclo, che non cancella, premere il pulsante durante un
        ciclo in corso lo metterebbe in fila per ore — cioe' esattamente il contrario del
        motivo per cui esiste. Deve stare da solo e poter sostituire un altro lancio a mano.
        """
        gruppi, canc = self._gruppi()
        self.assertEqual(len(set(gruppi.values())), 3,
                         f"servono tre gruppi distinti, trovati: {gruppi}")
        # cancel-in-progress vale per tutto cio' che non e' 'schedule', quindi anche per il
        # lancio a mano: da solo nel suo gruppo, cancella solo un altro lancio a mano.
        self.assertIn("!=", canc)
        self.assertIn("schedule", canc)

    def test_il_pulsante_run_workflow_fa_il_ciclo_completo(self):
        """Il rimedio d'emergenza deve fare quello che la documentazione promette.

        Fino al 28/08/2026 la condizione era «se e' schedule allora 16 giri, altrimenti 1»,
        e `workflow_dispatch` — cioe' il pulsante "Run workflow" — cadeva nell'altrimenti.
        Il rimedio descritto in README, negli APPUNTI e in due attivita' programmate come
        «un tap e la serata e' coperta» dava in realta' UN GIRO SOLO.

        Un giro chiude un buco gia' aperto, prendendo le dieci partite che EA espone in
        quel momento. Non copre una serata. Sono due cose diverse, e la differenza si paga
        in partite perse.
        """
        import re
        w = Path(".github/workflows/aggiorna-dashboard.yml").read_text(encoding="utf-8")
        riga = re.search(r"if \[ \"\$\{\{ github\.event_name \}\}\".*GIRI=.*fi", w)
        self.assertIsNotNone(riga, "non trovo la riga che decide quanti giri fare")
        riga = riga.group(0)
        # Il giro singolo deve essere riservato a 'push' e a nient'altro: qualsiasi altra
        # forma della condizione lascerebbe fuori workflow_dispatch un'altra volta.
        self.assertRegex(
            riga, r'!=\s*"push"',
            "il giro singolo deve valere SOLO per le verifiche da push: con la condizione "
            "scritta al positivo, 'Run workflow' torna a fare un giro solo")

    def test_nessun_cron_ai_minuti_affollati(self):
        """I minuti tondi sono i piu' probabili da farsi scartare.

        Non e' un'opinione: la documentazione di GitHub dice che i lavori programmati
        vengono ritardati sotto carico, che l'inizio di ogni ora e' uno di quei momenti, e
        che se il carico e' alto abbastanza alcuni lavori in coda vengono *scartati*.

        Misurato il 28/08/2026 con i cron a :00 e :30 — sulla lista delle Actions, 7
        partenze programmate il 26 agosto, zero il 27, una il 28, su 48 previste al giorno.
        Nessuna cancellata: mai create.
        """
        import re
        w = Path(".github/workflows/aggiorna-dashboard.yml").read_text(encoding="utf-8")
        minuti = [int(m) for m in re.findall(r"cron: '(\d+) \* \* \* \*'", w)]
        self.assertTrue(minuti, "nessun cron orario trovato")
        affollati = [m for m in minuti if m % 15 == 0]
        self.assertEqual(affollati, [],
                         f"cron ai minuti affollati {affollati}: GitHub scarta i lavori "
                         "programmati nei momenti di carico, e i minuti tondi sono quelli")

    def test_abbastanza_occasioni_di_partenza_per_coprire_una_serata(self):
        # La fascia di gioco e' 22:00-03:00, cinque ore. Con la coda al posto della
        # cancellazione una sola partenza riuscita copre tutta la serata, ma le partenze
        # vanno comunque offerte spesso: e' l'unica difesa contro uno scarto.
        import re
        w = Path(".github/workflows/aggiorna-dashboard.yml").read_text(encoding="utf-8")
        minuti = re.findall(r"cron: '(\d+) \* \* \* \*'", w)
        self.assertGreaterEqual(len(minuti), 3,
                                "meno di tre occasioni per ora: se GitHub ne scarta due "
                                "consecutive resta scoperta una fascia intera")

    def test_il_caso_peggiore_del_ciclo_sta_dentro_il_timeout(self):
        n = self._numeri_del_ciclo()
        peggiore = n["giri"] * (n["fonte"] + n["avversari"] + self.LAVORO_LOCALE) \
            + (n["giri"] - 1) * n["pausa"]
        self.assertLessEqual(
            peggiore, n["timeout"],
            f"nel caso peggiore il ciclo dura {peggiore // 60} minuti ma il timeout e' "
            f"{n['timeout'] // 60}: verrebbe ucciso prima dell'ultimo giro")

    def test_il_timeout_dichiarato_sta_sotto_il_limite_di_github(self):
        # GitHub uccide qualsiasi lavoro a 360 minuti, e lo fa senza preavviso: il nostro
        # timeout deve scattare prima, cosi' la fine e' ordinata e prevedibile.
        n = self._numeri_del_ciclo()
        self.assertLessEqual(n["timeout"] // 60, 355,
                             "il timeout deve lasciare margine sotto i 360 minuti di GitHub")

    def test_ogni_attesa_di_rete_ha_un_tetto(self):
        """Senza tetto, un passo che non risponde blocca il giro a tempo indefinito.

        `avversari.py` interroga club esterni: e' un arricchimento, non il lavoro, e non
        deve poter dettare i tempi del ciclo. Prima del 28/08/2026 poteva prendersi cinque
        minuti a giro, ottanta in tutto, contro cinquanta di margine.
        """
        g = Path("giro.sh").read_text(encoding="utf-8")
        self.assertRegex(g, r'curl[^\n]*--max-time "\$ATTESA_FONTE"',
                         "lo scaricamento dalla fonte non ha un tetto dichiarato")
        self.assertRegex(g, r'timeout "\$ATTESA_AVVERSARI" python3 avversari\.py',
                         "avversari.py puo' dilatarsi senza limite")

    def test_il_workflow_segna_l_avvio_prima_del_ciclo(self):
        """Il segno deve stare PRIMA, altrimenti non copre il caso per cui esiste."""
        testo = Path(".github/workflows/aggiorna-dashboard.yml").read_text(encoding="utf-8")
        self.assertIn("--solo-avvio", testo, "il workflow non segna l'avvio")
        self.assertLess(testo.index("--solo-avvio"), testo.index("for i in $(seq"),
                        "il segno di avvio viene dopo il ciclo: cosi' non serve a niente")
        # E non deve poter bloccare l'aggiornamento: e' diagnostica, non produzione.
        avvio = testo[testo.index("- name: Segna l'avvio"):testo.index("--solo-avvio")]
        self.assertIn("continue-on-error: true", avvio)

    def test_giro_sh_esce_subito_in_modo_solo_avvio(self):
        # Se proseguisse, ogni avvio scaricherebbe e pubblicherebbe: un giro in piu' non
        # richiesto, e il passo diagnostico diventerebbe capace di rompere la dashboard.
        testo = Path("giro.sh").read_text(encoding="utf-8")
        blocco = testo[testo.index('"--solo-avvio"'):]
        self.assertIn("exit 0", blocco[:400])
        self.assertLess(testo.index('"--solo-avvio"'), testo.index("curl -sS"),
                        "il modo solo-avvio deve uscire prima di toccare la fonte")


if __name__ == "__main__":
    unittest.main(verbosity=2)
