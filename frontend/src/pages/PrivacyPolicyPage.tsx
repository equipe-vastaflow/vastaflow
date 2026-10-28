import type { ReactNode } from "react";

/**
 * Politica de Privacidade publica (exigida pela Meta para o app do WhatsApp Business).
 * Rota fora do `ProtectedRoute`: nao exige login e nao faz nenhuma chamada a API.
 * Descreve apenas o tratamento realmente implementado. Tres pontos seguem em validacao juridica (bases
 * legais, retencao e transferencia internacional) e estao ditos como tal no texto; o registro interno
 * da aprovacao e dessas pendencias fica em `docs/politica-privacidade-revisao.md`.
 */
export function PrivacyPolicyPage(): ReactNode {
  return (
    <main className="policy-page">
      <article className="card policy-card">
        <header className="policy-header">
          <p className="brand">VastaFlow</p>
          <h1>Política de Privacidade</h1>
          <p className="muted">
            Data de vigência: 28/10/2026. Texto aprovado em 28/10/2026 por
            Rizola, responsável indicada pela Vasta para o contato sobre
            privacidade.
          </p>
        </header>

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
            <li>CNPJ: 07.131.218/0001-24</li>
            <li>
              Endereço: Estrada Municipal de Morada Nova de Minas, Zona Rural,
              Morada Nova de Minas/MG, CEP 35.628-000, Brasil
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
            a pessoas cadastradas pela Vasta (usuários do sistema), que são
            sócios e funcionários. O assistente só atende quem teve o seu número
            do WhatsApp (ou conta do Telegram) previamente vinculado a um
            usuário.
          </p>
          <p>
            Além dos usuários, os documentos e lançamentos do sistema podem
            conter dados pessoais de clientes, fornecedores e colaboradores.
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
              processamento). O{" "}
              <strong>texto das mensagens não é gravado</strong> nesses
              registros nem nos registros de auditoria.
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
            Dados de terceiros: descrições, observações e documentos lançados no
            sistema podem conter dados pessoais de clientes, fornecedores e
            colaboradores, conforme o conteúdo inserido pelos usuários. O
            sistema não possui campos específicos para esses dados.
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
          </ul>
          <p>
            Bases legais (art. 7º da LGPD): a indicação da base legal específica
            de cada finalidade ainda está em validação jurídica e não é
            apresentada nesta versão.
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
              (VPS) em que o sistema funciona. Localização do datacenter:
              Campinas, São Paulo, Brasil.
            </li>
            <li>
              Cópia de segurança externa (Google Drive): a decisão foi adiada.
              Esta política não descreve esse envio como em operação e será
              atualizada antes de qualquer adoção.
            </li>
          </ul>
          <p>
            Os serviços da Hostinger, da Meta e do Telegram são conhecidos e
            utilizados pela Vasta. A Meta e o Telegram podem tratar dados fora
            do Brasil, conforme as suas próprias políticas.
          </p>
          <p>
            O sistema usa o n8n para orquestrar o fluxo do Telegram. O conteúdo
            transitório das mensagens do Telegram fica registrado nele por
            alguns minutos antes de ser apagado, conforme a configuração de
            limpeza existente.
          </p>
          <p>
            Transferência internacional: a análise jurídica sobre eventual
            transferência internacional de dados (Meta, Telegram, Hostinger e
            outros) e as garantias aplicáveis, conforme o art. 33 da LGPD, ainda
            não foi concluída. O uso desses serviços não substitui essa análise.
          </p>
        </section>

        <section>
          <h2>7. Armazenamento e retenção</h2>
          <p>
            Os dados são guardados em banco de dados e em área privada do
            servidor (VPS) contratado junto à Hostinger, cujo datacenter fica em
            Campinas, São Paulo, Brasil.
          </p>
          <p>
            Não existem prazos internos de retenção definidos. A conservação dos
            dados considera as finalidades do tratamento e eventuais obrigações
            legais aplicáveis. A validação jurídica das obrigações de retenção e
            a definição dos prazos internos ainda estão pendentes.
          </p>
          <p>
            Desligamento de pessoas: usuários desligados podem ser desativados,
            o que impede o acesso, mas os dados continuam armazenados. A
            exclusão definitiva não é automática e não está implementada
            atualmente. A Vasta pretende excluir esses cadastros quando a lei
            permitir e for tecnicamente possível.
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
            O sistema possui rotina de cópia de segurança criptografada, mas ela
            não é apresentada aqui como medida em operação.
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
              Responsável indicada pela Vasta para o contato sobre privacidade:
              Rizola. Esta indicação não designa formalmente a função de
              encarregada pelo tratamento de dados (DPO).
            </li>
            <li>
              WhatsApp comercial para solicitações relacionadas à proteção de
              dados pessoais (privacidade): +55 31 9886-1100 —{" "}
              <a
                href="https://wa.me/553198861100"
                target="_blank"
                rel="noopener noreferrer"
              >
                abrir conversa no WhatsApp
              </a>
            </li>
            <li>
              Prazo de resposta: as solicitações serão atendidas observando os
              prazos previstos na legislação aplicável.
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
            Esta política pode ser atualizada, em especial quando forem
            concluídas a validação jurídica das bases legais, das obrigações de
            retenção e da transferência internacional de dados. A data de
            vigência consta no início da página.
          </p>
        </section>
      </article>
    </main>
  );
}
