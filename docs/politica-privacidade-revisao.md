# Política de Privacidade do VastaFlow — registro de revisão e aprovação

**Para:** Rizola, responsável indicada pela Vasta para o contato sobre privacidade
**Situação:** a versão de 28/10/2026 foi **aprovada administrativamente por Rizola em 28/10/2026**. Em **09/11/2026** foi publicada uma **atualização sobre as consultas ao Plantae**, identificada na página como **"Atualização pendente de aprovação"**: ela **ainda não foi aprovada formalmente** (seção 6). As **três pendências jurídicas** (bases legais, retenção de dados e transferência internacional) continuam abertas e declaradas no próprio texto
**Data de vigência da versão aprovada:** 28/10/2026. **A atualização de 09/11/2026 não tem data de aprovação.**

Este documento reúne, para leitura sem conhecimento técnico:

1. [Como ler](#1-como-ler-este-documento)
2. [O texto completo da política](#2-texto-completo-da-política) — é o mesmo texto da página `https://vastaflow.duckdns.org/privacidade`
3. [As três pendências jurídicas](#3-pendências-jurídicas)
4. [Termos técnicos explicados](#4-termos-técnicos-explicados)
5. [Registro de aprovação](#5-registro-de-aprovação)
6. [Atualização de 09/11/2026: consultas ao Plantae (pendente de aprovação)](#6-atualização-de-09112026-consultas-ao-plantae-pendente-de-aprovação)

---

## 1. Como ler este documento

- A **seção 2** é a política **aprovada em 28/10/2026**, exatamente como foi publicada naquela data. Desde 09/11/2026 a página pública (`/privacidade`) mostra a **atualização sobre o Plantae**, descrita na **seção 6** e ainda pendente de aprovação. Onde as duas diferem, vale o que está na página e na seção 6.
- Depois da aprovação, a página **não exibe mais** o aviso “Versão em revisão” nem marcadores internos `[A CONFIRMAR]`. Os três pontos ainda pendentes de validação jurídica continuam ditos no texto, em linguagem para o público (seções 4, 6 e 7 da política).
- Algumas frases descrevem limites reais do sistema hoje (por exemplo, que a exclusão definitiva de cadastros não é automática e que as respostas automáticas do WhatsApp ainda não foram comprovadas). Elas foram escritas assim de propósito, para a política não prometer o que o sistema ainda não faz.
- A seção 3 resume as pendências jurídicas e a seção 5 registra a sua decisão.

---

## 2. Texto completo da política

*Versão aprovada em 28/10/2026, mantida aqui como registro. Na página pública ela foi substituída em 09/11/2026 pela
atualização da seção 6. Em especial, a frase do item 3.4 que diz que a consulta à Plantae está "desligada" **não vale
mais**: o Plantae está em uso desde então.*

> **VastaFlow**
> # Política de Privacidade
>
> Data de vigência: 28/10/2026. Texto aprovado em 28/10/2026 por Rizola, responsável indicada pela Vasta para o contato sobre privacidade.

### 1. Quem somos

O VastaFlow é o sistema interno de gestão operado por **Vasta Participações Empreendimentos e Agropecuária Ltda.** (“Vasta”), controladora dos dados pessoais tratados por ele, nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018 – LGPD).

- CNPJ: 07.131.218/0001-24
- Endereço: Estrada Municipal de Morada Nova de Minas, Zona Rural, Morada Nova de Minas/MG, CEP 35.628-000, Brasil

Esta política se aplica ao sistema, disponível em vastaflow.duckdns.org, e ao assistente “Bot_Vasta”, que atende por mensagens no WhatsApp (API oficial do WhatsApp Business, da Meta) e no Telegram.

### 2. A quem o sistema se destina

O VastaFlow não é um serviço aberto ao público. O acesso é restrito a pessoas cadastradas pela Vasta (usuários do sistema), que são sócios e funcionários. O assistente só atende quem teve o seu número do WhatsApp (ou conta do Telegram) previamente vinculado a um usuário.

Além dos usuários, os documentos e lançamentos do sistema podem conter dados pessoais de clientes, fornecedores e colaboradores.

### 3. Dados pessoais tratados

#### 3.1 Cadastro e acesso

- Nome, e-mail e perfil de acesso (papel) do usuário.
- A senha é guardada somente de forma protegida (hash), nunca em texto legível.
- Após o login, o navegador guarda localmente um token de sessão com prazo de validade, usado para manter a sessão aberta. O sistema não usa cookies de publicidade ou de rastreamento.

#### 3.2 Vínculo com os canais de mensagens

- O identificador do canal que liga o usuário ao assistente: o número do WhatsApp (wa_id) ou o identificador da conversa do Telegram. O vínculo é feito pelo próprio usuário com um código de uso único (`/vincular`).

#### 3.3 Mensagens no WhatsApp

- A integração com o WhatsApp Business está ativada e o sistema recebe da Meta os eventos das mensagens enviadas ao número do assistente. O assistente foi projetado para tratar mensagens **de texto** em conversas individuais, interpretando o texto para executar o comando ou a consulta pedida.
- As respostas automáticas do assistente pelo WhatsApp **ainda não foram comprovadas em operação** e podem não estar disponíveis no momento.
- Os registros de controle de cada evento recebido guardam apenas dados técnicos (identificadores, situação e resultado do processamento). O **texto das mensagens não é gravado** nesses registros nem nos registros de auditoria.
- O identificador do número do remetente (`wa_id`) pode ser armazenado no vínculo entre o número e o usuário do sistema (item 3.2).
- Pelo projeto, mensagens de números não vinculados não recebem resposta do assistente.
- Pelo projeto, as respostas são enviadas somente a quem escreveu, dentro da janela de atendimento de 24 horas do WhatsApp, e o sistema não envia mensagens por iniciativa própria.

#### 3.4 Dados de gestão lançados no sistema

- Lançamentos financeiros e documentos enviados pelos usuários, guardados em área privada do servidor.
- Registros de auditoria: quem fez qual ação e quando, sem o conteúdo das mensagens.
- Notificações internas destinadas ao próprio usuário.

Dados de terceiros: descrições, observações e documentos lançados no sistema podem conter dados pessoais de clientes, fornecedores e colaboradores, conforme o conteúdo inserido pelos usuários. O sistema não possui campos específicos para esses dados.

Recursos de emissão de nota fiscal de serviço (NFS-e) e de consulta à Plantae existem no código, mas estão **desligados**. Se forem ativados, esta política será atualizada antes (a NFS-e trataria nome e CPF/CNPJ do tomador do serviço).

### 4. Para que usamos os dados (finalidades)

- Autenticar usuários e controlar o que cada perfil pode ver e fazer.
- Operar a gestão financeira e documental da empresa.
- Permitir consultas e comandos pelo WhatsApp e pelo Telegram por usuários vinculados.
- Manter trilha de auditoria e a segurança do sistema.

Bases legais (art. 7º da LGPD): a indicação da base legal específica de cada finalidade ainda está em validação jurídica e não é apresentada nesta versão.

### 5. Integração com WhatsApp e Meta

O WhatsApp Business é fornecido pela Meta Platforms. Quando uma mensagem é enviada ao número do assistente, a Meta a processa como plataforma de mensagens, conforme os seus próprios termos e política de privacidade, e a entrega ao VastaFlow por um canal de notificação (webhook) cuja origem é verificada por assinatura. A Vasta não vende dados e não os usa para publicidade.

O uso do WhatsApp está sujeito também às políticas da Meta, que a Vasta não controla.

### 6. Compartilhamento

Os dados são compartilhados somente com prestadores necessários à operação:

- Meta (WhatsApp) e Telegram, como plataformas dos canais de mensagens.
- Hostinger, como provedora terceirizada de hospedagem do servidor (VPS) em que o sistema funciona. Localização do datacenter: Campinas, São Paulo, Brasil.
- Cópia de segurança externa (Google Drive): a decisão foi adiada. Esta política não descreve esse envio como em operação e será atualizada antes de qualquer adoção.

Os serviços da Hostinger, da Meta e do Telegram são conhecidos e utilizados pela Vasta. A Meta e o Telegram podem tratar dados fora do Brasil, conforme as suas próprias políticas.

O sistema usa o n8n para orquestrar o fluxo do Telegram. O conteúdo transitório das mensagens do Telegram fica registrado nele por alguns minutos antes de ser apagado, conforme a configuração de limpeza existente.

Transferência internacional: a análise jurídica sobre eventual transferência internacional de dados (Meta, Telegram, Hostinger e outros) e as garantias aplicáveis, conforme o art. 33 da LGPD, ainda não foi concluída. O uso desses serviços não substitui essa análise.

### 7. Armazenamento e retenção

Os dados são guardados em banco de dados e em área privada do servidor (VPS) contratado junto à Hostinger, cujo datacenter fica em Campinas, São Paulo, Brasil.

Não existem prazos internos de retenção definidos. A conservação dos dados considera as finalidades do tratamento e eventuais obrigações legais aplicáveis. A validação jurídica das obrigações de retenção e a definição dos prazos internos ainda estão pendentes.

Desligamento de pessoas: usuários desligados podem ser desativados, o que impede o acesso, mas os dados continuam armazenados. A exclusão definitiva não é automática e não está implementada atualmente. A Vasta pretende excluir esses cadastros quando a lei permitir e for tecnicamente possível.

### 8. Segurança

Medidas efetivamente adotadas no sistema:

- Acesso por login, com senha guardada em hash e controle de permissões por perfil.
- Conexão protegida por HTTPS.
- Verificação de assinatura das notificações recebidas da Meta.
- Registros de auditoria sem o conteúdo das mensagens.
- Documentos em área privada, sem acesso público direto.

O sistema possui rotina de cópia de segurança criptografada, mas ela não é apresentada aqui como medida em operação.

Nenhum sistema é totalmente imune a falhas; em caso de incidente de segurança que possa causar dano relevante, a Vasta comunicará a ANPD e os titulares nos termos da LGPD.

### 9. Seus direitos

Nos termos do art. 18 da LGPD, o titular pode solicitar: confirmação de que há tratamento; acesso aos dados; correção de dados incompletos, inexatos ou desatualizados; anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade; portabilidade; eliminação dos dados tratados com consentimento; informação sobre com quem os dados são compartilhados; informação sobre a possibilidade de não consentir e suas consequências; e revogação do consentimento.

Para encerrar o vínculo com o WhatsApp ou o Telegram, ou pedir a exclusão do cadastro, utilize o contato abaixo.

### 10. Contato sobre privacidade

- Responsável indicada pela Vasta para o contato sobre privacidade: Rizola. Esta indicação não designa formalmente a função de encarregada pelo tratamento de dados (DPO).
- WhatsApp comercial para solicitações relacionadas à proteção de dados pessoais (privacidade): +55 31 9886-1100 — [abrir conversa no WhatsApp](https://wa.me/553198861100)
- Prazo de resposta: as solicitações serão atendidas observando os prazos previstos na legislação aplicável.

O titular também pode peticionar à Autoridade Nacional de Proteção de Dados (ANPD).

### 11. Alterações desta política

Esta política pode ser atualizada, em especial quando forem concluídas a validação jurídica das bases legais, das obrigações de retenção e da transferência internacional de dados. A data de vigência consta no início da página.

---

## 3. Pendências jurídicas

Estas três pendências **continuam abertas** e **precisam de validação jurídica**. A aprovação da Rizola em 28/10/2026 **não as resolve**. A página publicada as declara de forma transparente, sem marcadores internos, e não as apresenta como resolvidas.

| # | Pendência | Onde aparece | O que a política diz hoje | O que falta |
|---|---|---|---|---|
| 1 | **Bases legais** | Seção 4 | Lista as quatro finalidades do tratamento e diz que a base legal específica de cada uma ainda está em validação jurídica e não é apresentada nesta versão. | A assessoria jurídica indicar, para cada finalidade, a base do art. 7º da LGPD (ou do art. 11, se houver dado sensível). |
| 2 | **Retenção de dados** | Seção 7 | Não há prazos internos definidos. A conservação considera as finalidades e eventuais obrigações legais. Diz que a validação jurídica das obrigações de retenção e a definição dos prazos internos ainda estão pendentes. Usuários desligados podem ser desativados; a exclusão definitiva não é automática nem está implementada. | A assessoria jurídica confirmar quais registros têm obrigação legal de guarda e por quanto tempo; a empresa definir os prazos internos e o procedimento de exclusão. |
| 3 | **Transferência internacional** | Seção 6 | Meta e Telegram podem tratar dados fora do Brasil, conforme suas próprias políticas. O datacenter da Hostinger fica em Campinas/SP. Diz expressamente que a análise jurídica (art. 33 da LGPD) ainda não foi concluída. | A assessoria jurídica analisar se há transferência internacional (art. 33 da LGPD) e quais garantias se aplicam. |

> **Observação importante:** a aprovação administrativa da Rizola **não substitui a validação jurídica pendente**. Ela confirma que o texto descreve corretamente o que a empresa faz e deseja; não confirma bases legais, prazos de retenção nem a análise de transferência internacional. A publicação com essas três pendências declaradas no texto foi uma decisão da empresa; quando a assessoria jurídica se manifestar, a política deve ser atualizada (a seção 11 da política já avisa que isso pode acontecer).

---

## 4. Termos técnicos explicados

| Termo | Significado simples |
|---|---|
| **Hash (da senha)** | A senha é transformada em um código irreversível antes de ser guardada. Nem o sistema consegue ler a senha original. |
| **Token de sessão** | Um código temporário que o navegador guarda depois do login, para a pessoa não precisar entrar de novo a cada página. |
| **wa_id** | O identificador do número de telefone no WhatsApp. |
| **Webhook** | Um aviso automático que a Meta envia ao sistema quando chega uma mensagem. |
| **VPS** | Um servidor virtual alugado (aqui, da Hostinger), onde o sistema funciona. |
| **n8n** | Uma ferramenta de automação usada no fluxo do Telegram. |
| **Auditoria** | O registro de quem fez qual ação no sistema, e quando. |
| **ANPD** | Autoridade Nacional de Proteção de Dados, órgão que fiscaliza a LGPD. |
| **DPO / encarregado** | Pessoa formalmente designada pela empresa para ser o canal entre a empresa, os titulares e a ANPD. |

---

## 5. Registro de aprovação

### Aprovação administrativa

**Registrado:** Rizola aprovou a versão da política em **28/10/2026**. A aprovação foi comunicada ao responsável técnico do VastaFlow, que a registrou aqui; este documento não contém assinatura própria dela. **Recomenda-se guardar o comprovante (por exemplo, a mensagem ou o e-mail de aprovação) junto aos registros da empresa.**

Texto da declaração a que a aprovação se refere: a pessoa que aprova leu o texto da seção 2 e confirma que ele descreve corretamente as informações da empresa que lhe cabe confirmar, ciente de que esta aprovação **não substitui a validação jurídica** das pendências listadas na seção 3.

- [x] Aprovo o texto como está
- [ ] Aprovo com as alterações indicadas abaixo
- [ ] Não aprovo

Alterações solicitadas: nenhuma registrada.

| Campo | Registro |
|---|---|
| Nome da aprovadora | Rizola |
| Data da aprovação | 28/10/2026 |
| **Data efetiva de vigência** | 28/10/2026 |
| Comprovante da aprovação | A arquivar pela empresa (mensagem ou e-mail da Rizola) |

### Validação jurídica (pendente)

Nenhuma das três pendências foi validada até a data deste registro.

| Pendência | Situação | Validada por | Data | Resultado / observações |
|---|---|---|---|---|
| Bases legais | **Aberta** | | | |
| Retenção de dados e exclusão | **Aberta** | | | |
| Transferência internacional | **Aberta** | | | |

### Depois da aprovação

1. A página `/privacidade` foi atualizada: sem o aviso “Versão em revisão”, sem o marcador de aprovação pendente e sem marcadores internos `[A CONFIRMAR]`, com a data de vigência 28/10/2026.
2. As três pendências jurídicas continuam descritas na página como pendentes, e não como resolvidas.
3. Quando a assessoria jurídica validar cada pendência: preencher a tabela acima, atualizar o texto das seções 4, 6 e 7 da política, mudar a data de vigência da nova versão e pedir nova aprovação administrativa.

---

## 6. Atualização de 09/11/2026: consultas ao Plantae (pendente de aprovação)

**Situação: publicada na página como "Atualização pendente de aprovação". Ainda não foi aprovada formalmente.**

O VastaFlow passou a consultar o Plantae com dados reais, e a versão de 28/10/2026 dizia que essa consulta estava
desligada. Para a página não continuar afirmando algo falso, o texto foi atualizado e publicado em 09/11/2026, junto com
o painel Plantae, **identificado claramente como pendente de aprovação**. A aprovação de 28/10/2026 **não se aplica** a
este texto novo.

### 6.1 Como a página identifica a versão

> **Atualização pendente de aprovação.** Esta versão acrescenta a descrição das consultas ao Plantae (item 3.5) e ainda
> não foi aprovada pela Vasta.
>
> Versão anterior: data de vigência 28/10/2026, texto aprovado em 28/10/2026 por Rizola, responsável indicada pela Vasta
> para o contato sobre privacidade.

### 6.2 O que mudou em relação à versão de 28/10/2026

| Item da política | Mudança |
|---|---|
| Topo | A data de vigência e a aprovação passaram a ser apresentadas como da **versão anterior**; a versão atual aparece como pendente de aprovação |
| 2. A quem o sistema se destina | Passa a citar as informações consultadas no Plantae como possível fonte de dados de clientes, fornecedores e colaboradores |
| 3.4 Dados de gestão | Retirado o trecho que dizia que a consulta à Plantae estava desligada. A frase sobre a NFS-e continua igual (desligada) |
| **3.5 Consultas ao Plantae** | **Item novo** (texto completo em 6.3) |
| 4. Finalidades | Nova finalidade: consultar, em tempo real e somente para leitura, as informações financeiras da Vasta no Plantae, por usuários autorizados |
| 6. Compartilhamento | O Plantae entra na lista: o VastaFlow envia a ele só os parâmetros de cada consulta e recebe os resultados. O parágrafo do n8n passa a dizer que a resposta do sistema também passa por ele e que ele grava temporariamente o texto do comando e identificadores do Telegram; mantém "por alguns minutos" e avisa sobre resquícios técnicos e cópias de segurança |
| 8. Segurança | Nova medida: consultas ao Plantae restritas a usuários com permissão específica, com CPF/CNPJ e contas mascarados e sem armazenamento dos resultados nas tabelas operacionais |

As seções 1, 3.1, 3.2, 3.3 (WhatsApp), 5 (WhatsApp e Meta), 7, 9, 10 e 11 **não mudaram**.

### 6.3 Texto novo do item 3.5

> **3.5 Consultas ao Plantae**
>
> A Vasta utiliza o Plantae como sistema de gestão financeira. O VastaFlow consulta o Plantae **em tempo real** e
> **somente para leitura**: não cria, altera nem exclui informações no Plantae.
>
> - As consultas são permitidas apenas a usuários com permissão específica para isso, concedida pela Vasta.
> - No painel do sistema, esses usuários podem consultar contas a pagar e a receber, movimentações, extratos, contas
>   bancárias e cadastros de pessoas e empresas. Os resultados incluem valores, datas, descrições e os nomes de pessoas e
>   empresas (clientes, fornecedores e colaboradores) registrados no Plantae.
> - CPF, CNPJ e números de contas bancárias são exibidos **mascarados**, com apenas parte dos dígitos visível. O
>   mascaramento é feito pelo servidor do VastaFlow, antes de a informação chegar ao navegador.
> - O VastaFlow não armazena os resultados das consultas financeiras em suas tabelas operacionais. Os registros de
>   auditoria são mantidos separadamente. As informações transmitidas pelos canais de mensagens também estão sujeitas ao
>   tratamento e à retenção técnica descritos nesta política. No navegador, os resultados ficam apenas na tela enquanto a
>   consulta está aberta, sem armazenamento local, e as respostas são enviadas com a instrução de não serem guardadas em
>   cache.
> - Pelos canais de mensagens, os comandos de contas a pagar e a receber devolvem um resumo financeiro (vencimento, valor,
>   parcela e um número de referência), sem CPF/CNPJ e sem o nome de clientes. O nome de fornecedores só seria exibido se
>   essa opção fosse ativada na configuração do sistema; na configuração atual, ela está desativada.
> - As conversas com o assistente no Telegram **não são protegidas por criptografia de ponta a ponta**: as mensagens,
>   inclusive essas respostas, ficam nos servidores do Telegram, conforme a política dele. O caminho dessas mensagens
>   dentro do sistema está descrito no item 6.
> - Registros de auditoria: cada consulta gera um registro de quem consultou, quando, qual consulta ou comando foi usado e
>   o resultado (sucesso ou falha); nas consultas pelo painel, também o período pesquisado e a quantidade de itens
>   retornados. Esses registros são distintos das informações consultadas e não guardam valores, nomes, documentos nem os
>   termos de busca.

A fonte oficial do texto completo é a própria página (`frontend/src/pages/PrivacyPolicyPage.tsx`).

### 6.4 Pontos para a aprovação

Antes de aprovar, confira se o texto descreve corretamente o que a empresa faz e deseja, em especial:

1. Que usuários autorizados vejam no painel **nomes** de clientes, fornecedores e colaboradores (CPF/CNPJ só mascarado).
2. Que o nome de fornecedores continue **oculto** no Telegram (configuração atual) e o de clientes nunca apareça.
3. A descrição da passagem das mensagens pelo **n8n** e pelo **Telegram** (sem criptografia de ponta a ponta).
4. O Plantae na lista de compartilhamento. A localização do datacenter do Plantae **não é informada** no texto, porque
   não foi confirmada; ela entra na análise de transferência internacional, que continua pendente (seção 3).

Esta aprovação, como a de 28/10/2026, **não substitui a validação jurídica** das três pendências da seção 3.

### 6.5 Registro de aprovação da atualização (pendente)

| Campo | Valor |
|---|---|
| Situação | **Pendente de aprovação formal** |
| Nome da aprovadora | (a preencher) |
| Data da aprovação | (a preencher) |
| Data efetiva de vigência da atualização | (a preencher na aprovação) |
| Comprovante da aprovação | A arquivar pela empresa (mensagem ou e-mail) |

### 6.6 Depois da aprovação

1. Na página, trocar o parágrafo "Atualização pendente de aprovação" pela nova data de vigência e de aprovação. Manter ou
   retirar a linha da versão anterior, conforme a decisão da empresa.
2. Ajustar os testes da página que conferem o topo (`frontend/src/App.test.tsx`, "/privacidade: identificacao da versao").
3. Implantar a página por um deploy seletivo, com a mesma trava por hash usada em 09/11/2026
   (`docs/deploy-2026-11-09-plantae-painel.md`).
4. Preencher a tabela 6.5 e atualizar o topo deste documento.
