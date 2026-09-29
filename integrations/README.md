# Integracoes externas

> **Estado: nenhuma integracao foi implementada.**
>
> Esta pasta reserva a estrutura prevista no briefing. Nao ha, e nao deve haver
> ate segunda ordem: endpoint, URL de API, token, credencial, payload ou metodo
> HTTP de qualquer provedor.

## Por que as pastas estao vazias

Inventar a assinatura de uma API que ainda nao conhecemos produz codigo que
*parece* funcionar e falha no primeiro contato com o servico real - alem de
precisar ser jogado fora. Cada integracao so sera escrita quando tivermos:

1. documentacao oficial do provedor;
2. credenciais de homologacao;
3. um ambiente onde testar de verdade.

## Pastas

| Pasta       | Provedor         | Pendencia                                        |
| ----------- | ---------------- | ------------------------------------------------ |
| `whatsapp/` | a definir        | Provedor nao escolhido (API oficial? terceiro?)   |
| `telegram/` | Telegram Bot API | Definir bot, token e modelo (webhook ou polling)  |
| `plantae/`  | Plantae          | Sem documentacao de API e sem acesso              |
| `nfse/`     | a definir        | Municipio e provedor nao definidos                |
| `email/`    | SMTP             | Servidor, porta e politica de autenticacao        |
| `index/`    | -                | Feito: `IntegrationRegistry` no backend           |

## Regra de isolamento

Cada integracao e isolada atras de uma interface propria. A regra de negocio
depende da **interface**, nunca do SDK ou do cliente HTTP do provedor. Trocar de
provedor de WhatsApp, por exemplo, nao pode exigir mudanca em nenhum service.

Os canais conversacionais (WhatsApp, Telegram) compartilham o mesmo caminho
interno; ver [docs/arquitetura.md](../docs/arquitetura.md).

## Decisao da Etapa 5: onde fica o codigo

O codigo das integracoes vive em **`backend/src/modules/integrations/`**, como
modulo Nest (DI, testes e build do proprio backend), e nao num npm workspace.
Ali ja esta a foundation: contrato `IntegrationProvider`, estados e
`IntegrationRegistry` - ver [docs/arquitetura.md](../docs/arquitetura.md).

As pastas desta raiz ficam como registro das pendencias de cada provedor (tabela
acima). Nenhum codigo de integracao deve ser criado aqui: cada provider real
entrara como modulo proprio dentro do backend.
