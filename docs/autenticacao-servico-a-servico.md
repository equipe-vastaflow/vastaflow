# Autenticacao servico-a-servico (n8n -> NestJS)

> **Estado: CONTRATO PROPOSTO. Nada disto esta implementado.**
>
> Nao existe guard, nao existe variavel de ambiente, nao existe credencial,
> nao existe migration. Este documento e o contrato a ser revisado antes da
> implementacao, que pertence a fase do n8n.
>
> Decisao arquitetural de origem:
> [`adr/0003-topologia-de-producao.md`](adr/0003-topologia-de-producao.md).

## 1. O problema

Na topologia decidida, o n8n orquestra os canais e chama a API do VastaFlow:

```
pessoa -> WhatsApp/Telegram -> n8n -> NestJS -> MySQL
```

O n8n precisa se autenticar nessa chamada. Hoje existe **um** mecanismo de
autenticacao: JWT de usuario, emitido no login, verificado pelo guard global a
cada requisicao - que relê perfil, permissoes e status do banco toda vez.

Esse mecanismo **nao serve** para um sistema. Usa-lo exigiria dar ao n8n a senha
de um funcionario ou guardar um JWT de pessoa indefinidamente, e as duas coisas
estao descartadas.

## 2. A distincao que organiza tudo: service principal != business actor

Uma mesma requisicao carrega **duas identidades**, e elas respondem a perguntas
diferentes:

| | Pergunta que responde | Exemplo no fluxo | Sujeito de |
| --- | --- | --- | --- |
| **Service principal** | *Qual sistema* esta chamando? | o n8n | **autenticacao** |
| **Business actor** | *Qual pessoa* originou? | o usuario VastaFlow vinculado ao numero de WhatsApp | **acao de negocio** |

Por que isso importa na pratica: se as duas forem confundidas, a trilha de
auditoria passa a registrar o n8n como autor de lancamentos que uma pessoa fez.
Quem lancou uma despesa pelo WhatsApp foi a pessoa; o n8n foi o transporte.
Perder essa distincao esvazia a auditoria exatamente nos fluxos de maior
consequencia.

### Combinacoes possiveis

| Service principal | Business actor | Quando | O que a auditoria registra |
| --- | --- | --- | --- |
| ausente | presente | pessoa usando o React | a pessoa |
| presente | presente | pessoa usando WhatsApp/Telegram via n8n | **a pessoa**, com o servico como contexto |
| presente | ausente | sincronizacao agendada, alerta, error workflow | nenhum autor humano - e correto registrar a ausencia, nao inventar um |
| ausente | ausente | - | nao existe |

A terceira linha e a que mostra por que nao basta "um usuario para o n8n": nem
toda acao do n8n tem pessoa por tras, e forcar uma seria registrar algo falso.

### Consequencia para a implementacao

A autenticacao e a representacao do autor sao **problemas separados** e devem ser
resolvidos separadamente:

- **Autenticar o servico** e o escopo deste contrato.
- **Resolver e registrar o business actor** continua sendo responsabilidade do
  NestJS, a partir de `external_identity_links`. O n8n **nunca** decide quem e o
  usuario, e **nunca** envia um identificador de usuario no corpo da requisicao -
  a regra permanente do projeto contra aceitar `usuarioId` do cliente vale
  integralmente aqui, e com mais razao.

### Nota sobre a representacao do autor

Uma proposta anterior sugeria materializar o service principal como uma linha
comum na tabela de usuarios. **Foi rejeitada**, e o motivo e o acima: resolveria
o preenchimento das colunas de autoria ao custo de fazer o n8n parecer uma
pessoa na auditoria.

Como representar o autor nos registros quando houver service principal - e
especialmente quando **nao** houver business actor - fica como **decisao aberta**
(secao 9). O que este contrato fixa e que a resposta **nao** e "tratar o n8n
como usuario humano".

## 3. Mecanismo escolhido

**Token de servico dedicado, em cabecalho proprio.**

```
POST /... HTTP/1.1
X-Service-Token: <token de alta entropia>
```

### Por que cabecalho proprio e nao `Authorization: Bearer`

Os dois esquemas ficam visivelmente distintos, em caminhos de codigo distintos.
Com `Bearer` compartilhado, um erro de ordenacao de guards poderia fazer um token
de servico percorrer o caminho do JWT, ou o contrario - a classe de bug mais
caro possivel num mecanismo de autenticacao.

### Alternativas consideradas

| | Alternativa | Por que nao agora |
| --- | --- | --- |
| A | `Authorization: Bearer` estatico | Colide com o esquema JWT (acima) |
| C | HMAC com timestamp e nonce | Protege contra replay, mas exige relogio sincronizado e armazenamento de nonce. Para uma chamada entre containers numa rede Docker privada, onde o token nao atravessa a internet, o ganho nao paga a complexidade. **E o caminho de upgrade** se o n8n sair do host |
| D | Client credentials / OAuth2 | Infraestrutura de autorizacao inteira para **um** consumidor. Construir quando houver varios |
| E | mTLS entre n8n e NestJS | Reintroduz gestao de certificados num caminho que ja esta em rede privada |

A escolha e deliberadamente a mais simples que atende o requisito, com o caminho
de evolucao identificado.

## 4. Requisitos do token

