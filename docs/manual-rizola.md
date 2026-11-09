# Manual de uso do VastaFlow

**Para:** Rizola Paiva (perfil Gestor)
**Sistema:** VastaFlow, da Vasta Participações Empreendimentos e Agropecuária Ltda.

Este manual explica, em poucas palavras, o que você já pode fazer hoje no VastaFlow e o que ainda está a caminho. Você não precisa entender nada técnico para usar.

---

## 1. O que o VastaFlow oferece hoje

O VastaFlow tem duas formas de uso:

1. **O painel**, que você abre no navegador (computador ou celular).
2. **O assistente no Telegram** (@VastaOficialBot), onde você digita comandos curtos e recebe respostas na hora.

O painel oferece diferentes áreas de gestão (veja a lista no item 2). A disponibilidade de cada operação depende das funcionalidades que já foram implementadas e das permissões do seu usuário. Este manual não afirma que todas as áreas e operações do painel foram testadas em uso real.

Pelo painel e pelo Telegram você também consulta as **informações financeiras reais da empresa registradas no Plantae** (itens 3 e 4). Essas consultas são **somente leitura**: o VastaFlow não faz pagamentos, não dá baixa, não emite boletos, notas ou qualquer outro documento, e não altera nada no Plantae.

O Telegram é mais restrito: oferece consultas específicas, por meio de poucos comandos. Ele não substitui o painel nem mostra tudo o que o painel mostra.

---

## 2. Como entrar no painel

1. Abra o navegador e acesse: **https://vastaflow.duckdns.org/login**
2. Digite o seu **e-mail** e a sua **senha**.
3. Clique para entrar.

Você chega na tela inicial. No menu de cima aparecem as áreas que o seu perfil permite:

| Menu | Para que serve |
|---|---|
| **Início** | Visão geral do sistema |
| **Notificações** | Avisos destinados a você |
| **Usuários** | Cadastro das pessoas que usam o sistema |
| **Financeiro** | Lançamentos financeiros cadastrados no VastaFlow e relatórios |
| **Plantae** | Consultas às informações financeiras da empresa no Plantae (item 3) |
| **Documentos** | Documentos enviados ao sistema |
| **Auditoria** | Histórico de quem fez o quê e quando |
| **Meu perfil** | Os seus dados e a troca da sua senha |
| **Sair** | Encerra a sua sessão |

Para sair com segurança, use sempre o botão **Sair**, principalmente em computador de outra pessoa.

**Se a sessão expirar**, o sistema pede o login de novo. É normal e faz parte da proteção.

**Se não conseguir entrar**, confira o e-mail e a senha. Se continuar sem entrar, fale com o responsável pela implantação do VastaFlow. Atenção: o painel **ainda não tem a opção "esqueci minha senha"**. Você só consegue trocar a senha quando já está logada (veja o item 2.1), por isso guarde a sua senha em local seguro.

### 2.1 Como trocar a sua senha

1. Entre no painel e clique em **Meu perfil** no menu.
2. Role até a seção **Alterar senha**.
3. Preencha **Senha atual**, **Nova senha** e **Confirmar nova senha**.
4. Clique em **Alterar senha**. Aparece o aviso "Senha alterada com sucesso" e você continua logada.

Regras da nova senha:
- de 8 a 72 caracteres, com pelo menos uma letra maiúscula, uma minúscula e um número;
- diferente da senha atual.

O que acontece depois da troca:
- Os outros aparelhos ou janelas em que você estava logada são **desconectados**, e lá será preciso entrar de novo com a senha nova. Isso protege a sua conta se alguém tinha acesso.
- Se você digitar a **senha atual errada**, o sistema só avisa "Senha atual incorreta" e você **continua logada**.
- Por segurança, o número de tentativas é limitado. Se aparecer "Muitas tentativas", espere cerca de um minuto e tente de novo.
- Você só pode trocar a **sua própria** senha, nunca a de outra pessoa.

---

## 3. Consultas ao Plantae no painel

Clique em **Plantae** no menu. No topo da tela aparece sempre o aviso **"Dados consultados no Plantae em tempo real. Somente leitura."**

### 3.1 Como consultar

1. Escolha a **aba** (as cinco abas estão na tabela abaixo).
2. Ajuste os **filtros** da aba.
3. Clique em **Consultar**.

Algumas regras valem para todas as abas:

