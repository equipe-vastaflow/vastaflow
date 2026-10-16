# Ativação do WhatsApp oficial (Cloud API) — pesquisa, caminhos e procedimento

> **Estado: PLANEJAMENTO. Nada foi feito na Meta.** Nenhuma conta, app, número, token ou webhook foi criado, nenhum número foi
> registrado ou migrado, nenhuma chamada foi feita à Meta, e o WhatsApp do VastaFlow continua **desligado**. Este documento separa
> o que a documentação oficial **confirma**, o que **só fontes de terceiros** afirmam e o que **ninguém verificou**.
> Fontes oficiais lidas em 2026-10-16 (páginas `developers.facebook.com/documentation/business-messaging/whatsapp/...`):
> *Onboard Business app users (Coexistence)*, *Embedded Signup overview*, *Use an existing WhatsApp number*, *Register a phone number*,
> *Access tokens*, *Become a Tech Provider*, *Create a webhook endpoint*, *Pricing*, *Get started* (Cloud API).

## 1. Coexistência (app WhatsApp Business + Cloud API no MESMO número): **CONDICIONAL**

**O que é (oficial):** o cliente conecta o número que já usa no app WhatsApp Business à Cloud API pelo *Embedded Signup*, e passa a usar
os dois ao mesmo tempo (o histórico é sincronizado entre eles).

**Condições confirmadas pela Meta:**
- o cliente precisa do app **WhatsApp Business versão 2.24.17 ou superior**;
- quem conecta precisa **já ser Solution Partner ou Tech Provider** da Meta, usar o *Embedded Signup* com *session logging* e ter um
  webhook funcionando. A página **não** diz que uma empresa possa conectar o PRÓPRIO número sem ser parceiro;
- fluxo: o cliente informa o número do app, o WhatsApp mostra um **código de verificação** (a página não fala em QR), o cliente recebe uma
  mensagem do WhatsApp, toca em *Conectar*, confirma o compartilhamento do histórico e cola o código;
- **não se registra o número** pela API (a etapa é pulada); e **não há como desfazer pela API** (o *Deregister* não funciona): quem
  desconecta é o cliente, no app (*Configurações > Conta > Plataforma de negócios > Desconectar*).

**Limitações oficiais (afetam o uso atual da Rizola):** taxa fixa de 20 mensagens/s; histórico sincronizado só de até 180 dias
(mídia: 14 dias), **uma única vez, em 24 h**, senão o número é desconectado; **grupos não sincronizam**; ficam desativados/indisponíveis
mensagens temporárias, visualização única, localização em tempo real; **listas de transmissão viram somente leitura**; não funcionam via
API chamadas, catálogo/pedidos, mensagens de marketing, respostas rápidas, etiquetas, perfil comercial e Canais; todos os
**dispositivos vinculados (WhatsApp Web/Desktop) são desvinculados** ao conectar; o app deve ficar **aberto** durante a sincronização e a
conexão cai por inatividade do aparelho (~14 dias do celular principal); mensagens enviadas pelo app seguem gratuitas, as enviadas pela API
seguem o preço da Cloud API; mensagens enviadas pelo app **não** abrem nem prorrogam a janela de 24 h da API.

**Brasil: NÃO CONFIRMADO oficialmente.** As páginas oficiais lidas **não listam países** nem citam o Brasil. Fontes de terceiros
(blogs de fornecedores, comerciais) divergem entre si sobre restrições de outros países; **uma** cita o Brasil como suportado. Também só
terceiros mencionam "mínimo de 7 dias de uso no app". **Não presumir elegibilidade:** a confirmação real é tentar o fluxo (ou perguntar ao
suporte da Meta / a um parceiro).

**Conclusão:** coexistência existe, mas para o VastaFlow é um caminho **pesado e condicional**: exigiria que o VastaFlow se torne **Tech
Provider** (empresa verificada pela Meta, revisão do app com 2 vídeos e permissões *Advanced Access*; a documentação não diz se um
desenvolvedor de um único cliente é aceito — "consultar o suporte") e ainda **mudaria o uso diário do app** da Rizola (itens acima).

## 2. Os três caminhos para a Rizola

| | Caminho | Interrompe o WhatsApp atual? | Depende de | Veredito |
| --- | --- | --- | --- | --- |
| **A** | **Número NOVO, dedicado ao bot** (chip/linha nova), cadastrado na WABA da Rizola | **Não** — o número atual não é tocado | só da Rizola/nossa conta Meta; é o caminho de "desenvolvedor direto" documentado | **RECOMENDADO** (mais curto e seguro) |
| **B** | Coexistência no número atual | Altera o app (seção 1) | Tech Provider + Embedded Signup + Brasil não confirmado | só se a Rizola EXIGIR atender pelo número atual |
| **C** | Migrar o número atual (apagar a conta do app) | **SIM, e perde o histórico** (a Meta diz: "your existing messaging history will be lost") | — | **PROIBIDO** pela prioridade do projeto |

