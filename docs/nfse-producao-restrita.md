# NFS-e: validação em produção restrita e autorização de produção

> **Nenhuma emissão real foi feita.** `NFSE_ENABLED` segue `false`. Este documento define o procedimento seguro de
> homologação e a **trava independente** que impede emitir em **produção real** por engano.

## 1. As três chaves (cada uma é separada)

| Chave | O que significa | Obrigatória em |
| --- | --- | --- |
| `NFSE_ENABLED=true` | liga os comandos da NFS-e | restrita e produção |
| `NFSE_WIRE_CONTRACT_CONFIRMED=true` | o **contrato da API** (formato JSON, rotas, assinatura) foi conferido contra a Sefin; o cliente só fala com a Sefin **real** com ela | restrita e produção |
| `NFSE_PRODUCAO_AUTORIZACAO=EMITIR-NFSE-REAL-<CNPJ do prestador>` | **autorização expressa para emitir em PRODUÇÃO REAL** | **somente produção** |

`NFSE_WIRE_CONTRACT_CONFIRMED` **continua sendo só a confirmação do contrato**: serve para testar a restrita e **não libera a
produção**. A produção só recebe tráfego com a terceira chave.

### Como a autorização de produção funciona

- **Desativada por padrão** (vazia no `.env.example` e no Compose). Nenhuma outra variável a liga: nem `NFSE_ENABLED`, nem
  o contrato, nem base de URL, perfis ou limites.
- **Não é um booleano.** É uma **frase exata** que embute o **CNPJ do prestador** (`EMITIR-NFSE-REAL-` + 14 dígitos). `true`, `1`,
  `sim`, frase incompleta, com outro CNPJ ou em minúsculas são **recusados no boot** (a aplicação não sobe). Assim ela não
  pode ser ligada por engano nem copiada de um `.env` de outra empresa.
- **Só existe em produção.** Com `NFSE_AMBIENTE=restrita` ela **não pode estar definida**: o boot é recusado. Trocar só o
  `NFSE_AMBIENTE` de `restrita` para `producao` **não herda** autorização nenhuma, porque ela precisa ter sido escrita de
  propósito e a restrita a proíbe.
- **Não é exigida na restrita.**

### Onde o bloqueio é aplicado (três camadas, a decisão final é a do cliente)

1. **Serviço:** em produção real sem a autorização, pedido, confirmação e consulta respondem "não configurada" e **não criam
   nem consomem nada** (o código de confirmação não é gasto).
2. **Cliente HTTP** (`nfse-api.client.ts`): **toda** chamada (emitir e consultar) cujo **destino** seja a Sefin de produção
   é recusada **antes** do transporte, **pelo host da URL** (qualquer esquema, porta ou caixa). Vale mesmo que o ambiente
   configurado esteja errado.
3. **Transporte** (`createTransport`): a mesma checagem, **antes de abrir conexão**, de criar a requisição ou de enviar um byte.

O erro do bloqueio (`NfseProductionNotAuthorizedError`) **nunca** vira "incerta" nem "não enviada": é relançado ao serviço, e
o resultado é `NAO_ENVIADA` (`producao_nao_autorizada`).

## 2. Procedimento seguro de homologação (produção restrita)

Pré-requisitos: certificado A1 da Quasar, perfil fiscal aprovado ([`nfse-perfis-fiscais.md`](nfse-perfis-fiscais.md)), e a
verificação offline e de leitura descrita em `docs/nfse.md`, seção 9 (contrato e assinatura).

1. **Garanta que `NFSE_PRODUCAO_AUTORIZACAO` está VAZIA ou ausente** no `.env` da restrita. Se estiver preenchida, o boot é
   recusado.
2. `NFSE_AMBIENTE=restrita`, `NFSE_WIRE_CONTRACT_CONFIRMED=true` (só após conferir o contrato), `NFSE_ENABLED=true` **apenas
   durante o teste**.
