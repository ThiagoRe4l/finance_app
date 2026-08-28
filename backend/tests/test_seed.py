"""Idempotência do seed — requisito de produção (D-Deploy-1..6).

Escrito **antes** da implementação, conforme o processo do CLAUDE.md.

`init_db.py` deixa de ser script rodado à mão e passa a ser o entrypoint do
container, executado **a cada boot**. Num volume novo é o único ponto que cria
as tabelas, então não há como rodá-lo uma vez só — e isso transforma a
idempotência em requisito de produção, não conveniência.
"""

import pytest

from app import models


def test_seed_does_not_duplicate_on_a_second_boot(session):
    """🔴 `init_db.py` passa a rodar **a cada boot do container**.

    Num volume novo é o único ponto que garante a criação das tabelas, então
    não dá para rodá-lo só uma vez à mão. Isso torna a idempotência um
    requisito de produção: se falhar, cada redeploy duplica as 10 categorias e
    o dado só é percebido depois de sujo.

    Falha hoje por assinatura: `seed_data()` abre a própria `SessionLocal`
    ligada ao engine **real**, o que além de não ser testável escreveria no
    `database.db` do repositório.
    """
    from app.init_db import seed_data

    seed_data(session)
    seed_data(session)

    assert session.query(models.Account).count() == 1
    assert session.query(models.Category).count() == 10


def test_seed_keeps_the_default_account_balance(session):
    """O segundo boot não pode reescrever saldo inicial de conta existente."""
    from app.init_db import seed_data

    seed_data(session)
    session.query(models.Account).update({models.Account.initial_balance: 42})
    session.commit()

    seed_data(session)

    assert session.query(models.Account).one().initial_balance == 42


# ---------------------------------------------------------------------------
# D-Vercel-6: o seed vira script one-off com --yes
# ---------------------------------------------------------------------------

def test_seed_script_refuses_to_run_without_confirmation():
    """🔴 Sem entrypoint de container, o seed passa a ser rodado à mão.

    E passa a ser rodado **contra o banco de produção**. A confirmação
    explícita existe porque o comando deixa de ter a rede de proteção que tinha
    quando só rodava em container efêmero: um engano aqui escreve no Neon.
    """
    from app.init_db import main

    with pytest.raises(SystemExit):
        main([])


def test_seed_script_runs_with_yes(session, monkeypatch):
    """Com `--yes`, executa e é idempotente como qualquer outro caminho."""
    import app.init_db as init_db

    monkeypatch.setattr(init_db, "SessionLocal", lambda: session)
    monkeypatch.setattr(session, "close", lambda: None)

    init_db.main(["--yes"])
    init_db.main(["--yes"])

    assert session.query(models.Account).count() == 1
    assert session.query(models.Category).count() == 10
