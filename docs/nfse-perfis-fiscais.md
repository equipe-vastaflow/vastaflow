# NFS-e: perfis fiscais (empresa não optante pelo Simples Nacional)

> **Estado: estrutura implementada (etapa 2). Nenhum perfil existe no repositório, e nenhum código ou valor é padrão.**
> A emissão para empresa não optante só acontece com um **perfil fiscal completo, válido e aprovado pela contadora**.
> `NFSE_ENABLED` segue `false`. O comando `/nfse` do Telegram (etapa 3) seleciona o perfil pelo `servico=` e recebe o endereço do
> tomador por argumentos: ver [`nfse.md`](nfse.md), seção 4.

## 1. Para que serve

Empresa **não optante** deve informar o grupo **IBS/CBS** e outros dados que ME/EPP não informa. Esses dados (códigos de
serviço, classificação tributária, retenções federais, total aproximado de tributos) são **decisão fiscal da contadora**. O
perfil fiscal é o registro dessa decisão, **por serviço**, versionado e aprovado.

A nota 344 da Quasar foi usada **só para comparar estrutura** (auditoria). Nenhum código, alíquota, valor ou numeração dela
foi copiado para o código, para a configuração ou para os testes.

## 2. Onde ficam

- Um arquivo **JSON fora do repositório**, apontado por `NFSE_PERFIS_FISCAIS_PATH` (caminho **dentro do container**).
  Montado somente leitura, como o certificado. O Compose repassa a variável **só ao backend**.
- Obrigatório quando `NFSE_OPCAO_SIMPLES=1` (não optante); **recusado** nos outros regimes (ME/EPP e MEI não usam perfil).
- Lido a **cada pedido** e a **cada transmissão**: revogar ou alterar o arquivo vale na hora, sem reiniciar.
- Limite de 512 KB. Arquivo ilegível, quebrado ou com **qualquer** problema **não libera nenhuma emissão** (fail-closed).

## 3. Formato (`versaoEsquema: 1`)

```jsonc
{
  "versaoEsquema": 1,
  "perfis": [
    {
      "id": "nome-do-servico",            // 3 a 40: letras minúsculas, números e hífen
      "versao": 1,                         // inteiro >= 1; cada mudança de conteúdo é uma NOVA versão
      "descricao": "texto de uma linha",
      "servico": {
        "cTribNac": "NNNNNN",              // 6 dígitos. É a CHAVE: o /nfse seleciona o perfil por servico=
        "cTribMun": "NNN" | null,          // 3 dígitos; null se o município não exige
        "cNBS": "NNNNNNNNN"                // 9 dígitos (Anexo B)
      },
      "permitidos": {                      // o que o pedido pode usar (iss=, ret=); fora disso é recusado
        "tribIssqn": [1],                  // 1 = tributável, 4 = não incidência
        "tpRetIssqn": [1, 2]               // 1 = não retido, 2 = retido pelo tomador, 3 = pelo intermediário
      },
      "tomador": { "exigeEndereco": true },   // se a contadora exige o endereço do tomador na DPS
      "tribFed": null | {                  // tributos federais
        "piscofins": null | { "cst": "NN", "tpRetPisCofins": "N" | null },
        "retencoes": null | { "cpPct": "N.NN" | null, "irrfPct": "N.NN" | null, "csllPct": "N.NN" | null }
      },
      "totTrib": { "tipo": "indicador" }                                   // indTotTrib = 0 (não informar)
               | { "tipo": "percentuais", "fed": "N.NN", "est": "N.NN", "mun": "N.NN" }   // pTotTrib
               | { "tipo": "valores",     "fed": "N.NN", "est": "N.NN", "mun": "N.NN" },  // vTotTrib = % x valor do serviço
      "ibscbs": {
        "indDest": 0 | 1,
        "cIndOp": "NNNNNN",                // 6 dígitos (Anexo C)
        "indFinal": 0 | 1 | null,          // a NT 005 o descontinua; null = não informar
        "tpOper": 1..5 | null,             // só operações com ente governamental / imóveis
        "tpEnteGov": 1..4 | null,          // só compras governamentais
        "cst": "NNN",                      // 3 dígitos
        "cClassTrib": "NNNNNN"             // 6 dígitos
      },
      "aprovacao": {
        "status": "rascunho" | "aprovado" | "revogado",
        "aprovadoPor": "nome de quem aprovou" | null,
        "aprovadoEm": "AAAA-MM-DD" | null,
        "conteudoSha256": "<hash do conteúdo aprovado>" | null
      }
    }
  ]
}
```

O arquivo é **estrito**: campo desconhecido, ausente ou fora do formato é problema (nada é presumido). `tribFed` e `totTrib`
precisam estar presentes (use `null` em `tribFed` quando não há tributo federal); os demais campos opcionais podem ser `null`
ou omitidos. As mensagens de erro citam o **campo** e o `id`, nunca o valor.

