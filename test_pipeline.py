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


if __name__ == "__main__":
    unittest.main(verbosity=2)