3. Use um usuário **ADMIN** (a conta da Rizola, perfil Gestor, **não** recebe `nfse:emit`). Emita **uma** nota de teste,
   com valor pequeno, e registre o resultado.
4. Confira: resposta, assinatura da NFS-e devolvida, repetição de `/nfse_confirmar` (não pode reenviar) e consulta
   (`/nfse_status`).
5. Ao terminar: `NFSE_ENABLED=false` e `NFSE_WIRE_CONTRACT_CONFIRMED=false`; confirme que `NFSE_PRODUCAO_AUTORIZACAO` continua
   vazia.

Uma nota da **restrita não tem valor fiscal**; a de produção tem, e só se cancela pelo portal (`/nfse_cancelar` não existe).

## 3. Liberar a produção: SOMENTE com aprovação expressa

Não preencher `NFSE_PRODUCAO_AUTORIZACAO` sem **aprovação expressa, por escrito**, de quem responde pela Quasar (e a
confirmação da contadora de que o perfil fiscal é o definitivo). Checklist mínimo, antes de preencher:

- [ ] a restrita validou ponta a ponta (emissão, rejeição, duplicidade, consulta e assinatura);
- [ ] o contrato da API foi conferido e `NFSE_WIRE_CONTRACT_CONFIRMED=true` tem lastro;
- [ ] perfil fiscal **aprovado** pela contadora para os serviços que serão emitidos;
- [ ] certificado A1 da **Quasar** e `NFSE_PRESTADOR_CNPJ` = CNPJ do certificado;
- [ ] valor máximo (`NFSE_VALOR_MAXIMO`) e quem emite (ADMIN) definidos;
- [ ] aprovação escrita de quem responde pela empresa, com data;
- [ ] plano de reversão: `NFSE_ENABLED=false` (a nota emitida só se cancela pelo portal).

Para liberar: `NFSE_AMBIENTE=producao`, `NFSE_PRODUCAO_AUTORIZACAO=EMITIR-NFSE-REAL-<CNPJ>` **e** as demais chaves, e recriar
só o backend. Para **revogar**, esvazie `NFSE_PRODUCAO_AUTORIZACAO` (ou `NFSE_ENABLED=false`) e recrie o backend: pedidos
pendentes **deixam de ser confirmáveis** (a confirmação responde "não configurada" e o código não é consumido).

## 4. O que ainda **não** protege

- Quem tem acesso ao `.env` da VPS pode preencher a frase: a trava impede o **acidente**, não a decisão deliberada de quem
  administra o servidor. A decisão é, por isso, documentada e exige aprovação.
- Servidor de **teste** (`NFSE_API_BASE_URL` com host local) não é produção real e não exige a autorização.
- Qualquer ADMIN pode emitir se a produção estiver autorizada: não há segundo fator por emissão além do código de confirmação.

## 5. Como a proteção é testada

- **Unitários:** configuração (frase exata, valores inválidos, restrita, independência das demais variáveis),
  `validateEnv` do boot, e o cliente com a matriz **ambiente × contrato × autorização** para emitir e consultar.
- **Último limite:** com `https.request` interceptado (lança), a produção sem autorização é rejeitada **sem nenhuma tentativa
  de rede**, em http, outra porta ou outra caixa; com autorização a chamada chega ao ponto de rede (interceptado, **nada sai**);
  a restrita não exige autorização.
- **Serviço:** produção sem autorização não cria, não confirma, não consulta e não toca o transporte; autorização removida
  depois do pedido não consome o código.
- **e2e:** aplicação completa com `NFSE_ENABLED=true`, contrato confirmado e destino da Sefin oficial, **sem** a autorização:
  os três comandos são recusados, nada é criado e nenhuma conexão é tentada.
- **Arquitetura:** a autorização é decidida só na configuração, aplicada só no cliente, invisível ao comando, e o portão vem
  antes de qualquer acesso à rede.
- **Mutação:** retirar cada camada do portão faz testes falharem (ver o relatório da etapa).
