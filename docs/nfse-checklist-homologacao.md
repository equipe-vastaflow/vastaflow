# NFS-e: checklist da primeira emissão em produção restrita

> Roteiro único, na ordem. **Só se executa com autorização de quem responde pela Quasar.** Uma nota da restrita não tem valor
> fiscal. Este documento não traz credencial, dado pessoal nem valor fiscal real: os exemplos são sempre `<marcadores>`.
> Detalhes: [`nfse.md`](nfse.md), [`nfse-mtls.md`](nfse-mtls.md), [`nfse-perfis-fiscais.md`](nfse-perfis-fiscais.md),
> [`nfse-producao-restrita.md`](nfse-producao-restrita.md).

Regra de parada: se **qualquer** item abaixo não puder ser marcado, **pare** e não ligue a NFS-e.

## 1. Preparação (sem ligar nada)

- [ ] Autorização por escrito, com data, de quem responde pela Quasar para o teste na restrita.
- [ ] Dados do prestador confirmados pela contadora: CNPJ, inscrição municipal, razão social, regime (MEI, ME/EPP ou não
      optante) e regime especial.
- [ ] Município (Belo Horizonte, IBGE `3106200`) confirmado como conveniado e ativo no padrão nacional, e o que o convênio exige.
- [ ] Definido **quem** emite: apenas usuário ADMIN. `nfse:emit` e `nfse:read` não são concedidos a mais ninguém (a conta do
      Gestor/Rizola não os recebe).
- [ ] Definido o valor máximo por emissão (`NFSE_VALOR_MAXIMO`); para o teste, um valor pequeno.
- [ ] Backup do banco da VPS feito antes de recriar o backend (a migration `nfse_emissions` roda no boot).

## 2. Certificado e senha: fora do Git, canal seguro

- [ ] O certificado A1 (`.pfx`) e a **senha** chegam por canal seguro, em mensagens separadas. **Nunca** por chat comum, e-mail
      sem proteção, issue, commit ou argumento de linha de comando.
- [ ] O `.pfx` **não** entra no repositório nem na imagem Docker (o `.gitignore` já cobre `*.pfx`/`*.p12`, mas é rede de proteção,
      não o lugar previsto). Fica num diretório do servidor fora do projeto, montado **somente leitura** no backend:
      `<diretorio-seguro-no-servidor>:/run/secrets/nfse:ro`, com permissão restrita ao usuário do serviço.
- [ ] A senha existe **só** no `.env` do servidor (`NFSE_CERT_PFX_PASSWORD`). Nunca em exemplo, doc, log ou ticket.
- [ ] O arquivo de perfis fiscais também fica **fora** do repositório e é montado somente leitura
      (`NFSE_PERFIS_FISCAIS_PATH` = caminho **dentro do container**).
- [ ] Rotação do certificado exige recriar o backend (o `.pfx` é aberto uma vez por processo).

## 3. Validação do certificado (offline, sem rede)

- [ ] Validade: dentro do prazo, tipo A1, e-CNPJ.
- [ ] O CNPJ do certificado (OID 2.16.76.1.3.3) é **o mesmo** de `NFSE_PRESTADOR_CNPJ`; senão nada é assinado.
- [ ] Certificado versão 3, não-CA, com KeyUsage de autenticação de cliente (regras E1200 a E1209).
- [ ] O `.pfx` contém as **intermediárias** da cadeia (a raiz fica de fora). Se a cadeia do servidor exigir uma CA fora do
      repositório padrão do Node, usar `NFSE_CA_BUNDLE_PATH` (**complementa** as CAs padrão; ver `nfse-mtls.md`).
- [ ] Conexão mTLS verificada conforme `nfse-mtls.md`. `rejectUnauthorized` nunca se desliga.

## 4. Perfil fiscal aprovado

- [ ] Empresa não optante: perfil por serviço, preenchido com a **contadora** (`cTribNac`, `cTribMun`, NBS, CST, `cClassTrib`,
      `cIndOp`, retenções, total de tributos). Nada é inventado nem copiado de nota real.
