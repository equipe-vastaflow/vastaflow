# whatsapp-gateway

Transporte do WhatsApp (Baileys) do VastaFlow: conecta, filtra e **encaminha ao backend**. Sem regra de negocio.

Estado, arquitetura, versoes, politica de reconexao, risco de LID e execucao local: [`docs/whatsapp-gateway.md`](../docs/whatsapp-gateway.md).

```
npm ci && npm run typecheck && npm run lint && npm run build && npm test
```

Nesta etapa o gateway **nao conecta nenhuma conta** (o armazenamento da sessao e da etapa 3).
