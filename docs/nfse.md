# NFS-e Nacional (Emissor Público Nacional / Sefin Nacional)

> **Estado: IMPLEMENTADA e TESTADA com simulação. NÃO validada contra a Sefin Nacional.**
> Nenhuma nota foi emitida, nenhuma chamada foi feita à Sefin (restrita ou produção), nenhum certificado real
> existe no projeto. **Desligada por padrão** (`NFSE_ENABLED=false`: os comandos respondem "desligada").
> Não declarar a NFS-e operacional sem: certificado, autorização da empresa, validação do contrato de troca em
> produção restrita e uma emissão de teste aceita (seção 9).

## 1. Contratos oficiais consultados (todos baixados e lidos)

Fonte: portal oficial `gov.br/nfse` → Documentação Técnica → Documentação Atual (página atualizada em 15/08/2026).

| Documento | Versão | Uso |
| --- | --- | --- |
| Manual de Contribuintes — Emissor Público Nacional (API) | v1.2, out/2025 | rotas, fluxo, ambientes |
| Esquemas XSD (`NFSe-ESQUEMAS_XSD`) | **v1.01, 09/02/2026** | geração e validação da DPS (cópia em `backend/src/modules/integrations/nfse/xsd/producao-2026-02-09/`; o pacote da produção restrita de 20/10/2026 fica ao lado, ver [`nfse-leiautes.md`](nfse-leiautes.md)) |
| Anexo I — DPS/NFS-e (leiaute e regras de negócio) | v1.01, 09/02/2026 | campos, regras E####, assinatura, certificado |
| Anexo II — Pedido de Registro de Evento | v1.01, 22/01/2026 | eventos (cancelamento) |
| Anexo A — Município IBGE | v1.00, 10/12/2025 | Belo Horizonte = `3106200` |

Não confundir (e não usados aqui): NF-e modelo 55 (`issued-invoices` do Plantae é leitura de NF-e e não é emissão),
APIs do **ADN** para distribuição/compartilhamento (municípios), e a NFS-e **Via** / emissão por decisão judicial.

## 2. O que está CONFIRMADO, parcial ou pendente (itens da Etapa 1)

| # | Item | Situação | Base |
| --- | --- | --- | --- |
| 1 | Método de emissão | **Confirmado**: `POST /nfse` (Sefin Nacional), síncrono; recebe a DPS XML assinada, devolve a NFS-e (XML) ou a rejeição | Manual §1.3 |
| 2 | Campos obrigatórios da DPS | **Confirmado** | XSD v1.01 + Anexo I (`TCInfDPS`: tpAmb, dhEmi, verAplic, serie, nDPS, dCompet, tpEmit, cLocEmi, prest, serv, valores) |
| 3 | Requisitos de Belo Horizonte | **PENDENTE**: o convênio e os parâmetros do município (`GET /parametros_municipais/{cod}/convenio`, alíquotas, `cTribMun`, regimes) só são lidos com certificado. Regra E0037 exige o município conveniado e ativo | Manual §1.1; Anexo I |
| 4 | Regras fiscais 2026 | **Confirmado** os layouts; IBS/CBS: declarável a partir da competência 01/01/2026, **opcional só para optantes do Simples até 2027** (não optante = grupo exigido: **não implementado**, a ativação é bloqueada) | Anexo I |
| 5 | Autenticação da API | **Confirmado**: certificado digital ICP-Brasil do transmissor (mTLS). Regras E1200–E1209: versão 3, não-CA, KeyUsage "autenticação cliente", cadeia ICP-Brasil, extensão CNPJ/CPF (OID 2.16.76.1.3.3 / .1) | Anexo I, RN_RECEPCAO_DPS |
| 6 | Assinatura XML | **Parcial**: assinatura da DPS é **obrigatória** na API, com o certificado do emitente (E0714–E0718). **O algoritmo não é fixado** nos documentos obtidos: escolha do projeto = RSA-SHA256, C14N inclusiva, enveloped, `Reference` em `#Id` de `infDPS`. **A confirmar** em produção restrita | Anexo I |
| 7 | Ambientes | **Confirmado**: produção restrita e produção; `tpAmb` 1 = produção, 2 = homologação. Hosts da documentação: `sefin.producaorestrita.nfse.gov.br/API/SefinNacional` e `sefin.nfse.gov.br/SefinNacional`; o caminho-base de chamada foi **derivado** do endereço do Swagger e não foi testado | página "APIs" |
| 8 | Consulta | **Confirmado** (rotas): `GET /nfse/{chaveAcesso}`; `GET`/`HEAD /dps/{id}` (chave a partir do Id da DPS; só para ator da nota) | Manual §1.3–1.4 |
| 9 | Cancelamento | **Parcial**: evento `101101` via `POST /nfse/{chave}/eventos`, pedido assinado, leiaute nos XSD `pedRegEvento`/`tiposEventos`. O **corpo JSON** da rota não foi verificado → **`/nfse_cancelar` NÃO implementado** (regra do projeto) | Manual §1.5; Anexo II |
| 10 | Retorno de XML | **Confirmado**: XML da NFS-e na resposta e em `GET /nfse/{chave}` | Manual |
| 11 | DANFSe/PDF | **PENDENTE**: existe uma API "DANFSE" no ADN, mas o contrato não pôde ser lido. Não implementado; o PDF se obtém na consulta pública do portal com a chave | página "APIs" |

