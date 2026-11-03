# NFS-e Nacional: leiautes XML/XSD por ambiente

> **Estado: etapa 1 (versionamento). O gerador de DPS continua produzindo SÓ o leiaute de produção.**
> A restrita já tem o seu pacote XSD e o seu validador, mas o builder ainda não gera o que ela exige
> (diferença 1 abaixo). Nada de IBS/CBS, emissão ou comando novo foi implementado. `NFSE_ENABLED` segue `false`.

## 1. Os dois pacotes

| Leiaute (`NfseLayoutId`) | Ambiente | Pasta em `backend/src/modules/integrations/nfse/xsd/` | Publicado | Fonte oficial |
| --- | --- | --- | --- | --- |
| `producao-2026-02` | produção | `producao-2026-02-09/` | 09/02/2026 | "Documentação atual" (`NFSe-ESQUEMAS_XSD-v1.01-20260209`) |
| `restrita-2026-10` | produção restrita | `restrita-2026-10-20/` | 20/10/2026 | "Produção restrita" (`esquemas_prod_restrita_20261020`) |

- Os **dois declaram `versao="1.01"`** e usam os mesmos nomes de arquivo (`DPS_v1.01.xsd` etc.). O atributo `versao` **não
  distingue** um pacote do outro: por isso existe um identificador próprio, o `NfseLayoutId`.
- Os arquivos são os **oficiais, sem nenhuma edição**. `xsd/MANIFEST.json` guarda o SHA-256 de cada um (calculado após
  normalizar o fim de linha para LF, pela política do repositório) e o SHA-256 do `.zip` baixado; um teste derruba o build se
  qualquer arquivo mudar.
- A produção confirmou o pacote de fevereiro: uma NFS-e real de produção emitida em 30/10/2026 valida contra ele e **não**
  valida contra o de 20/10/2026 (o arquivo dessa nota fica fora do repositório e nunca é usado como fixture).

## 2. Como o leiaute é escolhido

`nfse-layout.ts` tem uma tabela **fixa e congelada** `ambiente → leiaute`:

```
producao -> producao-2026-02
restrita -> restrita-2026-10
```

- O `NfseService` obtém o leiaute **somente** por `layoutForAmbiente(settings.ambiente)`; nenhum identificador de leiaute
  aparece no serviço.
- `validateDpsXml(xml, layout)` **exige** o leiaute (não há pacote padrão) e recusa identificador desconhecido.
- **Não existe** variável de ambiente, argumento ou configuração que mude o leiaute (testes conferem o código, o Compose, o
  `.env.example` e o `env.validation.ts`). Registro e tabela são imutáveis em tempo de execução.
- Consequência desejada: a produção **não** consegue cair no pacote da restrita, e vice-versa, por engano.

## 3. Diferenças conhecidas (produção `producao-2026-02` → restrita `restrita-2026-10`)

Só `tiposComplexos_v1.01.xsd` e `tiposSimples_v1.01.xsd` mudam de forma relevante. `DPS_v1.01.xsd`, `NFSe_v1.01.xsd`,
`evento_v1.01.xsd`, `pedRegEvento_v1.01.xsd`, `tiposEventos_v1.01.xsd` e os `CNC*` são idênticos (ignorando espaços). O
`xmldsig-core-schema.xsd` difere apenas por não trazer o `DOCTYPE` na restrita.

