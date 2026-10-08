# ===========================================================================
# VastaFlow - backend (NestJS)
# ---------------------------------------------------------------------------
# VALIDADO em Docker Desktop (Engine 29.8.2) em 2026-10-08: construida e
# executada com o Compose. `bcrypt` (hash e compare reais) e `oracledb` (thin
# mode) carregam nesta base; o processo roda como `node` (uid 1000). NAO
# validado: a base Linux nativa da VPS (ver docs/containerizacao.md).
# ---------------------------------------------------------------------------
#
# Por que bookworm-slim e NAO Alpine: `bcrypt` e `oracledb` so distribuem
# binario pre-compilado para glibc. Verificado no pacote instalado:
#   node_modules/bcrypt/prebuilds/        -> linux-x64, linux-arm64, ... sem -musl
#   node_modules/oracledb/build/Release/  -> oracledb-7.0.1-linux-x64.node
# Em musl o `node-gyp-build` tentaria compilar, e a imagem passaria a precisar
# de python3, make e g++.
#
# Node 24.15.0 porque `package.json` declara engines.node ">=24.15.0".
# ===========================================================================

# --------------------------------------------------------------------------
# Stage 1: compila. Precisa das devDependencies - `nest build` vem do
# @nestjs/cli, que e devDependency.
# --------------------------------------------------------------------------
FROM node:24.15.0-bookworm-slim AS build

WORKDIR /app

# Camada propria para as dependencias: muda so quando o lockfile muda.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src

# `nest build` usa tsconfig.build.json (rootDir src/) -> dist/main.js
RUN npm run build

# --------------------------------------------------------------------------
# Stage 2: dependencias de runtime, sem as de desenvolvimento.
# Separado do stage 1 para que a imagem final nao herde nada do build.
# --------------------------------------------------------------------------
FROM node:24.15.0-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
# `typeorm` fica, porque e dependencia de runtime - e e o que permite rodar as
# migrations na mesma imagem (ver docker-compose: servico `migrate`).
RUN npm ci --omit=dev && npm cache clean --force

# --------------------------------------------------------------------------
# Stage 3: imagem final.
# --------------------------------------------------------------------------
FROM node:24.15.0-bookworm-slim

ENV NODE_ENV=production

WORKDIR /app

COPY --from=deps  --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist         ./dist
COPY --chown=node:node package.json ./

# Raiz do storage de documentos. DOCUMENT_STORAGE_PATH deve apontar para ca,
# com caminho ABSOLUTO: o default `./storage/documents` e relativo ao diretorio
# de trabalho do processo e seria fragil aqui.
# Criado com dono `node` porque o volume e montado neste ponto e o processo
# precisa escrever.
RUN mkdir -p /app/storage/documents && chown -R node:node /app/storage

# A imagem oficial do Node ja traz o usuario `node` (uid 1000).
USER node

EXPOSE 3000

# NAO roda migrations. Elas sao um passo explicito e anterior (servico
# `migrate`), e `PendingMigrationsCheck` derruba o boot se houver pendencia.
CMD ["node", "dist/main"]
