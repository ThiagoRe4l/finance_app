# Imagem de produção da API. O docker-compose.yml da raiz continua sendo o
# ambiente de desenvolvimento e NÃO compartilha nada com este arquivo: lá as
# dependências são instaladas na subida, o código vem por bind mount e o
# uvicorn roda com --reload. Nada disso serve para produção.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app

WORKDIR /app

# Dependências antes do código: a camada só é refeita quando o requirements
# muda, não a cada commit. Só produção — pytest/httpx ficam no -dev (D-Deploy-5).
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# `PORT` é injetada pelo Railway; 8000 é o default para rodar a imagem à mão.
ENV PORT=8000
EXPOSE 8000

# Duas partes que não são estéticas:
#
# 1. `init_db.py` roda a cada boot. Num volume novo é o único ponto que cria as
#    tabelas, então não dá para executá-lo uma vez só à mão. É idempotente e há
#    teste travando isso (`test_seed_does_not_duplicate_on_a_second_boot`).
#
# 2. `--forwarded-allow-ips='*'` — o FastAPI redireciona `/api/accounts` para
#    `/api/accounts/` com 307. Atrás do TLS do Railway, o uvicorn por default só
#    confia em `X-Forwarded-Proto` vindo de 127.0.0.1, então o `Location` sairia
#    como `http://` e o browser bloquearia por conteúdo misto. Hoje nenhuma
#    chamada do front dispara 307, mas é uma chamada mal escrita de distância.
CMD ["sh", "-c", "python app/init_db.py && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --forwarded-allow-ips='*'"]