| # | Diferença | Produção | Restrita | Efeito no VastaFlow |
| --- | --- | --- | --- | --- |
| 1 | `finNFSe` | dentro de `IBSCBS` (grupo opcional) | **obrigatório direto em `infDPS`**, depois de `tpEmit` | A DPS do gerador atual é **rejeitada** pela restrita. **Bloqueia a emissão na restrita** até a etapa do builder |
| 2 | Ordem de `cServ` | `cTribNac, cTribMun, xDescServ, cNBS, cIntContrib` | `cTribNac, cTribMun, cNBS, cIntContrib, xDescServ` | O builder atual só gera `cTribNac` e `xDescServ` (ordem igual nos dois). Importa quando entrarem `cTribMun` e `cNBS` |
| 3 | NFS-e retornada: `vCalcReeRepRes` | existe | renomeado para `vCalcAjusteBCIBSCBS`; novo `vCalcAjusteBCLocImoveis` | Afeta a leitura da NFS-e devolvida (etapa futura) |
| 4 | NFS-e retornada: `vCalcDR` | existe | renomeado para `vCalcAjusteBCISSQN` | idem |
| 5 | CNPJ | `[0-9]{14}` | **alfanumérico** `[0-9A-Z]{14}` | Validação do tomador e do prestador (etapa futura) |
| 6 | Id da DPS | `DPS[0-9]{42}` | `DPS[0-9]{7}(1[0-9]{14}\|2[0-9A-Z]{14})[0-9]{20}` | `buildDpsId` (CNPJ alfanumérico, etapa futura) |
| 7 | Id e chave da NFS-e | `NFS[0-9]{50}` / `[0-9]{50}` / `[0-9]{44}` | com 14 posições alfanuméricas | Validação da chave de acesso (etapa futura) |
| 8 | Série (`TSSerieDPS`) | `^0{0,4}\d{1,5}$` (**defeito**: `^` e `$` literais; o validador remove as âncoras só em memória) | `[0-9]{1,4}\|[0-8][0-9]{4}` (corrigido) | Nenhum: a faixa 1 a 49999 continua valendo |
| 9 | Grupo `IBSCBS` da NFS-e | `cLocalidadeIncid`, `xLocalidadeIncid`, `valores`, `vBC`, `gIBS`, `gCBS` obrigatórios | passam a opcionais | Leitura da NFS-e devolvida |
| 10 | Locação de imóveis | ausente | novos tipos (`TCEnderImovel`, `TCRTCLocacaoImovel`, `TCRTCUnidadesImobiliarias`, `gAjusteBCLocImoveis`) e tipos de ajuste `101`–`105`, `199` | Fora do escopo (serviço da Quasar não é de locação) |
| 11 | Textos | sem restrição | padrão "não vazio" `[\s\S]*[^\s][\s\S]*` em vários tipos | Descrições em branco passam a ser recusadas |
| 12 | `indFinal` | existe | existe (opcional); a **NT 005** o descontinua, **sem data publicada** | Acompanhar a NT 005 |

**Ainda não verificado:** o texto das NT 005 e NT 009 (os PDFs não puderam ser lidos por ferramenta). A lista acima vem da
comparação dos XSDs e do Anexo I; leitura humana das notas técnicas pode acrescentar regras de negócio que os esquemas não
mostram. A data em que a produção adota o leiaute da restrita **não foi divulgada**.

## 4. O que a etapa 1 mudou no código

- `nfse-layout.ts` (novo): registro dos leiautes, tabela `ambiente → leiaute`, `layoutForAmbiente`, `getLayout`.
- `nfse-xsd.validator.ts`: carrega um pacote por leiaute (com cache) e exige o `NfseLayoutId` em `validateDpsXml`.
- `nfse.service.ts`: as três validações da DPS usam `layoutForAmbiente(settings.ambiente)`.
- `xsd/`: arquivos oficiais de produção movidos para `producao-2026-02-09/` (conteúdo idêntico), pacote da restrita em
  `restrita-2026-10-20/` e `MANIFEST.json`. O `nest-cli.json` passa a copiar `xsd/**/*.xsd` para o `dist`.
- **Nada** mudou nos campos fiscais gerados (`nfse-xml.builder.ts`, `nfse-dps.ts`, `nfse-settings.ts`).

## 5. Limitação desta etapa (restrita)

Com `NFSE_AMBIENTE=restrita`, o pedido de emissão **falha de forma fechada**: o serviço valida a DPS contra o pacote da
restrita, a rejeita (falta `finNFSe` em `infDPS`), expira o pedido e **nada é enviado**. É o comportamento correto até o
builder passar a gerar o leiaute da restrita. Os testes do fluxo do serviço e o e2e (que dependem do gerador atual) rodam com
`NFSE_AMBIENTE=producao` contra servidor de **teste** (`http`, sem rede): é o leiaute que o gerador produz hoje.
