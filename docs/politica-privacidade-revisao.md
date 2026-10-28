# Política de Privacidade do VastaFlow — registro de revisão e aprovação

**Para:** Rizola, responsável indicada pela Vasta para o contato sobre privacidade
**Situação:** **aprovada administrativamente por Rizola em 28/10/2026** e preparada para publicação, com **três pendências jurídicas ainda abertas** (bases legais, retenção de dados e transferência internacional), declaradas de forma transparente no próprio texto
**Data de vigência:** 28/10/2026

Este documento reúne, para leitura sem conhecimento técnico:

1. [Como ler](#1-como-ler-este-documento)
2. [O texto completo da política](#2-texto-completo-da-política) — é o mesmo texto da página `https://vastaflow.duckdns.org/privacidade`
3. [As três pendências jurídicas](#3-pendências-jurídicas)
4. [Termos técnicos explicados](#4-termos-técnicos-explicados)
5. [Registro de aprovação](#5-registro-de-aprovação)

---

## 1. Como ler este documento

- A **seção 2** é a política exatamente como aparece na página pública (`/privacidade`). Nada foi acrescentado ou retirado dela.
- Depois da aprovação, a página **não exibe mais** o aviso “Versão em revisão” nem marcadores internos `[A CONFIRMAR]`. Os três pontos ainda pendentes de validação jurídica continuam ditos no texto, em linguagem para o público (seções 4, 6 e 7 da política).
- Algumas frases descrevem limites reais do sistema hoje (por exemplo, que a exclusão definitiva de cadastros não é automática e que as respostas automáticas do WhatsApp ainda não foram comprovadas). Elas foram escritas assim de propósito, para a política não prometer o que o sistema ainda não faz.
- A seção 3 resume as pendências jurídicas e a seção 5 registra a sua decisão.

---

## 2. Texto completo da política

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
