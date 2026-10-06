"""`alembic.ini` só com ASCII — senão o Alembic não abre no Windows.

Escrito **antes** da correção, conforme o processo do CLAUDE.md.

O Alembic lê o `alembic.ini` pelo `configparser` com a codificação **do
sistema**. No Linux (CI, container) ela é UTF-8 e tudo passa; no Windows é
cp1252, e o primeiro byte UTF-8 que não existe nela derruba o comando:

    UnicodeDecodeError: 'charmap' codec can't decode byte 0x8f

Achado no ensaio da migration multiusuário (06/10/2026), rodando do Windows. O
runbook de produção roda `alembic upgrade` de lá — então o arquivo quebraria
exatamente no passo que mexe no banco de produção.

Contrato sobre bytes, não sobre `open()`: o teste não pode depender da
codificação da máquina que o roda, ou ficaria verde no Linux pelo mesmo motivo
que o defeito nunca apareceu no CI.
"""

import pathlib

ALEMBIC_INI = pathlib.Path(__file__).resolve().parent.parent / "alembic.ini"


def test_alembic_ini_is_pure_ascii():
    """🔴 Qualquer byte acima de 0x7F reprova, com o número da linha."""
    offenders = [
        f"linha {number}: {line!r}"
        for number, line in enumerate(ALEMBIC_INI.read_bytes().splitlines(), 1)
        if any(byte > 0x7F for byte in line)
    ]

    assert not offenders, (
        "alembic.ini tem bytes fora do ASCII — o Alembic falha no Windows (cp1252):\n"
        + "\n".join(offenders)
    )
