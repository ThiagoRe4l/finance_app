"""Ponto de entrada da função serverless na Vercel.

A Vercel serve um app ASGI exportado como `app` por um módulo em `api/`. Este
arquivo é só a fiação — toda a aplicação continua em `app/main.py`, que não sabe
nada sobre a plataforma.

⚠️ **Não há boot.** Cada invocação é fria e isolada: não existe lugar onde
`create_all()` ou o seed pudessem rodar uma vez. O schema vem do Alembic e o
seed é script one-off (D-Vercel-6).
"""

from app.main import app

__all__ = ["app"]