- **Nada é consultado sozinho.** Abrir a tela, trocar de aba ou mudar um filtro não busca nada; a consulta só acontece quando você clica em **Consultar**. Não há atualização automática.
- Cada consulta traz **até 50 itens**. Quando houver mais, aparece o botão **Carregar mais**, que traz os próximos com os **mesmos filtros** da consulta original.
- Se o Plantae não informar se há mais itens, a tela avisa isso, sem afirmar que a lista acabou.
- **Trocar de aba ou sair da tela descarta** os resultados e os filtros da aba anterior. Para ver de novo, consulte de novo.
- O período tem **no máximo 366 dias**, e a data inicial não pode ser posterior à final. Se o período estiver errado, a tela avisa e não consulta.
- Se o Plantae estiver indisponível ou recusar a consulta, aparece uma mensagem curta explicando. Basta tentar de novo mais tarde.

### 3.2 As cinco abas

| Aba | O que mostra | Filtros |
|---|---|---|
| **Contas a pagar e receber** (aba inicial) | Uma linha por **parcela**: vencimento, tipo, pessoa, descrição, parcela (ex.: 1/3), valor, saldo e situação | **Tipo** (a pagar ou a receber), **vencimento de / até** (padrão: o mês atual) e **situação** (todas, pendentes, quitadas ou substituídas) |
| **Movimentações** | Entradas e saídas das contas: data, conta, entrada/saída, descrição, pessoa, valor e conciliação | **Período** (padrão: o mês atual), **natureza** (entradas, saídas ou ambas) e **conciliação** (conciliadas, não conciliadas ou todas) |
| **Extratos** | Saldo anterior, saldo final e os movimentos de **uma conta**, com o saldo de cada linha | Primeiro clique em **Carregar contas** e escolha a **conta**; depois o **período** e **Consultar** |
| **Contas bancárias** | Nome, tipo, banco, agência e número da conta | **Tipo de conta** (caixa, conta bancária, aplicação, numerário em trânsito ou todos) |
| **Pessoas** | Nome, razão social, tipo (física ou jurídica) e CPF/CNPJ | **Buscar** (opcional): nome, razão social ou CPF/CNPJ, de 2 a 100 caracteres |

Detalhes que ajudam a ler os resultados:

- **Parcelas quitadas:** use a aba **Contas a pagar e receber** com a situação **Quitadas**.
- **Situação "Substituída (renegociada)"** quer dizer que a parcela foi renegociada ou desmembrada no Plantae. Ela **não** foi cancelada.
- **Valores e saldos são exatamente os do Plantae.** O VastaFlow não soma nem recalcula nada. Em **Contas a pagar e receber**, o valor aparece na moeda do título. Em **Movimentações** e **Extratos**, o Plantae não informa a moeda, por isso o valor aparece sem símbolo.
- **Movimentações:** o Plantae não inclui movimentos estornados nem compras no cartão de crédito (aparece só o pagamento da fatura). A lista pode não representar toda a movimentação.
- **Extratos:** os saldos são do período inteiro, informados pelo Plantae. O extrato não é uma conciliação bancária.

### 3.3 Dados protegidos

- **CPF e CNPJ aparecem mascarados**, com só parte dos dígitos visível (por exemplo, `***.456.789-**` ou `12.345.678/****-**`).
- **Números de contas bancárias** aparecem só com os **últimos quatro dígitos** (por exemplo, `****1234`).
- Essa proteção é feita pelo servidor do VastaFlow, antes de a informação chegar à sua tela.
- Os resultados não ficam guardados no seu navegador: ao sair da tela, eles somem.

### 3.4 Clientes e fornecedores

**O Plantae não informa se cada cadastro é cliente ou fornecedor.** Uma mesma pessoa ou empresa pode ser as duas coisas. Por isso:

- Na aba **Pessoas**, ninguém é classificado como cliente ou fornecedor. A própria tela mostra esse aviso.
- Em **Contas a pagar e receber**, a coluna muda de nome conforme o tipo consultado: **"Fornecedor/Favorecido"** nas contas a pagar e **"Cliente"** nas contas a receber. Esse papel vale **só para aquele lançamento**, não para o cadastro.

---

## 4. Como usar o assistente no Telegram

A sua conta do Telegram já está vinculada ao seu usuário do VastaFlow, com o perfil Gestor. Por isso o assistente reconhece você.

1. Abra o Telegram.
2. Procure por **@VastaOficialBot** e abra a conversa. A conversa precisa ser **individual**, só entre você e o bot. Em grupos ele não responde.
3. Digite um dos comandos abaixo e envie.