**Por que A:** as funções do VastaFlow (comandos financeiros e de NFS-e) são para a EQUIPE da Rizola, não para os clientes dela. Um
número separado não mistura conversa de cliente com comando, não depende de nenhuma exceção da Meta e deixa o app atual intacto. A equipe
apenas salva o número do bot e escreve para ele.

## 3. Regras e fatos para o Brasil
- **Janela de 24 h:** o bot só **responde** a quem escreveu; mensagem sem janela aberta exige *template* aprovado (e o VastaFlow **não
  envia mensagens proativas**). Respostas dentro da janela são **gratuitas**; só *templates* entregues são cobrados (cobrança por mensagem
  desde 01/07/2025).
- **Moeda (BRL):** a Meta informa que, a partir de 01/07/2026, novas WABAs em BRL só para parceiros/clientes diretos elegíveis com "Sold-To"
  no Brasil, faturadas pela Facebook Brasil, e que WABAs não-BRL deixam de entregar mensagens em 01/07/2027. **Conferir com a Meta** como isso se
  aplica à WABA da Rizola ao criá-la.
- **Forma de pagamento:** o cliente final precisa cadastrar um meio de pagamento na WABA para enviar *templates* (não se aplica a respostas gratuitas).
- **Identificador brasileiro:** o `wa_id` pode vir sem o "9" extra; o vínculo por **código enviado do aparelho** (`/vincular`) já cobre isso.
- **Embedded Signup v2 será descontinuado em 15/10/2026** (usar v4) — relevante só para o caminho B.

## 4. Requisitos da Meta (para o caminho A)
1. **Portfólio empresarial (Meta Business)** da Rizola; ela (ou seu administrador) deve ser dona dele.
2. **App da Meta** do tipo Business, caso de uso *"Connect with customers through WhatsApp"* (gera o App Secret).
3. **WABA** (conta WhatsApp Business) — criada/selecionada em *WhatsApp > API Setup*; já vem com um **número de teste da Meta**.
4. **Usuário de sistema** com *Gerenciar app* e acesso à WABA, e **token** com `business_management`, `whatsapp_business_management`,
   `whatsapp_business_messaging`. O token temporário do painel "expira em poucas horas": para operar, gerar o do usuário de sistema.
5. **Número real** (caminho A): adicionar na WhatsApp Manager, **verificar posse**, **registrar pela API** (`POST /{PHONE_NUMBER_ID}/register` com PIN
   de 6 dígitos; limite de 10 pedidos/72 h) e esperar a **aprovação do nome de exibição**. Não pode estar em uso em app WhatsApp.
6. **Webhook em HTTPS válido** (certificado **autoassinado não é aceito**), respondendo ao GET de verificação e aos POSTs assinados.
7. Verificação do negócio (*Business Verification*) pode ser exigida pela Meta para aumentar limites e liberar recursos — **não confirmado
   nas páginas lidas**; tratar como possível exigência.

## 5. Procedimento (caminho A) — quem faz o quê
| # | Passo | Quem | Depende de | Pode exigir aprovação da Meta |
| --- | --- | --- | --- | --- |
| 1 | Confirmar que existe um portfólio da Rizola, quem é admin dele e se ele está verificado | **Rizola** | — | verificação do negócio |
| 2 | Decidir o caminho (A recomendado) e **conseguir uma linha nova** que receba SMS/ligação de verificação | **Rizola** | decisão | — |
| 3 | Criar o app (Business, caso de uso WhatsApp) **no portfólio da Rizola**, adicionando-nos como desenvolvedores | **Admin da Rizola** (nós orientamos) | passo 1 | — |
| 4 | Ensaiar com o **número de teste** da Meta (seção 6) | Nós + admin | passos 1 e 3 | não |
| 5 | Criar o **usuário de sistema** e o **token** permanente; copiar **direto** para o `.env` da VPS | **Admin da Rizola** | passo 3 | não |
| 6 | Copiar o **App Secret** e o **Phone Number ID** para o `.env` da VPS | Admin + nós | passo 3 | não |
| 7 | VPS no ar + DNS + HTTPS (`docs/deploy-vps.md`); `bash scripts/https-verify.sh` ok | **Nós** | VPS/domínio | não |
| 8 | No painel da Meta: *Callback URL* `https://<SERVER_NAME>/api/webhooks/whatsapp` + *Verify token* (>= 16 caracteres, inventado por nós, igual a `WHATSAPP_WEBHOOK_TOKEN`) → a Meta faz o GET; assinar o campo `messages` | Nós + admin | passos 6 e 7 | não |
| 9 | Ligar `WHATSAPP_ENABLED=true` (5 variáveis `WHATSAPP_*` preenchidas; **recriar só o backend**) | **Nós, com autorização** | passos 5–8 | não |
| 10 | Testar: `/ajuda` de um número vinculado, `/vincular`, comando negado, duplicata (lista em `docs/whatsapp.md` seção 7) | Nós | passo 9 | não |
| 11 | Só depois: adicionar o **número real** (verificar, registrar por API, nome de exibição) e trocar `WHATSAPP_PHONE_NUMBER_ID` | Admin + nós | passo 2; aprovação do nome | **nome de exibição**; possivelmente verificação do negócio |
| 12 | Vincular cada pessoa da equipe (`link-code --canal whatsapp`) | Nós (ADMIN) | passo 11 | não |