| Requisito | Decisao |
| --- | --- |
| Entropia | >= 256 bits, de gerador criptografico |
| Formato | opaco. Nao carrega claims, nao e JWT, nao e decodificavel |
| Comparacao | **tempo constante**, sobre digests de tamanho fixo. Nunca `===` sobre as strings |
| Armazenamento no servidor | variavel de ambiente, nunca no repositorio, nunca no banco em texto puro |
| Armazenamento no n8n | credencial do cofre do n8n, nunca dentro do workflow |
| Exposicao ao frontend | **jamais**. Nao e `VITE_*`, nao vai para o navegador |
| Em log | nunca. A higienizacao de metadados de auditoria ja remove chaves que casam com `token`; o guard nao deve registrar o valor em nenhuma circunstancia |
| Em mensagem de erro | nunca. A resposta nao diz se o cabecalho faltou, se o formato estava errado ou se o valor nao casou |

### Rotacao

O guard aceita **mais de um** token valido durante uma janela de rotacao. O
procedimento: adicionar o novo, atualizar a credencial no n8n, confirmar que o
trafego usa o novo, remover o antigo. Sem janela de indisponibilidade.

### Revogacao

Precisa ser **imediata e sem redeploy**. O mecanismo exato depende da decisao
aberta da secao 9; o requisito e que exista uma forma de cortar o acesso do
servico em segundos, operando no servidor, sem publicar codigo novo.

## 5. Comportamento do guard

```
requisicao chega
  |
  +-- tem X-Service-Token?
  |     NAO -> segue o fluxo humano existente (guard de JWT), INTACTO
  |     SIM -> continua abaixo
  |
  +-- comparacao em tempo constante contra o(s) token(s) valido(s)
  |     nao casa -> 401 com mensagem GENERICA
  |
  +-- o service principal esta ativo?
  |     nao -> 401 com a MESMA mensagem generica
  |
  +-- anexa a identidade de servico a requisicao
  |
  +-- autorizacao: so os endpoints explicitamente permitidos
        nao permitido -> 403
```

Pontos que nao sao negociaveis:

1. **O fluxo humano nao muda.** Requisicao sem o cabecalho percorre exatamente o
   caminho de hoje. O guard de servico e um ramo novo, nao uma alteracao do
   existente.
2. **Mensagem de erro unica.** "Nao existe", "inativo" e "token errado" devolvem
   a mesma resposta - o mesmo criterio que o guard de JWT ja aplica para nao
   revelar o estado de uma conta.
3. **Nenhuma rota publica nova.** A API continua negando por padrao.

## 6. Endpoints autorizados

**Lista branca, nunca a API inteira.** O service principal recebe apenas o que
os workflows realmente usam, e nada que lhe de acesso total.

O conjunto exato sera definido com os primeiros workflows. O criterio: um
endpoint entra na lista quando existe um workflow que precisa dele, nao antes.

Permissoes de administracao - criar usuario, mudar perfil, alterar configuracao -
**nao** entram na lista. Um token vazado nao pode escalar para administracao do
sistema.

## 7. Auditoria

Toda acao originada em chamada de servico precisa ser rastreavel, e o registro
tem de distinguir as duas identidades da secao 2:

- **qual servico** chamou;
- **qual pessoa** originou, quando houver;
- a ausencia de pessoa, quando for o caso - explicitamente, nao por omissao.

Dois requisitos de forma:

- O vocabulario de acoes da auditoria **nao** e ampliado pelo mecanismo de
  autenticacao. Um comando de negocio executado via n8n registra a acao do
  dominio, nao uma acao "n8n".
- O valor do token **nunca** aparece em nenhum campo.

Como exatamente representar isso no registro e parte da decisao aberta da
secao 9.

## 8. Protecoes de infraestrutura

| Protecao | Onde | Por que |
| --- | --- | --- |
| Rate limiting | Nginx | Mesmo criterio da Fase A: limite de taxa e responsabilidade do proxy reverso, nao da aplicacao |
| TLS | Nginx | O token nunca viaja em texto puro |
| Rede privada | Docker | Na topologia prevista, n8n e NestJS conversam na rede interna; o token nao atravessa a internet |
| Replay | aceito como risco residual | Mitigado por TLS + rede privada. HMAC com nonce e o upgrade se o cenario mudar |
| Idempotencia | **MySQL**, nao n8n | Operacoes financeiras e fiscais exigem chave unica no banco. O n8n nao tem transacao nem constraint, e enfileira execucoes - a garantia precisa estar onde ha constraint |

## 9. Decisoes abertas

Estas precisam ser resolvidas **antes** da implementacao, e nao serao decididas
sozinhas:

1. **Como representar o autor nos registros quando houver service principal.**
   Materializar o service principal como usuario esta descartado. As opcoes em
   aberto envolvem distinguir tipo de ator no registro de auditoria e tratar as
   colunas de autoria dos registros de negocio - inclusive o caso sem pessoa
   alguma por tras. Algumas opcoes exigem migration, outras nao; a escolha e de
   modelagem, nao de conveniencia.
2. **Onde reside a lista de endpoints autorizados** - configuracao, codigo, ou
   permissoes dedicadas.
3. **Qual o mecanismo de revogacao imediata**, coerente com a decisao 1.
4. **Se havera mais de um service principal** no horizonte previsivel. Com um
   so, este contrato basta; com varios, o caminho e client credentials.

## 10. Fora de escopo deste contrato

- Autenticacao do usuario humano: inalterada.
- Resolucao de identidade externa (`external_identity_links`): existe e nao
  muda.
- Qualquer alteracao em `financial_entries`, `documents` ou na tabela de
  auditoria: depende da decisao 1 e nao esta autorizada.
- Workflows do n8n.

## 11. Pre-requisitos para implementar

1. As quatro decisoes abertas da secao 9, resolvidas.
2. O n8n em execucao, com cofre de credenciais disponivel.
3. TLS valido no Nginx.
4. Pelo menos um workflow concreto, para que a lista branca de endpoints seja
   derivada de necessidade real e nao de suposicao.