- [ ] `... nfse-fiscal-profile.cli.js check <arquivo>`: sem linha `incompativel`, e o perfil aparece como **UTILIZAVEL**.
- [ ] `... nfse-fiscal-profile.cli.js show <arquivo> <id> <versao>` entregue à contadora; a aprovação registra o
      `conteudoSha256` mostrado. Qualquer mudança de conteúdo depois disso invalida a aprovação.
- [ ] Ciente das pendências que só a contadora ou a Sefin resolvem (CST e `cClassTrib` só têm o formato conferido; ver
      `nfse-perfis-fiscais.md`, seção 5.1).
- [ ] Empresa optante (ME/EPP): `NFSE_OPCAO_SIMPLES` e `NFSE_REGIME_APURACAO_SN` conforme a contadora, sem
      `NFSE_PERFIS_FISCAIS_PATH`.

## 5. Contrato da API (com o certificado, somente leitura)

- [ ] Com o certificado, consultar o Swagger oficial da **restrita** (leitura) e conferir: nomes dos campos do JSON
      (`dpsXmlGZipB64`, `chaveAcesso`, `nfseXmlGZipB64`, lista de erros), caminho-base, algoritmo de assinatura e aceitação do
      leiaute.
- [ ] Divergências corrigidas em `nfse-wire.ts` / `nfse-signer.ts` **e testadas** antes de seguir.
- [ ] Só então `NFSE_WIRE_CONTRACT_CONFIRMED=true` pode ser usado, e **apenas durante o teste**.

## 6. Conferência obrigatória ANTES de qualquer teste

Faça no `.env` do servidor, em voz alta ou por escrito, e só avance se todas forem verdadeiras:

- [ ] **`NFSE_AMBIENTE=restrita`** (exatamente; não `producao`, não vazio).
- [ ] **`NFSE_PRODUCAO_AUTORIZACAO` está VAZIA ou ausente.** Se tiver qualquer valor, esvazie antes (com valor na restrita o
      boot é recusado, e na produção essa frase é o que libera a Sefin real).
- [ ] `NFSE_API_BASE_URL` vazia (o endereço vem do ambiente; essa variável é só para servidor de teste local).
- [ ] `NFSE_PRESTADOR_CNPJ` igual ao CNPJ do certificado.
- [ ] Só o **backend** será recriado (nem n8n, nem frontend, nem outros serviços).

## 7. Teste único na restrita

- [ ] `NFSE_ENABLED=true` e `NFSE_WIRE_CONTRACT_CONFIRMED=true`; recriar **só o backend** e conferir que ele subiu sem erro de
      configuração.
- [ ] Com usuário **ADMIN**, emitir **uma** nota de teste: `/nfse` com dados **fictícios ou de teste** e valor pequeno, conferir
      o resumo e confirmar com `/nfse_confirmar <numero> <codigo>`.
- [ ] Conferir: resposta (autorizada ou rejeição com código `E####`), consulta com `/nfse_status`, e que repetir o
      `/nfse_confirmar` **não** reenvia.
- [ ] Rejeição por CST/`cClassTrib`/valores é resultado esperado de homologação: ajustar **o perfil** com a contadora (nova
      versão, nova aprovação), nunca contornar a validação.
- [ ] Resultado incerto (`INCERTA`): **não reemitir**; consultar. Nunca reenviar à mão.
- [ ] Registrar o resultado (sem chave de acesso, sem dados pessoais) onde a equipe acompanha a homologação.

## 8. Desligamento após o teste

- [ ] `NFSE_ENABLED=false` **e** `NFSE_WIRE_CONTRACT_CONFIRMED=false`; recriar só o backend.
- [ ] Conferir de novo que `NFSE_PRODUCAO_AUTORIZACAO` continua vazia e que `/nfse` responde "desligada".
- [ ] Remover o `.pfx` e o arquivo de perfis do servidor, ou deixá-los só com permissão restrita se a próxima etapa for
      imediata. Nada disso volta ao Git.
- [ ] Se algo deu errado: `NFSE_ENABLED=false` e recriar o backend. A tabela e o histórico permanecem; pedidos pendentes não são
      mais confirmáveis.

## 9. Fora deste checklist

Produção real **não** faz parte desta etapa. Exige a restrita validada ponta a ponta, perfil definitivo aprovado pela contadora,
aprovação expressa por escrito e o checklist de `nfse-producao-restrita.md`, seção 3.
