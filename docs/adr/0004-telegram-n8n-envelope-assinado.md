# ADR 0004 - Telegram + n8n: backend le o Telegram e entrega um envelope assinado

- **Status:** aceito
- **Data:** 2026-10-13
- **Decisores:** equipe VastaFlow

## Contexto

A Fase 5 precisa do primeiro fluxo conversacional: uma pessoa autorizada envia um
comando pelo Telegram e recebe a resposta no mesmo chat, com o **n8n orquestrando** e o
**NestJS como autoridade** de identidade, autorizacao, comandos, integracoes e auditoria.
Restricoes do projeto: o n8n **nao** recebe o token do bot nem o do Plantae, **nao**
acessa o MySQL, e **nao** pode escolher quem e o usuario.

## Verificacao do no do n8n (2.43.1, imagem em uso)

O no **Telegram Trigger** (`TelegramTrigger.node.js`) registra um **webhook** (usa
`setWebhook` e `deleteWebhook`); nao ha `getUpdates` nele. Ele recebe o token por uma
credencial **dentro do n8n**. Na Bot API, `getUpdates` e webhook sao **excludentes**
(com webhook ativo, `getUpdates` nao funciona) e um bot tem **um** consumidor.

## Alternativas

| | Descricao | Por que nao |
| --- | --- | --- |
| A | Telegram Trigger do n8n (webhook) | exige **token do bot no n8n** e URL publica HTTPS; o n8n passa a ver e a poder falsificar tudo |
| B | n8n faz polling proprio (`getUpdates` via HTTP Request) | token no n8n; dois consumidores se o backend tambem ler |
| C | n8n envia a resposta (no Telegram "Send Message") | token no n8n |
| **D** | **backend le o Telegram, assina um envelope e o entrega ao n8n; o n8n repassa ao backend; o backend responde** | **escolhida** |
| E | n8n so repassa um `chatId` simples, sem assinatura | o n8n poderia se passar por qualquer usuario; o servico passaria a "ser" a identidade |

## Decisao

**D.** O `TelegramPollingService` continua sendo o **unico** consumidor do bot. No modo
`n8n` (`TELEGRAM_DELIVERY_MODE=n8n`), o `TelegramRelayService`:

1. reduz o update a um **envelope** (`telegram-envelope.ts`) e o **assina** (HMAC-SHA256,
   chave so do backend, texto por hash, prefixo de dominio);
2. entrega ao **webhook** do n8n (`TelegramN8nClient`: host fixo na rede do Compose, sem
   redirect, timeout, teto de resposta, **uma tentativa**);
3. o workflow repassa **somente** `envelope` e `signature` a `POST /service/telegram/ingest`
   com a credencial de servico do principal **`n8n-telegram`** (escopo
   `service:telegram:ingest`, so esta rota);
4. o backend (`TelegramIngestService`) confere assinatura e validade, **reserva** o update
   no banco (indice unico), identifica a **pessoa** vinculada, aplica o RBAC **dela** pelo
   Command Engine, audita e devolve a resposta **assinada e amarrada ao envelope**;
5. o transporte confere a assinatura da resposta e **envia ao chat do proprio envelope**.

`/vincular CODIGO` e tratado pelo adaptador direto, **antes** do envelope: o codigo e prova
de posse da conta e nunca passa pelo n8n (inclusive grafias como `/vincular@Bot`).

### Desvio do roteiro (assumido)

O roteiro previa "o n8n devolve a resposta ao usuario". Isso exigiria o token do bot no
n8n. **Quem envia a mensagem e o transporte do backend**; o n8n devolve o texto, que so e
enviado se a assinatura conferir. O n8n continua sendo o orquestrador do fluxo (recebe,
decide se repassa, chama o backend, responde), mas **nao tem como alterar o conteudo nem o
destino**.

### Outras decisoes

- **Principal separado** (`n8n-telegram`): o `n8n` da Fase 3 segue so com
  `service:identity`. Um token de identidade nao abre o ingest e vice-versa.
- **Idempotencia no banco** (`telegram_inbound_events`), com **at-most-once**: reexecutar
  automaticamente poderia repetir um comando com efeito colateral (hoje todos so leem).
- **`/contas_pagar`** com permissao propria (`plantae:read`, so ADMIN) e opt-in
  (`PLANTAE_CHAT_COMMANDS_ENABLED`): ligar o Plantae nao leva dado financeiro ao Telegram,
  cujos chats comuns nao sao ponta a ponta.
- **Entrega ao n8n em HTTP** na rede interna (`automation`), como a Fase 3; a autenticidade
  vem da assinatura **dentro** do corpo, nao do canal.
- O n8n **grava o conteudo de forma transitoria**, mesmo com "nao salvar" (correcao da 5.3, ver
  `docs/telegram-n8n.md` secao 14): corpo do webhook por ~segundos, com o buffer de apagamento em 0.

## Consequencias

- (+) O n8n nao tem token, nao tem chave, nao escolhe o ator, nao altera o texto nem a
  resposta; um n8n comprometido so consegue **derrubar ou atrasar** mensagens.
- (+) Um unico consumidor `getUpdates`; trocar de modo nunca cria um segundo.
- (+) O mesmo `processMessage` serve o modo direto e o ingest: uma regra de negocio.
- (-) A assinatura **nao** protege o trecho Telegram -> backend (a Bot API e TLS) nem um
  backend comprometido.
- (-) O texto passa pelo n8n; a chave de assinatura e um novo segredo a proteger e girar
  (girar = trocar a variavel e reiniciar; envelopes em voo expiram em 5 minutos).
- (-) Sem `webhook` do Telegram nao ha "push": latencia de `getUpdates` (long polling de 25 s,
  reentrega imediata).
- (-) Oracle: migration nao executada.

## Adendo - Fase 5.1 (2026-10-13)

- **O n8n nao verifica a assinatura.** A decisao "Tem envelope e assinatura?" do workflow e estrutural; a
  chave nao esta (nem deve estar) no n8n. Toda verificacao criptografica fica no backend.
- **Compromisso de entrega explicito:** no maximo uma execucao; sem entrega garantida e sem
  exatamente-uma-vez (ver `docs/telegram-n8n.md` 12.3). Eventos presos tem estado terminal explicito
  (`ABANDONADO`) e CLI; retencao com piso de 7 dias.
- **Idade da mensagem** (10 min) no polling e no ingest, contra reentrega tardia do Telegram.
- **Limite por remetente** no polling e 3 consultas/min por pessoa em `/contas_pagar`.
- **Bot API falso** para teste, via `TELEGRAM_API_BASE_URL` com lista fechada de hosts (o token vai na URL).

## Fora de escopo

WhatsApp/Meta, NFS-e, IA/LLM, pagamentos, escrita no Plantae, novos dashboards, grupos e
canais, anexos, callbacks, linguagem natural.
