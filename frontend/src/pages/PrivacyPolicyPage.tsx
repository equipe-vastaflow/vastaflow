import type { ReactNode } from "react";

/**
 * Trecho que depende de confirmacao da empresa. Fica visivel e marcado de proposito: o texto NAO e
 * definitivo enquanto houver algum `Pending` na pagina. Ao confirmar, troque o `Pending` pelo valor real.
 */
function Pending({ children }: { children: ReactNode }): ReactNode {
  return (
    <mark className="policy-pending" data-pending="true">
      [A CONFIRMAR: {children}]
    </mark>
  );
}

/**
 * Politica de Privacidade publica (exigida pela Meta para o app do WhatsApp Business).
 * Rota fora do `ProtectedRoute`: nao exige login e nao faz nenhuma chamada a API.
 * Descreve apenas o tratamento realmente implementado; o que depende da empresa esta em `Pending`.
 */
export function PrivacyPolicyPage(): ReactNode {
  return (
    <main className="policy-page">
      <article className="card policy-card">
        <header className="policy-header">
          <p className="brand">VastaFlow</p>
          <h1>Política de Privacidade</h1>
          <p className="muted">
            Última atualização: <Pending>data de vigência</Pending>
          </p>
        </header>

        <p className="policy-draft" role="note">
          Versão em revisão: os trechos destacados como “A CONFIRMAR” dependem
          de confirmação da empresa e este texto ainda não é definitivo.
        </p>

        <section>
          <h2>1. Quem somos</h2>
          <p>
            O VastaFlow é o sistema interno de gestão operado por{" "}
            <strong>
              Vasta Participações Empreendimentos e Agropecuária Ltda.
            </strong>{" "}
            (“Vasta”), controladora dos dados pessoais tratados por ele, nos
            termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018 –
            LGPD).
          </p>
          <ul>
            <li>
              CNPJ: <Pending>CNPJ da empresa</Pending>
            </li>
            <li>
              Endereço: <Pending>endereço da sede</Pending>
            </li>
          </ul>
          <p>
            Esta política se aplica ao sistema, disponível em
            vastaflow.duckdns.org, e ao assistente “Bot_Vasta”, que atende por
            mensagens no WhatsApp (API oficial do WhatsApp Business, da Meta) e
            no Telegram.
          </p>
        </section>

        <section>
          <h2>2. A quem o sistema se destina</h2>
          <p>
            O VastaFlow não é um serviço aberto ao público. O acesso é restrito
            a pessoas cadastradas pela Vasta (usuários do sistema). O assistente
            só atende quem teve o seu número do WhatsApp (ou conta do Telegram)
            previamente vinculado a um usuário.
          </p>
          <p>
            Categorias de titulares:{" "}
            <Pending>
              confirmar quem são os titulares (por exemplo, colaboradores,
              gestores e terceiros cujos dados sejam lançados no sistema)
            </Pending>
            .
          </p>
        </section>

        <section>
          <h2>3. Dados pessoais tratados</h2>
          <h3>3.1 Cadastro e acesso</h3>
          <ul>
            <li>Nome, e-mail e perfil de acesso (papel) do usuário.</li>
            <li>
              A senha é guardada somente de forma protegida (hash), nunca em
              texto legível.
            </li>
            <li>
              Após o login, o navegador guarda localmente um token de sessão com
              prazo de validade, usado para manter a sessão aberta. O sistema
              não usa cookies de publicidade ou de rastreamento.
            </li>
          </ul>

          <h3>3.2 Vínculo com os canais de mensagens</h3>
          <ul>
            <li>
              O identificador do canal que liga o usuário ao assistente: o
              número do WhatsApp (wa_id) ou o identificador da conversa do
              Telegram. O vínculo é feito pelo próprio usuário com um código de
              uso único (<code>/vincular</code>).
            </li>
          </ul>

          <h3>3.3 Mensagens no WhatsApp</h3>
          <ul>
            <li>
              A integração com o WhatsApp Business está ativada e o sistema
              recebe da Meta os eventos das mensagens enviadas ao número do
              assistente. O assistente foi projetado para tratar mensagens{" "}
              <strong>de texto</strong> em conversas individuais, interpretando
              o texto para executar o comando ou a consulta pedida.
            </li>
            <li>
              As respostas automáticas do assistente pelo WhatsApp{" "}
              <strong>ainda não foram comprovadas em operação</strong> e podem
              não estar disponíveis no momento.
            </li>
            <li>
              Os registros de controle de cada evento recebido guardam apenas
              dados técnicos (identificadores, situação e resultado do
              processamento). O <strong>texto das mensagens não é gravado</strong>{" "}
              nesses registros nem nos registros de auditoria.
            </li>
            <li>
              O identificador do número do remetente (<code>wa_id</code>) pode
              ser armazenado no vínculo entre o número e o usuário do sistema
              (item 3.2).
            </li>
            <li>
              Pelo projeto, mensagens de números não vinculados não recebem
              resposta do assistente.
            </li>
            <li>
              Pelo projeto, as respostas são enviadas somente a quem escreveu,
              dentro da janela de atendimento de 24 horas do WhatsApp, e o
              sistema não envia mensagens por iniciativa própria.
            </li>
          </ul>

          <h3>3.4 Dados de gestão lançados no sistema</h3>
          <ul>
            <li>
              Lançamentos financeiros e documentos enviados pelos usuários,
              guardados em área privada do servidor.
            </li>
            <li>
              Registros de auditoria: quem fez qual ação e quando, sem o
              conteúdo das mensagens.
            </li>
            <li>Notificações internas destinadas ao próprio usuário.</li>
          </ul>
          <p>
            Dados de terceiros:{" "}
            <Pending>
              confirmar se lançamentos e documentos contêm dados pessoais de
              clientes, fornecedores ou outras pessoas, e quais
            </Pending>
            .
          </p>
          <p>
            Recursos de emissão de nota fiscal de serviço (NFS-e) e de consulta
            à Plantae existem no código, mas estão <strong>desligados</strong>.
            Se forem ativados, esta política será atualizada antes (a NFS-e
            trataria nome e CPF/CNPJ do tomador do serviço).
          </p>
        </section>

        <section>
          <h2>4. Para que usamos os dados (finalidades)</h2>
          <ul>
            <li>
              Autenticar usuários e controlar o que cada perfil pode ver e
              fazer.
            </li>
            <li>Operar a gestão financeira e documental da empresa.</li>
            <li>
              Permitir consultas e comandos pelo WhatsApp e pelo Telegram por
              usuários vinculados.
            </li>
            <li>Manter trilha de auditoria e a segurança do sistema.</li>
            <li>
              Gerar cópias de segurança para recuperação em caso de falha.
            </li>
          </ul>
          <p>
            Bases legais (art. 7º da LGPD):{" "}
            <Pending>confirmar a base legal de cada finalidade</Pending>.
          </p>
        </section>

        <section>
          <h2>5. Integração com WhatsApp e Meta</h2>
          <p>
            O WhatsApp Business é fornecido pela Meta Platforms. Quando uma
            mensagem é enviada ao número do assistente, a Meta a processa como
            plataforma de mensagens, conforme os seus próprios termos e política
            de privacidade, e a entrega ao VastaFlow por um canal de notificação
            (webhook) cuja origem é verificada por assinatura. A Vasta não vende
            dados e não os usa para publicidade.
          </p>
          <p>
            O uso do WhatsApp está sujeito também às políticas da Meta, que a
            Vasta não controla.
          </p>
        </section>

        <section>
          <h2>6. Compartilhamento</h2>
          <p>
            Os dados são compartilhados somente com prestadores necessários à
            operação:
          </p>
          <ul>
            <li>
              Meta (WhatsApp) e Telegram, como plataformas dos canais de
              mensagens.
            </li>
            <li>
              Hostinger, como provedora terceirizada de hospedagem do servidor
              (VPS) em que o sistema funciona. País do datacenter:{" "}
              <Pending>confirmar o país do datacenter</Pending>.
            </li>
            <li>
              Armazenamento externo das cópias de segurança: o sistema possui
              rotina de cópia criptografada com envio ao Google Drive, mas a
              operação efetiva em produção{" "}
              <Pending>
                confirmar se a rotina está ativa e qual serviço e conta de
                destino serão usados
              </Pending>
              .
            </li>
          </ul>
          <p>
            O sistema usa o n8n para orquestrar o fluxo do Telegram. O conteúdo
            transitório das mensagens do Telegram fica registrado nele por
            alguns minutos antes de ser apagado, conforme a configuração de
            limpeza existente.
          </p>
          <p>
            Transferência internacional:{" "}
            <Pending>
              confirmar se há transferência internacional de dados (Meta,
              Telegram e outros) e as garantias aplicáveis, conforme o art. 33
              da LGPD
            </Pending>
            .
          </p>
        </section>

        <section>
          <h2>7. Armazenamento e retenção</h2>
          <p>
            Os dados são guardados em banco de dados e em área privada do
            servidor (VPS) contratado junto à Hostinger.
          </p>
          <p>
            Prazos de retenção:{" "}
            <Pending>
              definir por quanto tempo cada categoria de dado é mantida e quando
              é eliminada ou anonimizada
            </Pending>
            .
          </p>
          <p>
            Cópias de segurança:{" "}
            <Pending>confirmar prazo de guarda e local das cópias</Pending>.
          </p>
        </section>

        <section>
          <h2>8. Segurança</h2>
          <p>Medidas efetivamente adotadas no sistema:</p>
          <ul>
            <li>
              Acesso por login, com senha guardada em hash e controle de
              permissões por perfil.
            </li>
            <li>Conexão protegida por HTTPS.</li>
            <li>
              Verificação de assinatura das notificações recebidas da Meta.
            </li>
            <li>Registros de auditoria sem o conteúdo das mensagens.</li>
            <li>Documentos em área privada, sem acesso público direto.</li>
          </ul>
          <p>
            Cópias de segurança criptografadas estão implementadas no sistema,
            mas a sua operação efetiva em produção{" "}
            <Pending>confirmar antes de listá-las como medida adotada</Pending>.
          </p>
          <p>
            Nenhum sistema é totalmente imune a falhas; em caso de incidente de
            segurança que possa causar dano relevante, a Vasta comunicará a ANPD
            e os titulares nos termos da LGPD.
          </p>
        </section>

        <section>
          <h2>9. Seus direitos</h2>
          <p>
            Nos termos do art. 18 da LGPD, o titular pode solicitar: confirmação
            de que há tratamento; acesso aos dados; correção de dados
            incompletos, inexatos ou desatualizados; anonimização, bloqueio ou
            eliminação de dados desnecessários ou tratados em desconformidade;
            portabilidade; eliminação dos dados tratados com consentimento;
            informação sobre com quem os dados são compartilhados; informação
            sobre a possibilidade de não consentir e suas consequências; e
            revogação do consentimento.
          </p>
          <p>
            Para encerrar o vínculo com o WhatsApp ou o Telegram, ou pedir a
            exclusão do cadastro, utilize o contato abaixo.
          </p>
        </section>

        <section>
          <h2>10. Contato sobre privacidade</h2>
          <ul>
            <li>
              Encarregado pelo tratamento de dados (DPO):{" "}
              <Pending>nome ou setor responsável</Pending>
            </li>
            <li>
              E-mail para solicitações:{" "}
              <Pending>e-mail de privacidade da empresa</Pending>
            </li>
            <li>
              Prazo de resposta: <Pending>prazo interno de atendimento</Pending>
            </li>
          </ul>
          <p>
            O titular também pode peticionar à Autoridade Nacional de Proteção
            de Dados (ANPD).
          </p>
        </section>

        <section>
          <h2>11. Alterações desta política</h2>
          <p>
            Esta política pode ser atualizada. A data da última atualização
            consta no início da página.
          </p>
        </section>
      </article>
    </main>
  );
}
