# Workflow do n8n: entrada de mensagens do Telegram

`vastaflow-telegram-ingest.workflow.json` - o workflow **versionado**, sem credencial, sem
ID de credencial, sem `webhookId`, sem URL externa e sem dado real. Contexto e modelo de
confianca: [`docs/telegram-n8n.md`](../../../docs/telegram-n8n.md) e
[ADR 0004](../../../docs/adr/0004-telegram-n8n-envelope-assinado.md).

```
Webhook POST /webhook/vastaflow-telegram
  -> tem `envelope` (objeto) e `signature` (texto)?   [so a FORMA; o n8n NAO verifica a assinatura]
                                                      -- nao --> responde {"outcome":"UNAVAILABLE"}
  -> HTTP Request  POST http://backend:3000/service/telegram/ingest
       corpo = SO { envelope, signature }   cabecalho X-Service-Token (credencial do cofre)
       sem repeticao, sem seguir redirect, timeout de 30 s
  -> backend respondeu 200?  -- sim --> devolve o corpo do backend, sem alterar
                             -- nao --> responde {"outcome":"UNAVAILABLE"}
```

A verificacao CRIPTOGRAFICA da assinatura acontece so no backend (transporte e ingestao); o n8n nao tem a
chave e nao deve ter. A decisao do workflow e apenas estrutural.

O n8n **nao**: acessa o MySQL, conhece o token do bot, o token do Plantae ou a chave de
assinatura, escolhe o usuario nem altera a resposta. O n8n **grava transitoriamente** o corpo de cada
execucao (texto do comando, ids do Telegram, envelope) no PostgreSQL dele: com "nao salvar" + buffer 0 a
linha some em ~segundos, mas existe (docs/telegram-n8n.md, secao 14).

## Importar (ambiente local ou servidor)

1. Crie a credencial de servico (principal `n8n-telegram`, escopo `service:telegram:ingest`):

   ```bash
   node dist/modules/service-auth/service-credential.cli.js create \
        --file infra/service-auth/credentials.json --id n8n-telegram-2026-10 --principal n8n-telegram
   ```

   O token aparece **uma vez**. Nao o cole em chat, ticket ou arquivo versionado.

2. No editor do n8n (`http://127.0.0.1:5678`, so em loopback): **Credentials -> Header Auth**
   - nome do cabecalho: `X-Service-Token`; valor: o token do passo 1;
   - nome da credencial: `VastaFlow servico n8n-telegram (X-Service-Token)`.

3. **Workflows -> Import from File** com o JSON desta pasta. No no
   "Entregar ao VastaFlow", confirme que a credencial acima esta selecionada.

4. Confira nas configuracoes do workflow: execucoes de sucesso/erro **nao** salvas, e no Compose o
   `EXECUTIONS_DATA_HARD_DELETE_BUFFER=0` (sem ele o dado fica ~1 h 15 min no PostgreSQL).

5. **Ative** o workflow somente quando for ligar o fluxo de verdade
   (`TELEGRAM_DELIVERY_MODE=n8n`). Antes disso, teste com o simulador:

   ```bash
   docker compose exec backend node dist/modules/integrations/telegram/telegram-simulate.cli.js \
       --user <id-de-telegram-vinculado> --text "/ajuda"
   ```

   (Git Bash no Windows: `export MSYS_NO_PATHCONV=1`.)

Ao exportar de volta do editor, **revise o arquivo antes de versionar**: o n8n inclui o ID
da credencial e o `webhookId`; troque o ID por `null` e remova o `webhookId`
(`telegram-n8n-workflow.spec.ts` falha se algum deles, ou qualquer segredo, aparecer).

## Rotacionar ou revogar

Crie uma credencial nova, atualize o valor no cofre do n8n e revogue a antiga
(`service-credential.cli.js revoke`). O backend le o arquivo a cada segundo; a revogacao
vale sem reiniciar. Se o token vazou: revogue primeiro.