**Por que alguns itens ficaram "pendentes"**: o Swagger oficial (`.../docs/index`) responde **HTTP 403** a quem não apresenta
certificado digital, e o ADN exige TLS mútuo. Os manuais publicados descrevem rotas e regras, mas **não os nomes dos campos
do JSON**. Nada foi inventado: o formato de troca está isolado em `nfse-wire.ts` e **travado** por
`NFSE_WIRE_CONTRACT_CONFIRMED=false` (seção 9).

### Defeito no esquema oficial
O `TSSerieDPS` (`tiposSimples_v1.01.xsd`) usa `^0{0,4}\d{1,5}$`. Em XSD `^` e `$` são **caracteres literais**; assim o
padrão não casa com valor algum. O validador remove as âncoras **só na cópia em memória**; o arquivo em `xsd/producao-2026-02-09/` permanece
como publicado. Vale reportar ao suporte da NFS-e Nacional.

## 3. Arquitetura

```
Telegram / WhatsApp ─► identidade (vínculo) ─► RBAC ─► Command Engine ─► NfseService
                                                                           │
   /nfse            valida ─► DPS (XML) ─► XSD oficial ─► grava AGUARDANDO_CONFIRMACAO ─► resumo + código
   /nfse_confirmar  consome o código (1 vez) ─► DPS ─► XSD ─► ASSINA ─► XSD ─► POST /nfse (mTLS) ─► estado final
   /nfse_status     consulta (e reconcilia INCERTA por GET, nunca por reenvio)
```

Módulo isolado `backend/src/modules/integrations/nfse/` (sem rota HTTP, sem n8n, sem dependência de canal, Plantae ou
módulos de negócio — há teste de arquitetura). Telegram e WhatsApp chegam pela **mesma** cadeia já existente.

| Arquivo | Papel |
| --- | --- |
| `nfse-settings.ts` | configuração e validação (`NFSE_*`); nada de padrão tributário |
| `nfse-dps.ts` | argumentos, validação fiscal (CPF/CNPJ, valor decimal exato, códigos), resumo |
| `nfse-xml.builder.ts` | DPS no leiaute v1.01 (ordem do `xs:sequence`, sem prefixo, UTF-8, escape) |
| `nfse-layout.ts` / `nfse-xsd.validator.ts` | leiaute por ambiente (produção × restrita, ver [`nfse-leiautes.md`](nfse-leiautes.md)) e validação contra o XSD oficial do leiaute (xmllint/WASM) |
| `nfse-certificate.ts` / `nfse-signer.ts` | abre o `.pfx` em memória, confere CNPJ do certificado, assina (XMLDSig) |
| `nfse-wire.ts` | formato de troca com a Sefin (**não confirmado**, conservador: na dúvida = incerta) |
| `nfse-api.client.ts` | único ponto de rede: mTLS, destino fixo, sem redirecionamento, prazo, limite de resposta |
| `nfse-emission.entity.ts` / `nfse-emissions.repository.ts` | tabela `nfse_emissions` e transições condicionais |
| `nfse.service.ts` / `nfse.commands.ts` | regras do fluxo e comandos `/nfse`, `/nfse_confirmar`, `/nfse_status` |

Migration: `1791700000000-NfseEmissions` (MySQL executável; Oracle escrita e **nunca executada**).

## 4. Comandos e estados

| Comando | Permissão | O que faz |
| --- | --- | --- |
| `/nfse campo=valor …` | `nfse:emit` | valida, **não emite**; mostra o resumo fiscal e gera o código |
| `/nfse_confirmar <nº> <código>` | `nfse:emit` | consome a confirmação (uma vez) e transmite |
| `/nfse_status [nº]` | `nfse:read` | situação dos pedidos; reconcilia os incertos por consulta |

