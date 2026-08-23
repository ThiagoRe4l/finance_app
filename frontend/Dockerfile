# Build em dois estágios: a imagem final não carrega node_modules de build.
FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# ⚠️ VITE_* é resolvida em BUILD, não em runtime — o preset injeta via `define:`
# e o valor fica inlinado no bundle. Por isso é ARG e não ENV de runtime.
#
# Sem este ARG a variável do Railway simplesmente não existe durante o
# `npm run build`: a URL sai vazia no bundle e o app compila normalmente.
# Trocar o domínio do backend depois exige REBUILD, não restart.
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

# Produz `.output/server/index.mjs` graças ao preset `node-server` fixado no
# vite.config.ts. Sem ele o default do Nitro é `cloudflare-module` e este
# estágio geraria um Worker — build verde, imagem final inútil (D-Deploy-1).
RUN npm run build

FROM node:22-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/.output ./.output

ENV PORT=3000
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
