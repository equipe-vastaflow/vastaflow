# WhatsApp (Cloud API oficial da Meta)

> **Estado: DESENVOLVIDO e TESTADO com simulacao (Graph API falsa + assinatura real). NAO validado contra a
> Meta.** Nenhum numero foi conectado, nenhuma conta Meta foi alterada, nenhuma mensagem real foi enviada.
> Desligado por padrao (`WHATSAPP_ENABLED=false`: as rotas respondem 404 e nada e enviado).

## 1. O que existe

```
Meta ──HTTPS──> Nginx /api/webhooks/whatsapp ──> backend /webhooks/whatsapp   (SEM n8n no caminho)
   GET  : verificacao (hub.mode/hub.verify_token/hub.challenge)
   POST : mensagens, assinadas com X-Hub-Signature-256 (HMAC-SHA256 do corpo bruto, App Secret)
backend: assinatura -> reserva do wamid (idempotencia) -> idade (<=10 min) -> limite (10/min por numero)
        -> /vincular? -> identidade (external_identity_links, canal "whatsapp") -> RBAC -> Command Engine
        -> auditoria (CHANNEL_MESSAGE) -> resposta de TEXTO pela Graph API para o MESMO numero
```

**Por que sem n8n:** a verificacao da assinatura exige o corpo bruto e o App Secret; esse segredo nao deve sair do
backend. O n8n nao acrescentaria nada ao fluxo e ampliaria a superficie (e guarda o corpo de cada execucao,
ver `telegram-n8n.md` secao 14). Os comandos, o RBAC, a auditoria e as respostas sao os **mesmos** do Telegram.

| Peca | Arquivo (`backend/src/modules/integrations/whatsapp/`) |
| --- | --- |
| Rotas GET/POST publicas, fechadas por assinatura | `whatsapp.controller.ts` |
| Assinatura (tempo constante, hex estrito) e desafio | `whatsapp-signature.ts` |
| Payload da Meta -> mensagem de texto minima | `whatsapp-payload.ts` |
| Processador (idempotencia, limite, vinculo, RBAC, auditoria) | `whatsapp-message.processor.ts` |
| Envio (unico ponto de rede) | `whatsapp-api.client.ts` |
| Idempotencia persistente | `whatsapp-inbound-event.entity.ts`, migration `1791600000000-WhatsappInboundEvents` (MySQL + Oracle nao executado) |

## 2. O que e aceito e o que e ignorado

- **Aceito:** texto simples (1 a 4096 caracteres) de conversa individual, do **nosso** numero (`phone_number_id`).
- **Ignorado sem resposta:** status de entrega, imagem, **documento**, audio, localizacao, botao, mensagem
  **encaminhada**, mensagem com mais de 10 min, outro `phone_number_id`, payload malformado.
- **Anexos e documentos: NAO suportados.** Receber/enviar arquivo e uma funcionalidade nao construida.
- Sem linguagem natural: so `/comando args`.

## 3. Seguranca (cada item tem teste)

| Controle | Detalhe |
| --- | --- |
| Autenticidade | `X-Hub-Signature-256` sobre o corpo **bruto**; ausente/invalida/corpo alterado = **403** e nada e processado |
| Verificacao do webhook | so ecoa `hub.challenge` com o token certo e formato inofensivo |
| Segredos | App Secret e token do webhook so no controller; token de acesso so no cliente; nada em log, URL ou erro (teste de arquitetura) |
| Identidade | `wa_id` -> `external_identity_links` (usuario ativo, relido a cada mensagem). Sem vinculo, nada executa |
| Vinculo | `/vincular <codigo>` (prova de posse do numero), mesmo mecanismo do Telegram; o codigo nao vai a log nem a auditoria |
| Idempotencia | indice unico `(phone_number_id, message_id)`; a Meta reentrega webhooks e o `wamid` executa **uma** vez (at-most-once) |
| Abuso | 10 mensagens/min por numero; excesso descartado com um aviso por janela |
| Destino | a resposta vai ao numero que escreveu; nao ha envio proativo nem template |
| Rede | Graph oficial; `WHATSAPP_API_BASE_URL` so aceita hosts de teste (lista fechada) |
| Borda | Nginx: `limit_req` proprio (20 r/s), corpo maximo 256 KB, log sem query string |