Campos de `/nfse` (**todos obrigatórios, nada é presumido**): `tomador` (CPF/CNPJ com dígito verificador), `nome`, `valor`,
`servico` (código nacional, 6 dígitos), `desc`, `iss` (1 tributável | 4 não incidência), `ret` (1/2/3), `local` (IBGE).
Opcionais: `aliq` (≤ 5%), `competencia`; ME/EPP exige `totsn`. Imunidade/exportação (`iss` 2 e 3) e substituição **não são
suportadas** (exigem dados que não existem aqui).

```
AGUARDANDO_CONFIRMACAO ─► ENVIANDO ─► AUTORIZADA
        │                     ├──────► REJEITADA   (código oficial E####; nada emitido)
        └─► EXPIRADA          ├──────► NAO_ENVIADA (certeza de que nada saiu)
                              └──────► INCERTA ──(só por CONSULTA)──► AUTORIZADA
```

Confirmação **vinculada**: o código é aleatório (8 caracteres, 5 bits cada), amarrado à pessoa, ao **canal** de origem e àquele
pedido; vale por 10 min (configurável 2–30) e **uma vez**; só o hash é gravado. O resumo exibido é gravado como hash e
reconferido antes de assinar. Um novo `/nfse` cancela o pedido pendente anterior. Um "sim" solto nunca confirma.

## 5. Proteção contra duplicidade (cada item tem teste, e os principais foram mutados)

- **Update repetido do canal**: a idempotência por mensagem do Telegram/WhatsApp já existe e a confirmação é independente.
- **Confirmação repetida / simultânea / Telegram × WhatsApp**: `UPDATE … WHERE status='AGUARDANDO…' AND hash AND dono AND canal AND prazo`:
  exatamente um chamador ganha; outro canal ou outra pessoa recebe "não encontrado".
- **Mesma DPS**: o `Id` da DPS é determinístico (`município+tipo+CNPJ+série+nº`); índices únicos por ambiente.
- **Timeout / resposta ilegível / 5xx / queda após envio**: estado **`INCERTA`**. Não há retentativa automática. `/nfse_status`
  só **consulta** (`GET`); "não encontrada" **não** prova que não houve emissão, então continua `INCERTA`.
- **Processo caiu no meio do envio**: `ENVIANDO` parado > 2 min vira `INCERTA` na próxima consulta.
- **Banco fora ao gravar o resultado**: o chat recebe "incerta"; nenhuma rejeição não tratada.
- A resposta do chat espera a Sefin até 12 s; passando disso diz "em processamento" e a transmissão termina sozinha.

## 6. Segurança operacional

- **Desligada por padrão**; ligada exige configuração completa (o boot é recusado) e **bloqueia** optante não-Simples.
- **Permissões próprias** `nfse:emit` / `nfse:read`: nenhum perfil as tem por padrão, **OPERADOR inclusive**; só o ADMIN
  (que passa em qualquer verificação). Conceder é decisão explícita da cliente.
- Certificado: `.pfx` fora do Git e da imagem, montado somente leitura; senha só no `.env` do servidor; aberto **em memória**,
  só pelo backend. O CNPJ do certificado (OID 2.16.76.1.3.3) precisa ser o do prestador, senão **nada é assinado**.
  Nenhum log (o módulo não usa `Logger`/`console`/`process.env`, testado), nenhuma auditoria, nenhum n8n, nenhum frontend.
- Auditoria (`NFSE_COMMAND`, `NFSE_STATE_CHANGED`): quem, estado, código oficial. **Nunca** tomador, valor, descrição,
  código de confirmação, chave de acesso ou XML.
- Dados do tomador ficam na tabela `nfse_emissions` (dado pessoal, sem rota que o devolva); mascarados no chat.
- Telegram **não é ponta a ponta**: a chave de acesso trafega no texto. O XML/PDF **não** são enviados por chat.
- Destino da API fixo no ambiente; sem redirecionamento; resposta limitada; só servidor de teste em `http`.

## 7. Configuração (`.env` do servidor; ver `.env.example`)

