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

O Telegram é mais restrito: oferece consultas específicas aos dados registrados no VastaFlow, por meio de poucos comandos. Ele não substitui o painel nem mostra tudo o que o painel mostra.

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
| **Financeiro** | Lançamentos financeiros e relatórios |
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

## 3. Como usar o assistente no Telegram

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

### /financeiro
Mostra um resumo dos lançamentos financeiros cadastrados **no VastaFlow**: quantos existem e os mais recentes, com data, tipo, valor, descrição e situação.

- Digite: `/financeiro`
- Este comando **só consulta**. Ele não cria, não altera e não apaga nada.

### /status
Mostra se o assistente está funcionando.

- Digite: `/status`
- Resultado: uma confirmação de que o sistema está de pé, com o tempo que ele está no ar.

---

## 4. Por que o /financeiro ainda aparece sem lançamentos

Se o `/financeiro` responde algo como *"Nenhum lançamento financeiro registrado ainda"*, **isso é esperado neste momento, e não é uma falha**.

- O comando mostra apenas o que está **cadastrado no VastaFlow**. Hoje ainda não há lançamentos financeiros cadastrados lá.
- Os **dados reais do Plantae ainda não foram integrados** ao VastaFlow. Enquanto isso não acontecer, o VastaFlow não recebe as informações financeiras reais da empresa.
- O assistente **não inventa números nem exemplos**. Quando não há nada para mostrar, ele diz isso com clareza.

Quando existirem lançamentos cadastrados, o mesmo comando passa a mostrá-los, sem você precisar fazer nada de diferente.

---

## 5. Cuidados de segurança

O VastaFlow guarda informações da empresa. Alguns cuidados simples ajudam a proteger tudo isso.

**Senha**
- Não compartilhe a sua senha com ninguém, nem com colegas de confiança. Cada pessoa deve ter o seu próprio acesso.
- Não anote a senha em papel à vista, em bilhete no computador ou em mensagem para si mesma.
- Não use a mesma senha de outros serviços (e-mail, banco, redes sociais).
- Não digite a senha em computador ou celular de outra pessoa. Se precisar, use o botão **Sair** ao terminar.
- Ninguém da equipe do VastaFlow vai pedir a sua senha. Se alguém pedir, desconfie.
- Troque a senha de tempos em tempos e use uma senha que ninguém adivinhe (evite datas de aniversário e nomes). Veja como no item 2.1.
- Se achar que a sua senha foi descoberta, **troque-a imediatamente** em **Meu perfil**, o que também desconecta os outros aparelhos, e avise a administração.

**Mensagens suspeitas**
- O endereço oficial do painel é **vastaflow.duckdns.org**. Desconfie de qualquer link parecido, com letras trocadas ou outro final. Prefira digitar o endereço ou usar um favorito salvo.
- O bot oficial é o **@VastaOficialBot**. Cuidado com contas de nome parecido que peçam informações.
- O assistente **nunca pede a sua senha**. Se alguma mensagem pedir senha, código recebido por SMS ou dados bancários, não responda.
- Não clique em links nem abra arquivos de mensagens inesperadas, mesmo que pareçam vir de alguém conhecido.
- Na dúvida, não responda. Confirme por outro meio, como uma ligação, e avise a administração.

**Telegram**
- Mantenha o seu celular com bloqueio de tela.
- Se você perder o celular ou trocar de número, avise a administração, para que o acesso do assistente seja revisado.
- Lembre que o Telegram não é uma ferramenta de sigilo absoluto. Use o assistente para consultas simples e evite escrever nele dados pessoais sensíveis de terceiros.

---

## 6. O que está disponível e o que ainda está pendente

### Já disponível

| Funcionalidade | Onde |
|---|---|
| Entrar no painel com e-mail e senha | Painel |
| Ver as áreas do menu que o seu perfil permite (Início, Notificações, Usuários, Financeiro, Documentos, Auditoria, Meu perfil) | Painel |
| Trocar a sua própria senha (Meu perfil > Alterar senha) | Painel |
| Consultar o assistente com `/ajuda` | Telegram |
| Consultar o resumo financeiro cadastrado no VastaFlow com `/financeiro` | Telegram |
| Verificar se o assistente está no ar com `/status` | Telegram |

### Ainda pendente

Estas integrações **ainda não estão disponíveis**. Não há data definida para elas, e este manual não promete prazos.

- **Integração com os dados reais do Plantae.** Enquanto não existir, o VastaFlow não traz as informações financeiras reais da empresa.
- **Outros canais de atendimento**, além do Telegram. Hoje o Telegram é o único canal do assistente.
- **Recuperação de senha esquecida ("esqueci minha senha").** Ainda não existe.
- **Troca de e-mail pela sua própria tela.** Ainda não existe.

Quando uma novidade ficar pronta, ela será comunicada e este manual será atualizado.

---

## 7. Em caso de dúvida ou problema

Para qualquer dúvida ou problema, entre em contato diretamente com o **responsável pela implantação do VastaFlow**. Onde este manual diz "administração", é com essa pessoa que você deve falar.

| Situação | O que fazer |
|---|---|
| Não consigo entrar no painel | Confira e-mail e senha. Se persistir, fale com a administração. Lembre que ainda não há "esqueci minha senha". |
| Quero trocar a senha | Meu perfil > Alterar senha (item 2.1). |
| O bot não responde | Confirme que a conversa é individual com o **@VastaOficialBot**. Tente `/status`. Se não responder, avise a administração. |
| Um comando não aparece no `/ajuda` | O seu perfil não tem acesso a ele. Isso não é um erro. |
| O `/financeiro` diz que não há lançamentos | Esperado por enquanto. Veja a seção 4. |
| Recebi uma mensagem estranha | Não responda nem clique em nada. Avise a administração. |
| Perdi o celular ou suspeito que a senha vazou | Troque a senha em Meu perfil e avise a administração imediatamente. |

*Versão do manual: 03/11/2026 (inclui a troca de senha).*