## 4. Versionamento e aprovação

1. **Rascunho:** quem prepara o perfil o grava com `status: "rascunho"` e sem aprovação.
2. **Folha de aprovação:** `node dist/modules/integrations/nfse/nfse-fiscal-profile.cli.js show <arquivo> <id> <versao>` imprime
   o conteúdo canônico do perfil **sem** o bloco de aprovação e o seu **hash** (`conteudoSha256`). É o que a contadora revisa.
3. **Aprovação:** com o aval da contadora, registra-se `status: "aprovado"`, `aprovadoPor`, `aprovadoEm` e o `conteudoSha256`
   mostrado no passo 2.
4. **Conferência:** `... nfse-fiscal-profile.cli.js check <arquivo>` mostra, por perfil, se está **UTILIZAVEL** e o hash esperado.
5. **Mudança de conteúdo = nova versão** (`versao + 1`, em rascunho até nova aprovação). Alterar um perfil já aprovado **sem**
   nova aprovação faz o hash não conferir: o perfil deixa de valer.
6. **Revogação:** `status: "revogado"`.

Regras de uso (todas testadas):

- só vale perfil `aprovado`, com aprovador, data (não futura) e hash que **confere** com o conteúdo;
- de cada `id` vale a **maior versão**; se ela não estiver aprovada, o serviço fica **indisponível** (não se volta à versão anterior);
- dois `id` diferentes para o mesmo `cTribNac` são **ambíguos** e recusam;
- o `/nfse` seleciona o perfil pelo `servico=` (que é o `cTribNac`); sem perfil, **não há emissão**.

## 5. Como o perfil entra na emissão

1. **Pedido:** o perfil é selecionado e validado; confere-se que `iss=` e `ret=` são **permitidos**; calculam-se, com aritmética
   decimal exata (BigInt, arredondamento meio para cima), as retenções federais e o total de tributos a partir do valor do
   serviço. O resultado, um **instantâneo** (perfil id, versão, aprovador, hash e valores), é gravado com o pedido.
2. **Resumo:** o resumo mostrado a quem vai confirmar inclui perfil/versão/aprovador, os códigos, o IBS/CBS, as retenções e o
   total de tributos. O **endereço do tomador não é mostrado**: entra no hash por uma referência curta (`ref.`). O **hash do
   resumo continua amarrado ao pedido**, como antes.
3. **Confirmação** (inalterada: código de uso único, mesma pessoa, mesmo canal, prazo): a DPS é refeita **do instantâneo**, não
   do arquivo; antes de transmitir confere-se que o perfil **continua** vigente, aprovado e com o mesmo hash. Se foi revogado ou
   alterado depois do pedido, o resultado é `NAO_ENVIADA` (`perfil_fiscal_indisponivel`) e **nada é enviado**.
4. **Duplicidade, `INCERTA`, reconciliação por consulta, auditoria:** inalterados.

## 5.1 Compatibilidade com o gerador de DPS (rejeição antes do pedido)

Aprovar um perfil **não basta**: ele só é utilizável se o VastaFlow consegue gerar uma DPS válida para ele. `checkProfile`
roda, depois da checagem de aprovação e integridade, o conferidor `nfse-profile-compat.ts`. Perfil incompatível fica
**NAO utilizável** (motivo `incompativel com o gerador de DPS (REGRA: ...)`), o pedido nem é criado e o `check` da CLI o aponta
(inclusive em rascunho); o `show` **não gera hash** para ele, para não se aprovar o que não emite. A aprovação e o hash do
conteúdo **não são alterados** por isso. As mensagens citam campo e regra, nunca valores. Só vale para empresa não optante: o
fluxo ME/EPP não passa por aqui.

Fonte das regras: Anexo I (SEFIN ADN DPS, v1.01 de 20/10/2026, produção restrita) e tabelas oficiais (Anexos B e C), embutidas
em `nfse/tabelas/` (arquivos gerados, com fonte e SHA-256 do `.xlsx`).

| Regra | O que recusa | Origem |
| --- | --- | --- |
| TAB-1 | `cTribNac` fora da lista de serviço nacional | Anexo B (338 códigos) |
| TAB-2 | `cNBS` fora da NBS 2.0 | Anexo B (918 códigos) |
| TAB-3 | `cIndOp` fora da tabela | Anexo C (26 códigos) |
| SRV-1 | `cTribNac` 99.03.xx ou 99.04.01 | Anexo I: "deve ser rejeitada" |
| OP-1 | `cIndOp` cujo local depende de `prest/end`, `dest`, `endExt`, `atvEvento` ou NFS-e Via (não gerados) | Anexo C, coluna "campo no leiaute" |
| OP-2 | `cIndOp` de imóvel fora dos subitens de construção civil (exige grupo `imovel`, não gerado) | Anexo C + Anexo I |
| END-1 | local = endereço do adquirente, `indDest=0` e `exigeEndereco=false` | Anexo I |
| END-2 | `tpRetIssqn` inclui 2 e `exigeEndereco=false` | Anexo I |
| DEST-1 | `indDest=1` (exige `dest`, não gerado) | Anexo I |
| REF-1 | `tpOper` 2 ou 3 (exige `gRefNFSe`, não gerado) | Anexo I |
| OPER-1 / OPER-2 | `tpOper` ausente quando obrigatório (com `tpEnteGov` ou serviços 25.05, 15.09, 17.12, 10.05) / informado fora disso | Anexo I |
| PC-1 / PC-2 | CSLL retida ausente com `tpRetPisCofins` ≠ 0 e ≠ 2 / presente com `tpRetPisCofins=0` | Anexo I |

