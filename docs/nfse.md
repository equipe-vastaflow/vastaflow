# NFS-e — estado real e o que falta

> **Estado: NAO IMPLEMENTADA. Nenhum codigo de emissao existe e nenhum documento fiscal foi emitido.**
> O projeto nao tem emissor definido, municipio, certificado nem credenciais; por isso nao foi inventada
> integracao. Este documento registra o que se sabe, o que foi **consultado** e o que precisa ser obtido.

## 1. Nao confundir

| | NF-e (modelo 55) | NFS-e |
| --- | --- | --- |
| O que e | nota de **mercadorias** (SEFAZ estadual) | nota de **servicos** (municipal / padrao nacional) |
| No repositorio | `GET /fiscal/issued-invoices` do **Plantae**: lista NF-e 55 **emitidas**, somente leitura, "nao entrega XML nem DANFE" | **nada** |

`issued-invoices` **nao e emissao** e **nao e NFS-e**. A API do Plantae nao emite nada.

## 2. O que o repositorio decide (ADR 0003)

"NFS-e e fase posterior, independente do Plantae, pela integracao oficial com **NFS-e Nacional (Gov.br)**.
Exigira **certificado digital ICP-Brasil**, que nao fica no repositorio nem no cofre do n8n." Esta e a unica
orientacao documentada. **Nao ha** decisao sobre municipio, provedor municipal ou emissor terceirizado.

## 3. O que foi consultado (fontes oficiais; NAO verificado em operacao)

- O portal oficial da **NFS-e Nacional (gov.br/nfse)** publica *documentacao tecnica*, entre elas o **Manual de
  Contribuintes — Emissor Publico API do Sistema Nacional NFS-e (v1.2, out/2025)** e os manuais das APIs do ADN
  (Ambiente de Dados Nacional). Ha ambiente **"Produção Restrita"** para testes antes da producao.
- Fonte secundaria (agregador comercial) resume a autenticacao como **mTLS com certificado ICP-Brasil A1/A3**, XML
  assinado (DPS — Declaracao de Prestacao de Servicos) e JSON nas rotas. **Confirmar no manual oficial** antes de
  qualquer codigo: nao foi lido o manual por inteiro, e o endereco do ambiente restrito, o desenho exato do mTLS e
  os tipos de certificado aceitos **nao foram confirmados**.
- Um relato isolado em forum aponta rejeicao de certo tipo de certificado e-CNPJ; **nao ha confirmacao oficial**.

Fontes: portal gov.br/nfse (documentacao tecnica, manual de contribuintes v1.2 out/2025); relatos de comunidade e
agregadores como pistas, nao como especificacao.

## 4. O que falta obter (todos dependem de voce / de terceiros)

1. **Emissor:** NFS-e Nacional (ADN) **ou** provedor municipal **ou** terceirizado. Depende do **municipio** do
   prestador e de ele ter **aderido** ao padrao nacional (nao verificado).
2. **Prestador:** CNPJ, inscricao municipal, regime tributario (ex.: Simples/MEI/Lucro), municipio de incidencia.
3. **Certificado digital ICP-Brasil (A1 ou A3)** do prestador + senha: sob custodia **so do backend** (arquivo/cofre do
   servidor), **nunca** no Git, no n8n ou no frontend.
4. **Ambiente de homologacao** (Producao Restrita) com **CNPJ e certificado de teste**; credenciais de producao so apos aceite.
5. **Dados fiscais obrigatorios** do servico e do tomador: codigo de tributacao nacional/municipal, descricao,
   aliquota/ISS (retido ou nao), valor, local da prestacao, dados do tomador (CPF/CNPJ). Quais campos o sistema receberia
   por conversa ou de outro cadastro e **nao** foi definido.
6. **Regras de negocio da cliente:** quem pode emitir, limites de valor, necessidade de dupla confirmacao.
7. **Entrega do documento:** PDF (DANFSe) e XML — quem recebe e por qual canal (o chat nao e ponta a ponta).

## 5. Acoes que exigem confirmacao humana (regra do projeto)

Emitir e cancelar sao **operacoes fiscais** com efeito legal: **nunca automaticas**, nunca por mensagem ambigua, nunca
sem **confirmacao explicita** (resumo dos dados + "confirmo emitir" por quem tem permissao propria). Consulta de situacao
e download do XML/PDF podem ser comandos de leitura, com RBAC proprio.

## 6. Desenho proposto (NAO implementado; so para quando os itens da secao 4 existirem)

- `NfseProvider` (interface): `emitir(dps)`, `consultar(chave | idDps)`, `cancelar(chave, motivo)`, `baixarXml/Pdf(chave)`.
- Implementacao de cada emissor atras da interface; certificado e mTLS **so** no backend; `idDps` determinístico como
  chave de **idempotencia** (a emissao nao pode duplicar).
- Estados explicitos (`RASCUNHO` -> `AGUARDANDO_CONFIRMACAO` -> `ENVIADA` -> `AUTORIZADA`/`REJEITADA` -> `CANCELADA`),
  tabela propria com migration, auditoria sem dado fiscal em log.
- Comandos de chat so de **consulta**; emissao/cancelamento com fluxo de confirmacao em duas etapas e permissao exclusiva.
- Testes com fixtures ficticias e emissor falso; homologacao real antes de qualquer producao.

**Por que nao foi codificado agora:** sem emissor, manual lido por inteiro, ambiente de teste e certificado, qualquer
interface seria um palpite sobre contratos fiscais — e um erro aqui tem consequencia legal. O custo de esperar e baixo;
o de errar e alto.
