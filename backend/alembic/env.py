"""Configuração do Alembic.

A URL e o metadata vêm da aplicação, não de config própria — ver a nota no
`alembic.ini`. Isso é o que garante que `alembic upgrade head` migra exatamente
o banco que a aplicação abre.
"""

from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

from app.database import Base
from app.settings import resolve_database_url
# Import obrigatório: sem ele o `Base.metadata` chega vazio e o autogenerate
# proporia apagar todas as tabelas.
from app import models  # noqa: F401

config = context.config
config.set_main_option("sqlalchemy.url", resolve_database_url())

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def _run(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # `render_as_batch` é o que permite ALTER em SQLite (que não o suporta
        # nativamente). Sem isso, migrations futuras rodariam em produção e
        # falhariam no ambiente local.
        render_as_batch=connection.dialect.name == "sqlite",
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # Conexão injetada pela suíte de testes (`config.attributes`). É o que
    # permite construir o schema de teste **pela migration** em vez de por
    # `create_all()` — sem isso, os testes validariam os models e a migration
    # poderia divergir sem nada denunciar.
    injected = config.attributes.get("connection")
    if injected is not None:
        _run(injected)
        return

    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        _run(connection)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
