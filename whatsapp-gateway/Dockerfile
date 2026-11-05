# ===========================================================================
# VastaFlow - whatsapp-gateway (Baileys)
# ---------------------------------------------------------------------------
# NAO VALIDADO EM DOCKER: o Docker Desktop estava desligado quando este arquivo foi escrito e nenhuma imagem foi
# construida. O que foi verificado SEM Docker: nenhuma dependencia de runtime tem binario nativo, os/cpu ou
# optionalDependencies (nada de .node), os scripts de instalacao ficam desligados (.npmrc: ignore-scripts=true) e o
# `npm ci --omit=dev` e reprodutivel pelo lockfile. Validar com `docker build` antes de qualquer uso (etapa 4).
#
# Mesma base do backend (bookworm-slim, Node 24.15.0). NAO esta no Compose de producao ainda.
# ===========================================================================

FROM node:24.15.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24.15.0-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24.15.0-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Usuario sem privilegios (uid 1000, ja existente na imagem). O gateway nao escreve em disco: a sessao (etapa 3) ficara
# no banco, cifrada, e nao em arquivo.
USER node
# Sem EXPOSE: o gateway nao escuta porta nenhuma.
CMD ["node", "dist/main.js"]