Os comandos sempre começam com a barra **/** e vão em letras minúsculas, sem acento.

### /ajuda
Mostra a lista dos comandos que você pode usar.

- Digite: `/ajuda`
- Resultado: uma lista com o nome de cada comando e uma explicação curta.
- A lista mostra **só o que o seu perfil permite**. Se algo não aparece, é porque não está liberado para você.

### /contas_pagar e /contas_receber
Mostram as contas **pendentes** do Plantae: `/contas_pagar` as contas a pagar e `/contas_receber` as contas a receber.

- Digite: `/contas_pagar` ou `/contas_receber` para ver os vencimentos **de hoje até 7 dias**.
- Ou informe um período, com as datas no formato ano-mês-dia: `/contas_receber 2026-11-01 2026-11-30` (no máximo **31 dias**).
- A resposta começa com o aviso **"PRODUCAO - dados reais da empresa no Plantae. Somente consulta."**
- Cada linha traz: **vencimento, valor (na moeda do título), parcela e um número de referência** (`ref ...`), que é o identificador da parcela no Plantae. Exemplo: `15/11/2026 - R$ 4.200,50 (parcela 1/3) - ref 77`.
- A resposta **não mostra CPF/CNPJ** e **não mostra nomes de clientes**. O nome de fornecedores também fica oculto na configuração atual.
- Se a parcela já recebeu um pagamento parcial, a linha avisa: "JA TEVE PAGAMENTO PARCIAL" ou "JA TEVE RECEBIMENTO PARCIAL (confira no Plantae)". O assistente não calcula saldo.
- São mostrados **no máximo 5 itens**. Se houver mais, a resposta avisa: use um período menor ou consulte pelo painel.
- **Limite de consultas:** cada pessoa pode fazer **3 consultas por minuto no total**, somando `/contas_pagar` e `/contas_receber`. Passou disso, o assistente pede para tentar de novo em instantes.
- Estes comandos **só consultam**: não pagam, não dão baixa e não alteram nada.

### /financeiro
Mostra um resumo dos lançamentos financeiros cadastrados **no VastaFlow** (área Financeiro do painel): quantos existem e os mais recentes, com data, tipo, valor, descrição e situação. **Não** mostra os dados do Plantae; para eles, use `/contas_pagar`, `/contas_receber` ou o painel.

- Digite: `/financeiro`
- Este comando **só consulta**. Ele não cria, não altera e não apaga nada.

### /status
Mostra se o assistente está funcionando.

- Digite: `/status`
- Resultado: uma confirmação de que o sistema está de pé, com o tempo que ele está no ar.

---

## 5. Por que o /financeiro pode aparecer sem lançamentos

Se o `/financeiro` responde algo como *"Nenhum lançamento financeiro registrado ainda"*, **isso não é uma falha**.

- O comando mostra apenas o que está **cadastrado no VastaFlow**, na área Financeiro. Ele não lê o Plantae.
- As **informações financeiras reais do Plantae** estão no menu **Plantae** do painel e nos comandos `/contas_pagar` e `/contas_receber`.
- O assistente **não inventa números nem exemplos**. Quando não há nada para mostrar, ele diz isso com clareza.

Quando existirem lançamentos cadastrados no VastaFlow, o mesmo comando passa a mostrá-los, sem você precisar fazer nada de diferente.

---

## 6. Cuidados de segurança

O VastaFlow guarda informações da empresa. Alguns cuidados simples ajudam a proteger tudo isso.

**Senha**
- Não compartilhe a sua senha com ninguém, nem com colegas de confiança. Cada pessoa deve ter o seu próprio acesso.
- Não anote a senha em papel à vista, em bilhete no computador ou em mensagem para si mesma.
- Não use a mesma senha de outros serviços (e-mail, banco, redes sociais).
- Não digite a senha em computador ou celular de outra pessoa. Se precisar, use o botão **Sair** ao terminar.
- Ninguém da equipe do VastaFlow vai pedir a sua senha. Se alguém pedir, desconfie.
- Troque a senha de tempos em tempos e use uma senha que ninguém adivinhe (evite datas de aniversário e nomes). Veja como no item 2.1.
- Se achar que a sua senha foi descoberta, **troque-a imediatamente** em **Meu perfil**, o que também desconecta os outros aparelhos, e avise a administração.

**Informações do Plantae**
- O painel Plantae mostra **dados financeiros reais** e nomes de clientes e fornecedores. Não deixe a tela aberta em computador de outra pessoa e não compartilhe capturas de tela fora da empresa.
- Toda consulta fica registrada na **Auditoria** (quem consultou e quando), sem os valores consultados.

**Mensagens suspeitas**
- O endereço oficial do painel é **vastaflow.duckdns.org**. Desconfie de qualquer link parecido, com letras trocadas ou outro final. Prefira digitar o endereço ou usar um favorito salvo.
- O bot oficial é o **@VastaOficialBot**. Cuidado com contas de nome parecido que peçam informações.
- O assistente **nunca pede a sua senha**. Se alguma mensagem pedir senha, código recebido por SMS ou dados bancários, não responda.
- Não clique em links nem abra arquivos de mensagens inesperadas, mesmo que pareçam vir de alguém conhecido.
- Na dúvida, não responda. Confirme por outro meio, como uma ligação, e avise a administração.

**Telegram**
- Mantenha o seu celular com bloqueio de tela.
- Se você perder o celular ou trocar de número, avise a administração, para que o acesso do assistente seja revisado.
- Lembre que o Telegram não é uma ferramenta de sigilo absoluto: as conversas com o assistente **não têm criptografia de ponta a ponta**, e isso inclui as respostas de `/contas_pagar` e `/contas_receber`. Use o assistente para consultas simples e evite escrever nele dados pessoais sensíveis de terceiros.

---

## 7. O que está disponível e o que ainda está pendente

### Já disponível

| Funcionalidade | Onde |
|---|---|
| Entrar no painel com e-mail e senha | Painel |
| Ver as áreas do menu que o seu perfil permite (Início, Notificações, Usuários, Financeiro, Plantae, Documentos, Auditoria, Meu perfil) | Painel |
| Trocar a sua própria senha (Meu perfil > Alterar senha) | Painel |
| Consultar no Plantae contas a pagar e a receber, parcelas quitadas, movimentações, extratos, contas bancárias e cadastros de pessoas | Painel (menu Plantae) |
| Consultar as contas a pagar e a receber pendentes do Plantae com `/contas_pagar` e `/contas_receber` | Telegram |
| Consultar o assistente com `/ajuda` | Telegram |
| Consultar o resumo financeiro cadastrado no VastaFlow com `/financeiro` | Telegram |
| Verificar se o assistente está no ar com `/status` | Telegram |

### Fora do escopo do Plantae no VastaFlow

O VastaFlow **só consulta** o Plantae. Não estão disponíveis, e não fazem parte desta integração: pagamentos, baixas, boletos, PIX, emissão de notas ou de qualquer documento, PDFs e qualquer alteração de dados no Plantae.

### Ainda pendente

Estes recursos **ainda não estão disponíveis**. Não há data definida para eles, e este manual não promete prazos.

- **Outros canais de atendimento**, além do Telegram. Hoje o Telegram é o único canal do assistente.
- **Recuperação de senha esquecida ("esqueci minha senha").** Ainda não existe.
- **Troca de e-mail pela sua própria tela.** Ainda não existe.

Quando uma novidade ficar pronta, ela será comunicada e este manual será atualizado.

---

## 8. Em caso de dúvida ou problema

Para qualquer dúvida ou problema, entre em contato diretamente com o **responsável pela implantação do VastaFlow**. Onde este manual diz "administração", é com essa pessoa que você deve falar.

| Situação | O que fazer |
|---|---|
| Não consigo entrar no painel | Confira e-mail e senha. Se persistir, fale com a administração. Lembre que ainda não há "esqueci minha senha". |
| Quero trocar a senha | Meu perfil > Alterar senha (item 2.1). |
| O menu Plantae não aparece | O seu perfil não tem a permissão de consulta ao Plantae. Fale com a administração. |
| A consulta no Plantae mostra uma mensagem de indisponibilidade | O Plantae pode estar fora do ar ou demorando. Tente de novo em alguns minutos; se continuar, avise a administração. |
| O CPF, o CNPJ ou o número da conta aparecem com asteriscos | É a proteção normal dos dados (item 3.3), não é erro. |
| Preciso saber se alguém é cliente ou fornecedor | O Plantae não informa isso no cadastro. Veja o item 3.4. |
| O bot não responde | Confirme que a conversa é individual com o **@VastaOficialBot**. Tente `/status`. Se não responder, avise a administração. |
| O bot diz "Muitas consultas ... em pouco tempo" | Você passou do limite de 3 consultas por minuto (somando `/contas_pagar` e `/contas_receber`). Espere um instante e tente de novo. |
| Um comando não aparece no `/ajuda` | O seu perfil não tem acesso a ele. Isso não é um erro. |
| O `/financeiro` diz que não há lançamentos | Ele mostra só o que está cadastrado no VastaFlow. Veja a seção 5. |
| Recebi uma mensagem estranha | Não responda nem clique em nada. Avise a administração. |
| Perdi o celular ou suspeito que a senha vazou | Troque a senha em Meu perfil e avise a administração imediatamente. |

*Versão do manual: 09/11/2026 (inclui o painel Plantae e os comandos `/contas_pagar` e `/contas_receber`).*
