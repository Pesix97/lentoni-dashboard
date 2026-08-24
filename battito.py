#!/usr/bin/env python3
"""Lo stato dell'automazione, con memoria di cosa e' successo.

Il battito diceva com'e' adesso e basta. Il ramo `stato` viene riscritto ad ogni giro con
un commit senza genitore, quindi ha sempre **un solo commit**: nessuna storia, per scelta -
cosi' il ramo non cresce mai. Il prezzo pero' era alto: se la fonte cadeva alle 3 di notte
e si riprendeva alle 8, la mattina si trovava tutto verde e il contatore a zero. Del guasto
non restava traccia da nessuna parte.

Non e' un dettaglio: EA espone solo le ultime dieci partite. Se in quelle ore se ne
giocassero undici, una sarebbe persa per sempre - e non ci sarebbe modo di sapere perche'.

La memoria sta quindi dentro il file, non nella storia di git. E' un registro di
**cambiamenti**, non di campionamenti: finche' i giri raccontano la stessa cosa (stessa
fonte, stesse partite, stesso problema) la voce esistente viene allungata e il contatore
dei giri sale. Una voce nuova nasce solo quando qualcosa cambia davvero.

Cosi' il file resta di pochi KB anche dopo mesi, e alla domanda "e' mai andata giu'?" si
risponde leggendo, invece che ricordando.

Uso da riga di comando (e' cosi' che lo chiama giro.sh):
    battito.py <ok|irraggiungibile> <partite> [problema]     # stato precedente su stdin
"""

import json
import sys
from datetime import datetime, timezone

# Quante voci di registro tenere. Ne nasce una solo quando qualcosa cambia, quindi 100
# coprono mesi di funzionamento regolare - e restano poche decine di KB nel caso peggiore,
# cioe' se il sistema oscillasse ad ogni giro.
MEMORIA = 100


def _confrontabile(voce):
    """Le tre cose che, se restano uguali, non meritano una voce nuova."""
    return (voce.get("fonte"), voce.get("partite"), voce.get("problema") or None)


def nuovo_stato(precedente, esito, partite, problema=None, adesso=None):
    """Lo stato aggiornato, a partire da quello di prima.

    `precedente` e' il contenuto di stato.json letto dal ramo, o {} al primo giro.
    """
    adesso = adesso or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    prec = precedente if isinstance(precedente, dict) else {}
    problema = problema or None

    if esito == "ok":
        ultimo_successo, falliti = adesso, 0
    else:
        ultimo_successo = prec.get("ultimo_successo_fonte")
        falliti = int(prec.get("fallimenti_di_fila") or 0) + 1

    voce = {"fonte": esito, "partite": partite, "problema": problema}
    storia = [dict(v) for v in (prec.get("storia") or []) if isinstance(v, dict)]
    if storia and _confrontabile(storia[-1]) == _confrontabile(voce):
        storia[-1]["a"] = adesso
        storia[-1]["giri"] = int(storia[-1].get("giri") or 1) + 1
    else:
        storia.append({**voce, "da": adesso, "a": adesso, "giri": 1})
    storia = storia[-MEMORIA:]

    # Un guasto e' una voce in cui la fonte non rispondeva OPPURE la nostra pipeline si e'
    # rotta a valle. Sono due cose diverse ma per chi guarda contano allo stesso modo:
    # in quel periodo la dashboard non si aggiornava.
    guasti = [v for v in storia if v.get("fonte") != "ok" or v.get("problema")]
    in_corso = bool(guasti) and guasti[-1] is storia[-1]

    return {
        "ultimo_giro": adesso,
        "partite": partite,
        # Da qui in giu': salute della FONTE, non dell'automazione. Sono due guasti diversi
        # e prima erano indistinguibili: se proclubstracker fosse caduto, il ciclo avrebbe
        # continuato a girare scrivendo "dati non scaricati" in un log che nessuno legge, e
        # il battito sarebbe rimasto verde perche' diceva solo "sono vivo".
        "fonte": esito,
        "ultimo_successo_fonte": ultimo_successo,
        "fallimenti_di_fila": falliti,
        # Un guasto a valle dello scaricamento: la fonte risponde ma qualcosa nella nostra
        # pipeline non ha funzionato. Anche questo prima finiva solo in un log non letto.
        "problema": problema,
        # La memoria. `guasti_in_memoria` risponde subito alla domanda che conta senza
        # dover leggere il registro voce per voce.
        "guasti_in_memoria": len(guasti),
        "guasto_in_corso": in_corso,
        "ultimo_guasto": guasti[-1] if guasti else None,
        "storia": storia,
    }


def main():
    if len(sys.argv) < 3:
        print("uso: battito.py <ok|irraggiungibile> <partite> [problema]", file=sys.stderr)
        return 2
    try:
        precedente = json.loads(sys.stdin.read() or "{}")
    except Exception:
        precedente = {}
    esito = sys.argv[1]
    try:
        partite = int(sys.argv[2])
    except ValueError:
        partite = 0
    problema = sys.argv[3] if len(sys.argv) > 3 else None
    print(json.dumps(nuovo_stato(precedente, esito, partite, problema)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