Rollback: `WHATSAPP_ENABLED=false` e recriar o backend (as rotas voltam a 404); remover a assinatura do webhook no painel.

## 6. Dá para testar SEM o número real? **Sim, parcialmente.**
- O próprio painel da Meta cria, ao adicionar o WhatsApp ao app, uma **conta de teste e um número de teste**; com ele é possível enviar
  mensagens gratuitas a **até 5 destinatários** previamente verificados por código (informação do guia *Get started*; o limite exato deve
  ser conferido na tela).
- **Envio** com o número de teste: possível já, com token temporário (chamada real à Meta — **precisa de autorização**, não foi feita).
- **Recebimento** (webhook) exige **URL pública em HTTPS**, portanto só depois da VPS. Não abrir a stack local à internet para isso.
- O número de teste **não** serve para a equipe usar de verdade (só 5 destinatários, conta de teste) — é só ensaio de ponta a ponta.

## 7. Conferência do código existente com a documentação oficial
| Requisito oficial | Implementação | Resultado |
| --- | --- | --- |
| GET de verificação: comparar `hub.verify_token`; responder **200 com o `hub.challenge`**; outro status se inválido | `verifyChallenge` + controller (200 `text/plain`; 403 se inválido) | **OK** |
| POST: HMAC-SHA256 do **corpo bruto** com o App Secret, cabeçalho `X-Hub-Signature-256`; 200 se válido, outro se não | `verifyMetaSignature` (tempo constante, hex estrito, corpo bruto via `rawBody`) | **OK** |
| Falha ⇒ a Meta reenvia por até **7 dias** ⇒ deduplicar | tabela `whatsapp_inbound_events` com índice único `(phone_number_id, message_id)` | **OK** |
| HTTPS com certificado válido (autoassinado não vale) | Let's Encrypt via `docker-compose.https.yml` (testado com servidor ACME de teste) | **OK, não emitido** |
| Atualizações em lote (até 1000) | o payload é percorrido por `entry`/`changes`/`messages` | **OK** |
| Token no cabeçalho `Authorization: Bearer` | `WhatsappApiClient` (token só no cabeçalho, host oficial fixo) | **OK** |
| Coexistência envia eventos extras (`smb_message_echoes`, `history`, `smb_app_state_sync`) | só o campo `messages` é processado; o restante é ignorado | **OK** (nenhuma ação indevida em eco/histórico) |
| Respostas só dentro da janela de 24 h (sem template) | o bot só responde ao remetente, nunca envia proativamente | **OK** |
| `unsupported`/`131060` esperado em coexistência | mensagem sem texto é ignorada | **OK** |
| **Número compartilhado com clientes** (coexistência ou número aberto ao público) | **INCOMPATIBILIDADE comprovada:** qualquer remetente desconhecido recebia a resposta automática "número não vinculado" (e o aviso de limite) | **CORRIGIDO** (abaixo) |

**Correção mínima aplicada:** `WHATSAPP_REPLY_TO_UNLINKED` (padrão **`false`**). Remetente sem vínculo passa a receber **silêncio**
(nada executa, a tentativa continua auditada sem número nem texto); o aviso de limite também só sai com a opção ligada; o comando explícito
`/vincular <codigo>` **sempre** responde. Mudança em 1 arquivo de lógica, no módulo, na validação de ambiente, no Compose e no `.env.example`; testes
unitários e e2e atualizados/adicionados.

**Não verificado:** o valor atual da versão da Graph API (`WHATSAPP_GRAPH_API_VERSION` não tem padrão; os guias oficiais usam `v23.0` nos exemplos —
confira a vigente no *changelog* da Meta ao ativar) e a página de referência dos campos do webhook (formato do payload de `messages`), que o
projeto implementou na fase anterior a partir da documentação e de fixtures.

## 8. Dependências externas (resumo)
- **Rizola:** portfólio Meta e administrador, decisão do caminho, **linha nova** para o bot (caminho A), meio de pagamento (só se houver templates), quem da equipe será vinculado.
- **Domínio/VPS:** VPS contratada, DuckDNS (ou domínio próprio), HTTPS emitido, `bash scripts/https-verify.sh` passando.
- **Meta (aprovações possíveis):** nome de exibição do número; verificação do negócio (se exigida); *Tech Provider* + revisão de app (**só** para coexistência).
- **Nós:** token e App Secret direto na VPS; autorização explícita antes de ligar `WHATSAPP_ENABLED`.

## 9. Próxima ação concreta
Perguntar à Rizola, em uma mensagem: **(a)** existe portfólio empresarial na Meta e quem é o administrador? **(b)** ela aceita um **número novo
dedicado ao bot**, mantendo o atual intacto? Se a resposta de (b) for "não, tem que ser o número atual", o único caminho é a coexistência: aí o
passo seguinte é **consultar a Meta/um parceiro** sobre elegibilidade do número brasileiro e sobre o VastaFlow ser Tech Provider — antes de
qualquer outra coisa, e **sem** tocar no app dela.
