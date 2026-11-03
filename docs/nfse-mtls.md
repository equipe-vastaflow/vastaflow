# NFS-e: conexão HTTPS/mTLS com a Sefin Nacional

> **Estado:** implementada e testada **somente contra um servidor HTTPS local** com uma PKI **fictícia** (autoridade raiz,
> duas intermediárias, certificados de cliente e de servidor gerados na hora). **Nunca** foi usada contra a Sefin real nem com
> o certificado real da Quasar. `NFSE_ENABLED` segue `false`.

## 1. Certificado do cliente e cadeia (`chainPem`)

O `.pfx` (PKCS#12) é aberto **em memória** por `openPfx` (`nfse-certificate.ts`):

- **Folha:** o certificado que casa com a chave privada (`certificatePem`).
- **`chainPem`:** as **intermediárias**, em **ordem de cadeia** (a que emitiu a folha primeiro, depois a que emitiu esta…).
  A ordem é obtida subindo pelo emissor e **verificando a assinatura de cada elo** (não só o nome). **Ficam de fora:** a folha, a
  **raiz autoassinada** (o servidor já a tem) e qualquer certificado do `.pfx` sem relação com a cadeia da folha. Limite de 8 níveis.

**Correção desta etapa:** antes, `chainPem` era só "tudo que não é a folha" (sem ordem, com raiz e certificados alheios) e **não era
usado**: o agente HTTPS apresentava apenas a folha. Um servidor que valida o cliente até uma raiz própria **recusa** quem não
mandar as intermediárias. Agora o agente apresenta `folha + intermediárias`, em ordem e sem a raiz (como o Node documenta para
`cert`: uma cadeia por chave).

## 2. Validação do servidor (não negociável)

- `rejectUnauthorized: true` **sempre**, com a checagem de hostname padrão do Node. Não existe variável nem opção que a desligue
  (um teste confere que o código não contém `rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED` nem `checkServerIdentity`).
- TLS mínimo 1.2, sem `keepAlive`, sem redirecionamento.
- Falhas viram erro com **código fixo** (por exemplo `ERR_TLS_CERT_ALTNAME_INVALID`, `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`),
  nunca a mensagem original do Node (que pode trazer host ou trecho de certificado).

## 3. `NFSE_CA_BUNDLE_PATH`: **complementa** as CAs padrão do Node

| Configuração | CAs em que o VastaFlow confia |
| --- | --- |
| `NFSE_CA_BUNDLE_PATH` vazio (padrão) | **só** as CAs padrão do Node (repositório público embutido, mais `NODE_EXTRA_CA_CERTS`) |
| `NFSE_CA_BUNDLE_PATH=/caminho/cadeia.pem` | as CAs padrão do Node **mais** os certificados do arquivo |

**Por que complementar e não substituir.** A opção `ca` do Node, sozinha, **substitui** o repositório padrão. Um bundle só com a
raiz da ICP-Brasil, por exemplo, derrubaria a conexão se a Sefin passasse a usar uma CA pública. O bundle serve para **acrescentar**
uma cadeia que o Node padrão não conhece, sem remover nada.

**Limites que valem conhecer:**

- O bundle **não** é "pinning": quem o configura amplia a confiança, não a restringe.
- Um arquivo **inexistente, ilegível ou sem nenhum certificado PEM** é recusado **antes de qualquer conexão**
  (`ca_bundle_ilegivel` / `ca_bundle_invalido`); o pedido termina em `NAO_ENVIADA`, nunca em `INCERTA`, e a mensagem não traz o caminho.
- O arquivo **não deve conter chave privada** (só certificados públicos).

## 4. O que os testes provam (`nfse-mtls.spec.ts`, PKI fictícia)

Servidor HTTPS local que **exige** certificado de cliente e confia **só** na raiz fictícia.

| Cenário | Resultado |
| --- | --- |
| cadeia válida (folha + intermediárias, vindas de um `.pfx` embaralhado) | **atendida**; o servidor vê o cliente como autenticado |
| cadeia **incompleta** (só a folha; ou faltando uma intermediária) | **recusada** pelo servidor |
| certificado de cliente **ausente** | **recusado** (alerta de certificado exigido) |
| certificado de cliente **inválido** (outra autoridade) ou **expirado** | **recusado** |
| chave privada que não é a do certificado | o handshake falha |
| servidor com **hostname incorreto** | cliente **recusa** (`ERR_TLS_CERT_ALTNAME_INVALID`), nada é enviado |
| servidor de CA **desconhecida** (sem bundle) / autoassinado / com bundle de **outra** raiz | cliente **recusa** |
| servidor que **não envia** a intermediária | cliente **recusa** |
| bundle com a raiz correta (e com várias CAs) | servidor **aceito** |

Também testados: `chainPem` ordenado, sem raiz, sem certificado alheio e sem elo com assinatura falsa; as opções do agente
(`ca = padrão + bundle`, `cert = folha + intermediárias`); bundle inválido; a classificação **"nada saiu"** (`NAO_ENVIADA`) para
falhas de TLS, com o motivo em código fixo (`tls_<código>`).

**Sem vazamento:** os erros de TLS, de bundle e de `.pfx` (senha errada) foram coletados e conferidos: não contêm chave privada,
certificado, senha, caminho temporário nem `.pem`/`.pfx`, e nada vai para `console`. Um teste varre os arquivos versionados (e os
novos não ignorados) à procura de chave privada, `.pfx`, `.p12`, `.pem`, `.key`, `.crt`, `.cer` e `.jks`: **nenhum**.

## 5. Limitações e riscos que permanecem

- **TLS 1.3 e certificado de cliente rejeitado:** o cliente pode ver `ECONNRESET` em vez de um alerta. Esse caso é tratado como
  **resultado incerto** (conservador: não se afirma que nada foi processado). O servidor local não processou nada, mas só o
  alerta de certificado é classificado como "não enviada". Se acontecer com a Sefin real, a reconciliação por `GET /dps/{id}` decide.
- **Nada disto foi exercitado contra a Sefin real:** o mTLS dela pode exigir condições que a PKI fictícia não reproduz (cadeia
  ICP-Brasil, extensões do certificado, política de CA). A primeira conexão real continua sendo o teste de verdade
  (ver `docs/nfse-producao-restrita.md`).
- **A raiz não é apresentada.** Se a Sefin exigir a raiz junto, é preciso alterar o código (improvável: a raiz é do servidor).
- **O `.pfx` precisa trazer as intermediárias.** Sem elas no arquivo, só a folha é apresentada. Verifique com `openssl pkcs12 -info`
  (sem colocar a senha na linha de comando) antes de usar o certificado.
- **Não há verificação de uso do certificado** (`KeyUsage`/`extKeyUsage` de autenticação de cliente, `CA:false`): quem recusa
  é a Sefin. Inspecione o certificado real offline antes da primeira conexão.
- `NODE_EXTRA_CA_CERTS` ou outras configurações globais do Node **também** ampliam a confiança do processo; não defina nada que
  não seja necessário.
