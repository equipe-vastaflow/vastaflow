# ===========================================================================
# VastaFlow - frontend (React/Vite) servido por Nginx
# ---------------------------------------------------------------------------
# VALIDADO em Docker Desktop em 2026-10-08: sem VITE_API_URL o build FALHA no
# passo 2 (antes do `npm ci`, sem criar imagem); com ela o build passa e o
# `nginx -t` do proprio build aceita a configuracao. Ver docs/containerizacao.md.
# ---------------------------------------------------------------------------
#
# O resultado final NAO tem Node: o React e compilado no stage de build e so os
# arquivos estaticos chegam a imagem do Nginx. Nenhum processo Node fica em pe
# apenas para servir arquivos.
#
# Esta imagem e, tambem, o ingress HTTP da aplicacao: ela serve o SPA e faz
# proxy para a API. Assim o deploy do frontend e atomico - index.html e os
# assets com hash viajam juntos, sem janela em que um referencia o outro de uma
# versao diferente.
# ===========================================================================

# --------------------------------------------------------------------------
# Stage 1: build do bundle.
# --------------------------------------------------------------------------
FROM node:24.15.0-bookworm-slim AS build

# URL base da API, embutida no bundle. NAO e segredo: e uma URL que o navegador
# precisa conhecer de qualquer forma, e toda variavel VITE_* vai para o bundle
# publico. Nenhum segredo pode ser passado como VITE_*.
ARG VITE_API_URL

# Falha ANTES de instalar qualquer coisa. Sem isto, o build sairia com um bundle
# apontando para http://localhost:3000 - o fallback de desenvolvimento -, e a
# falha apareceria no navegador do usuario final, nao aqui.
#
# Ha uma segunda barreira dentro do proprio projeto: o plugin
# `vastaflow:require-api-url` em vite.config.ts interrompe `vite build`. Este
# teste existe para dar a mensagem no lugar certo, antes de gastar o `npm ci`.
RUN test -n "$VITE_API_URL" \
  || (echo "ERRO: VITE_API_URL e obrigatoria. Use --build-arg VITE_API_URL=https://api.<dominio>" >&2 && exit 1)

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src

# `npm run build` = `tsc --noEmit && vite build`. A variavel precisa estar no
# ambiente do processo do Vite, nao so como ARG.
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# --------------------------------------------------------------------------
# Stage 2: Nginx servindo o estatico e fazendo proxy da API.
# --------------------------------------------------------------------------
# Alpine aqui e seguro: o Nginx nao tem dependencia nativa de Node. A restricao
# a glibc vale para a imagem do backend (bcrypt/oracledb), nao para esta.
FROM nginx:1.30.5-alpine

# Remove o site de exemplo da imagem base.
RUN rm -f /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

# Dois diretorios, por contexto do Nginx: `conf.d/*.conf` e carregado no `http`
# (zonas de rate limit e o server block); `snippets/` NAO e carregado sozinho e
# so entra por `include` explicito, dentro de `server` e de `location`.
COPY nginx/conf.d/   /etc/nginx/conf.d/
COPY nginx/snippets/ /etc/nginx/snippets/

# Falha o BUILD se o Nginx nao aceitar a configuracao; sem isto um erro de
# sintaxe so apareceria quando o container tentasse subir (foi assim que o
# `limit_req_zone` fora de contexto foi pego - so ao executar `nginx -t`).
# Funciona sem rede de servicos porque o upstream e uma VARIAVEL resolvida em
# tempo de requisicao: o Nginx nao precisa resolver `backend` para validar.
RUN nginx -t

EXPOSE 80