### Pendências (NÃO verificadas: nenhuma regra foi inventada)

- **`cClassTrib` e CST** (IBS/CBS): só o formato é conferido. Não há tabela oficial nos anexos; quem valida é a Calculadora do
  IBS/CBS. **Depende da contadora** e do teste na produção restrita.
- **Correlação serviço × NBS × `cIndOp` × `cClassTrib`** (Anexo VIII): documento não vinculante e em desenvolvimento; não usado.
- **`tpEnteGov` por serviço** e restrições finas de `tpOper` por subitem além das acima: o texto dos anexos não permitiu provar.
- **`cTribMun`** (código municipal de BH): sem tabela disponível; **depende da contadora/prefeitura**.
- **Grupos não gerados** (`dest`, `gRefNFSe`, `imovel`, `prest/end`, `endExt`, `atvEvento`, `bensMoveis`): perfis que os exigem
  são recusados (regras acima); gerá-los exigiria nova etapa.

## 6. Limitações (o que ainda impede uma emissão real)

- **O endereço do tomador agora vem por argumentos do `/nfse`** (`cmun`, `cep`, `logradouro`, `numero`, `bairro`, `compl`). Com
  `exigeEndereco: true` o pedido é recusado sem ele; com `false`, o endereço informado é recusado. Outros dados que um perfil
  possa vir a exigir (`dest`, `imovel`...) continuam **sem** campo no comando.
- **O texto do comando passa pelo Telegram** (e pelo n8n, no modo `n8n`): o endereço e o documento do tomador trafegam como o
  resto do comando. Não é ponta a ponta, como já consta em `docs/nfse.md`, seção 6.
- **Perfil real, certificado e permissões:** nada disso existe ainda (ver `docs/nfse.md`, seção 8).
- **Calculadora do IBS/CBS:** a Sefin valida CST, classificação e valores contra a Calculadora oficial (erros E1000 e
  correlatos). O VastaFlow **não consulta a Calculadora**: acerto ou erro só se vê na produção restrita.
- **Regras de retenção por tomador** (limites, dispensas, quem retém) **não são modeladas**: o perfil aplica percentuais fixos
  aprovados pela contadora. Se a retenção depende do tomador, é preciso um perfil por situação (e a seleção por `cTribNac` hoje
  admite um perfil por serviço) ou evoluir a seleção.
- **`vTotTrib` por percentual** do valor do serviço: se a contadora usar outro método, o perfil `valores` não serve.
- **CNPJ alfanumérico** (prestador e tomador) **não é suportado**; só numérico.
- **`tpOper`/`tpEnteGov`, `dest`, `imovel`, `gRefNFSe`, `bensMoveis`, `cCredPres`, diferimento e tributação regular**: o grupo
  gerado cobre `indFinal`, `cIndOp`, `tpOper`, `tpEnteGov`, `indDest`, `CST` e `cClassTrib`. O restante **não** é gerado.
- **Contrato JSON com a Sefin, algoritmo de assinatura, parâmetros de BH:** continuam dependendo de teste na API oficial.

## 7. Amostra SINTÉTICA (só para entender o formato)

Os valores abaixo são **inventados** e **não** servem como configuração (não correspondem a nenhum serviço real). Os testes usam
perfis sintéticos equivalentes em `backend/test/support/nfse-profile-fixtures.ts`.

```json
{
  "versaoEsquema": 1,
  "perfis": [
    {
      "id": "servico-sintetico",
      "versao": 1,
      "descricao": "Perfil sintetico de exemplo (sem valor fiscal)",
      "servico": { "cTribNac": "010301", "cTribMun": null, "cNBS": "101011100" },
      "permitidos": { "tribIssqn": [1], "tpRetIssqn": [1] },
      "tomador": { "exigeEndereco": true },
      "tribFed": null,
      "totTrib": { "tipo": "indicador" },
      "ibscbs": { "indDest": 0, "cIndOp": "288888", "indFinal": null, "tpOper": null, "tpEnteGov": null, "cst": "288", "cClassTrib": "288888" },
      "aprovacao": { "status": "rascunho", "aprovadoPor": null, "aprovadoEm": null, "conteudoSha256": null }
    }
  ]
}
```