`NFSE_ENABLED`, `NFSE_AMBIENTE` (`restrita`|`producao`, sem padrão), `NFSE_CERT_PFX_PATH`, `NFSE_CERT_PFX_PASSWORD`,
`NFSE_PRESTADOR_CNPJ` (+ `NFSE_PRESTADOR_IM`, `NFSE_PRESTADOR_NOME`), `NFSE_MUNICIPIO_EMISSOR_IBGE`, `NFSE_OPCAO_SIMPLES`
(2 ou 3), `NFSE_REGIME_APURACAO_SN`, `NFSE_REGIME_ESPECIAL_TRIBUTACAO`, `NFSE_DPS_SERIE` (1–49999), `NFSE_VALOR_MAXIMO`,
`NFSE_CONFIRMATION_TTL_MINUTES`, `NFSE_WIRE_CONTRACT_CONFIRMED` (padrão `false`), `NFSE_CA_BUNDLE_PATH` (opcional),
`NFSE_API_BASE_URL` (**só teste**). O Compose repassa as variáveis **somente ao backend**.

## 8. O que depende da empresa, do certificado e do município (nada disto foi feito)

1. **Certificado digital A1 (ICP-Brasil, e-CNPJ)** da Vasta Participações, e a senha, em canal seguro (nunca no chat).
2. **Dados do prestador**: CNPJ, inscrição municipal (BH), razão social, regime (MEI, ME/EPP ou não optante), regime especial.
   **Não optante exige o grupo IBS/CBS, ainda não implementado**: se a empresa não é do Simples, é preciso definir a classificação
   tributária (`cClassTrib`), a NBS e usar a Calculadora oficial — decisão fiscal, não código.
3. **Belo Horizonte**: confirmar com a Prefeitura/contador que o município é **conveniado e ativo** no padrão nacional e o
   que o convênio exige (alíquotas, `cTribMun`, regime, retenções). Hoje não verificável sem certificado.
4. **Códigos de serviço** (tributação nacional) usados pela cliente e a regra de ISS/retenção de cada um.
5. **Limite de valor por emissão** e **quem** pode emitir (conceder `nfse:emit` a uma pessoa é decisão da cliente).
6. Entrega do documento: PDF/XML por qual canal (o chat não é ponta a ponta; envio de arquivo não existe nos canais).

## 9. Como validar e liberar (somente com autorização e em produção restrita)

1. Obter um certificado/CNPJ de **teste** e o acesso à produção restrita. 2. Montar o `.pfx` somente leitura; preencher o `.env`
com `NFSE_AMBIENTE=restrita`. 3. Com o Swagger agora acessível (com o certificado), **conferir**: nomes dos campos do JSON
(`dpsXmlGZipB64`, `chaveAcesso`, `nfseXmlGZipB64`, lista de erros), o caminho-base, o algoritmo de assinatura e a aceitação do
leiaute; corrigir `nfse-wire.ts`/`nfse-signer.ts` se divergirem. 4. Só então `NFSE_WIRE_CONTRACT_CONFIRMED=true`, recriar **só
o backend** (a migration roda antes) e emitir **uma** nota de teste com um usuário ADMIN. 5. Conferir rejeição, incerteza (derrubar
a rede) e reconciliação. 6. Só depois pensar em `producao` (exige `NFSE_WIRE_CONTRACT_CONFIRMED=true`).
Rollback: `NFSE_ENABLED=false` e recriar o backend (a tabela e o histórico permanecem).

## 10. Limitações

Sem cancelamento (`/nfse_cancelar`), sem substituição, sem imunidade/exportação, sem IBS/CBS (logo, sem não optante), sem
DANFSe/PDF, sem envio de arquivo por chat, sem retentativa automática (de propósito), Oracle nunca executado, mTLS e TLS
com a Sefin real nunca exercitados (os testes usam servidor em loopback), `NT 005` (previsto para 2026) pode alterar o leiaute,
e a rotação do certificado exige reiniciar o backend (o certificado é aberto uma vez por processo).

## 11. Testes

Unitários (configuração, validação fiscal, XML, **XSD oficial** com casos positivos e negativos, certificado e **assinatura**
com adulteração, contrato de troca, cliente contra servidor real em loopback com timeout/queda/redirecionamento/resposta
gigante, repositório com índices únicos, serviço com 28 cenários, comandos/RBAC/auditoria, arquitetura) e e2e
(`test/nfse.e2e-spec.ts`: aplicação completa, certificado fictício gerado na hora, Sefin falsa; `test/nfse-disabled.e2e-spec.ts`).
O certificado de teste (`backend/test/support/nfse-test-pki.ts`) é autoassinado e fictício: nenhum arquivo de certificado
existe no repositório.
