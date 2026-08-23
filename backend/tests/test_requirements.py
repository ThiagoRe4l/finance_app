"""Contrato dos arquivos de requirements (D-Deploy-5).

Escrito **antes** da implementação, conforme o processo do CLAUDE.md.

Teste sobre **arquivo**, não sobre comportamento: existe para que a separação
produção/dev e o pin de versões não regridam em silêncio. É a mesma natureza do
contrato do `vite.config.ts` no front.
"""

import pathlib
import re

import pytest

BACKEND_DIR = pathlib.Path(__file__).resolve().parent.parent


def _package_name(requirement: str) -> str:
    """Nome do pacote, seja qual for o operador de versão.

    Parsear só por `==` deixaria este arquivo com um **falso verde** enquanto
    as versões ainda estivessem em `>=`: `"pytest>=7.0.0".split("==")[0]` é a
    linha inteira, e a checagem `"pytest" not in ...` passaria com o pytest
    listado. Encontrado ao rodar a etapa vermelha.
    """
    return re.split(r"[=<>!~\[;]", requirement, maxsplit=1)[0].strip().lower()


def _requirement_lines(filename: str) -> list[str]:
    raw = (BACKEND_DIR / filename).read_text(encoding="utf-8")
    return [
        line.strip()
        for line in raw.splitlines()
        if line.strip() and not line.strip().startswith(("#", "-r "))
    ]


def test_production_requirements_do_not_carry_test_tooling():
    """A imagem de produção não deve embarcar o runner de testes."""
    installed = {_package_name(line) for line in _requirement_lines("requirements.txt")}

    assert "pytest" not in installed
    assert "httpx" not in installed


def test_dev_requirements_include_production():
    """`-r requirements.txt` é o que impede as duas listas de divergirem."""
    raw = (BACKEND_DIR / "requirements-dev.txt").read_text(encoding="utf-8")

    assert "-r requirements.txt" in raw


@pytest.mark.parametrize("filename", ["requirements.txt", "requirements-dev.txt"])
def test_every_requirement_is_pinned(filename):
    """Sem pin, um rebuild meses depois puxa breaking change e o deploy quebra
    sem ninguém ter tocado no código — mesma natureza da bomba-relógio de data
    registrada na seção 0.1.

    Teste de contrato sobre arquivo, não sobre comportamento: existe para que a
    D-Deploy-5 não regrida em silêncio para `>=`.
    """
    for line in _requirement_lines(filename):
        assert "==" in line, f"{filename}: '{line}' não está pinado"