## 4. Configuracao (todas no `.env` do servidor; so o backend as recebe)

`WHATSAPP_ENABLED`, `WHATSAPP_WEBHOOK_TOKEN` (voce inventa; >=16), `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_API_VERSION` (**sem padrao no codigo**: confira a vigente na Meta),
`WHATSAPP_API_BASE_URL` (so teste). Ligado sem alguma, o **boot e recusado**. Ver `.env.example`.

## 5. O que depende de voce / da Meta (nada disto foi feito)

1. **Conta Meta Business** da empresa (verificacao do negocio, se a Meta exigir) e uma **WABA**.
2. Um **app** da Meta com o produto WhatsApp; dele saem o **App Secret** e o **ID do numero**.
3. Um **usuario de sistema** e um **token de acesso permanente** com `whatsapp_business_messaging`.
4. **Webhook publico em HTTPS valido** apontando para `https://<SERVER_NAME>/api/webhooks/whatsapp` (ex.: `https://vastaflow.duckdns.org/...`).
   O HTTPS esta **preparado** (`docker-compose.https.yml`, `docs/deploy-vps.md`) mas **nao no ar**: falta a VPS, o DNS e a emissao do
   certificado. `bash scripts/https-verify.sh` imprime a URL e confere, sem chamar a Meta. Campo "assinar": `messages`.
5. **O numero.** Nao se presume que o numero atual da cliente possa ser migrado:
   - um numero que esta no **app WhatsApp pessoal** nao pode ser usado na Cloud API sem sair do app;
   - o modo **coexistencia** (numero do **app WhatsApp Business** usado ao mesmo tempo na Cloud API) existe, mas
     exige app Business em versao recente e onboarding por QR; a documentacao consultada **nao confirma** a
     disponibilidade no Brasil nem as regras de verificacao (**lacuna: confirmar na documentacao oficial da Meta**);
   - registrar um numero pela API e irreversivel o bastante para exigir decisao do titular: **nao** fazer sem ela;
   - alternativa segura para ensaiar: o **numero de teste** que a Meta fornece, ou um chip novo.
6. **Janela de 24 h:** so se responde a quem escreveu (sem template). Notificacao proativa exige *templates*
   aprovados pela Meta — fora de escopo.
7. Quantos numeros/usuarios, e quem sera vinculado (via `local-operator.cli.js link-code --canal whatsapp` ou API de ADMIN).

## 5.1 Peculiaridade conhecida

O `wa_id` que a Meta entrega pode diferir do numero digitado (em numeros brasileiros antigos o "9" extra pode
faltar). Por isso o vinculo e feito **por codigo enviado do proprio aparelho**, nunca digitando o numero.

## 6. Como ensaiar sem a Meta (o que foi feito)

`test/whatsapp.e2e-spec.ts` (21 testes): webhook assinado de verdade contra a aplicacao completa, Graph falsa
em processo, vinculo por codigo, RBAC do OPERADOR, duplicata, entregas simultaneas, midia/encaminhada/antiga
ignoradas, logs sem segredo. Unitarios: assinatura, payload, configuracao, cliente, processador, arquitetura.

## 7. Ativacao (futura, com autorizacao)

1. Itens da secao 5 resolvidos e HTTPS publico no ar.
2. `.env` privado preenchido; **recriar so o backend** (a migration `1791600000000` roda no `migrate`).
3. No painel da Meta: URL do webhook + `WHATSAPP_WEBHOOK_TOKEN` -> a Meta faz o GET de verificacao.
4. Vincular **uma** conta de teste; testar `/ajuda`, nao vinculado, `/financeiro` negado, duplicata.
5. Rollback: `WHATSAPP_ENABLED=false` e recriar o backend (as rotas voltam a 404); remover a assinatura do webhook na Meta.

## 8. Limitacoes

Nunca falou com a Meta. Anexos/documentos nao suportados. Resposta e at-most-once (se o envio falhar, nao ha retentativa).
Processamento inline: uma consulta lenta pode fazer a Meta reentregar (a idempotencia cobre). Oracle nao executado.
