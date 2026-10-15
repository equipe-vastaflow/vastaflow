import { AuditAction, AuditModuleName } from '../../audit/audit-action.enum';
import {
  commandFailure,
  commandOk,
  CommandOutcome,
  type CommandAuditConfig,
  type CommandContext,
  type CommandHandler,
  type CommandResult,
} from '../../commands/command.types';
import { PermissionCode } from '../../permissions/permission-code.enum';
import { NfseEmissionStatus } from './nfse-emission.entity';
import type { EmissionView, NfseService } from './nfse.service';

const AUDIT: CommandAuditConfig = { acao: AuditAction.NfseCommand, modulo: AuditModuleName.Nfse };

export const NFSE_USAGE = [
  'Emissao de NFS-e. Envie TODOS os campos em uma mensagem:',
  '/nfse tomador=<CPF ou CNPJ> nome="<nome do tomador>" valor=<valor> servico=<codigo nacional, 6 digitos> desc="<descricao>" iss=<1 ou 4> ret=<1, 2 ou 3> local=<IBGE, 7 digitos>',
  'Opcionais: aliq=<percentual> competencia=<AAAA-MM-DD>. Optante ME/EPP: totsn=<percentual>.',
  'Nada e preenchido por padrao: tributacao e local da prestacao sao decisao sua.',
].join('\n');

const MESSAGES = {
  disabled: 'A emissao de NFS-e esta desligada neste ambiente.',
  misconfigured: 'A NFS-e nao esta configurada corretamente. Procure o administrador do sistema.',
  internal: 'Nao foi possivel preparar o pedido agora. Nada foi emitido. Procure o administrador.',
  badConfirm:
    'Use: /nfse_confirmar <numero do pedido> <codigo>. Exemplo: /nfse_confirmar 12 K7M2QX9P',
  notFound:
    'Pedido nao encontrado, codigo incorreto ou pedido de outro canal. Nada foi emitido. Envie /nfse para criar um novo pedido.',
  expired: 'O codigo venceu. Nada foi emitido. Envie /nfse para criar um novo pedido.',
  throttled: 'Muitas tentativas. Aguarde alguns minutos.',
  badStatus: 'Use: /nfse_status ou /nfse_status <numero do pedido>.',
} as const;

const failure = (reply: string, detail: string): CommandResult =>
  commandFailure(CommandOutcome.MalformedCommand, reply, detail);

/** Texto apos o nome do comando, preservando espacos e aspas (o parser separa por espaco). */
function argumentsOf(text: string): string {
  return text.trim().replace(/^\/\S+\s*/, '');
}

const SITUATION: Record<NfseEmissionStatus, string> = {
  [NfseEmissionStatus.AguardandoConfirmacao]: 'aguardando a sua confirmacao (nada foi emitido)',
  [NfseEmissionStatus.Expirada]: 'expirada (nada foi emitido)',
  [NfseEmissionStatus.Enviando]: 'em processamento',
  [NfseEmissionStatus.Autorizada]: 'EMITIDA',
  [NfseEmissionStatus.Rejeitada]: 'REJEITADA pela Sefin (nada foi emitido)',
  [NfseEmissionStatus.NaoEnviada]: 'NAO ENVIADA (nada foi emitido)',
  [NfseEmissionStatus.Incerta]: 'RESULTADO INCERTO',
};

const INTERNAL_REASONS: Record<string, string> = {
  certificado_indisponivel: 'certificado digital indisponivel',
  certificado_diverge_do_prestador: 'o certificado nao e do prestador configurado',
  configuracao_alterada: 'a configuracao mudou depois do pedido',
  xsd_invalido: 'a DPS gerada nao passou na validacao do leiaute',
  xsd_assinado_invalido: 'a DPS assinada nao passou na validacao do leiaute',
  contrato_nao_confirmado: 'a integracao com a Sefin ainda nao foi liberada para este ambiente',
  sem_conexao: 'sem conexao com a Sefin',
  http_401: 'autenticacao recusada pela Sefin',
  http_403: 'acesso recusado pela Sefin',
  http_429: 'limite de requisicoes da Sefin',
};

function describe(view: EmissionView): string {
  const header = `NFS-e (DPS no ${String(view.numero)}, ${view.ambiente === 'producao' ? 'PRODUCAO' : 'HOMOLOGACAO'}): ${SITUATION[view.status]}`;
  switch (view.status) {
    case NfseEmissionStatus.Autorizada:
      return view.chaveAcesso === null
        ? header
        : `${header}\nChave de acesso: ${view.chaveAcesso}\nO documento (XML e DANFSe) fica guardado com seguranca no sistema; para o PDF use a consulta publica do portal nfse.gov.br com a chave.`;
    case NfseEmissionStatus.Rejeitada:
      return `${header}\nCodigo ${view.erroCodigo ?? '?'}${view.erroMensagem ? `: ${view.erroMensagem}` : ''}\nCorrija o dado e crie um novo pedido com /nfse.`;
    case NfseEmissionStatus.NaoEnviada:
      return `${header}\nMotivo: ${INTERNAL_REASONS[view.erroCodigo ?? ''] ?? 'falha antes do envio'}.`;
    case NfseEmissionStatus.Incerta:
      return `${header}\nNAO sei se a nota foi gerada. NAO crie outro pedido igual: pode duplicar a nota. Consulte de novo em alguns minutos com /nfse_status ${String(view.numero)}; se continuar incerto, confira no portal nfse.gov.br antes de qualquer nova emissao.`;
    case NfseEmissionStatus.Enviando:
      return `${header}\nConsulte com /nfse_status ${String(view.numero)}.`;
    default:
      return header;
  }
}

function detailOf(view: EmissionView): string {
  switch (view.status) {
    case NfseEmissionStatus.Autorizada:
      return 'emitida';
    case NfseEmissionStatus.Rejeitada:
      return 'rejeitada';
    case NfseEmissionStatus.NaoEnviada:
      return 'nao_enviada';
    case NfseEmissionStatus.Incerta:
      return 'incerta';
    default:
      return 'processando';
  }
}

/** `/nfse campo=valor ...`: valida, mostra o resumo fiscal e gera o codigo de confirmacao. NAO emite. */
export class NfseRequestCommandHandler implements CommandHandler {
  readonly name = 'nfse';
  readonly description = 'Pedir a emissao de uma NFS-e (mostra o resumo e pede confirmacao)';
  readonly permission = PermissionCode.NfseEmit;
  readonly audit = AUDIT;

  constructor(private readonly service: NfseService) {}

  async handle(context: CommandContext): Promise<CommandResult> {
    const args = argumentsOf(context.text);
    if (args === '') {
      return commandOk(NFSE_USAGE, 'ajuda');
    }
    const result = await this.service.request(context.user.id, context.channel, args);
    switch (result.kind) {
      case 'disabled':
        return failure(MESSAGES.disabled, 'desligado');
      case 'misconfigured':
        return failure(MESSAGES.misconfigured, 'nao_configurado');
      case 'internal':
        return commandFailure(CommandOutcome.HandlerError, MESSAGES.internal, 'erro_interno');
      case 'invalid':
        return failure(
          `Nao consegui montar o pedido:\n${result.errors.map((error) => `- ${error}`).join('\n')}\n\n${NFSE_USAGE}`,
          'pedido_invalido',
        );
      case 'created':
        return commandOk(
          [
            result.summary,
            '',
            'CONFIRA os dados. Para EMITIR, envie exatamente:',
            `/nfse_confirmar ${String(result.numero)} ${result.code}`,
            `O codigo vale so para este pedido, nesta conversa, por ${String(result.expiresInMinutes)} minutos, e so uma vez. Um novo /nfse cancela este pedido.`,
            'Depois de emitida, a NFS-e so se cancela pelo portal nfse.gov.br.',
          ].join('\n'),
          'pedido_criado',
        );
    }
  }
}

/** `/nfse_confirmar <numero> <codigo>`: consome a confirmacao (uma vez) e transmite. */
export class NfseConfirmCommandHandler implements CommandHandler {
  readonly name = 'nfse_confirmar';
  readonly description = 'Confirmar e emitir o pedido de NFS-e (numero e codigo recebidos)';
  readonly permission = PermissionCode.NfseEmit;
  readonly audit = AUDIT;

  constructor(private readonly service: NfseService) {}

  async handle(context: CommandContext): Promise<CommandResult> {
    const parts = argumentsOf(context.text)
      .split(/\s+/)
      .filter((part) => part !== '');
    const [numero, code] = parts;
    if (parts.length !== 2 || numero === undefined || code === undefined) {
      return failure(MESSAGES.badConfirm, 'formato_invalido');
    }
    const result = await this.service.confirm(context.user.id, context.channel, numero, code);
    switch (result.kind) {
      case 'disabled':
        return failure(MESSAGES.disabled, 'desligado');
      case 'misconfigured':
        return failure(MESSAGES.misconfigured, 'nao_configurado');
      case 'bad_format':
        return failure(MESSAGES.badConfirm, 'formato_invalido');
      case 'throttled':
        return failure(MESSAGES.throttled, 'limite_tentativas');
      case 'not_found':
        return failure(MESSAGES.notFound, 'nao_encontrado');
      case 'expired':
        return failure(MESSAGES.expired, 'expirado');
      case 'already_used':
        return failure(
          `Este pedido ja foi confirmado (${SITUATION[result.status]}). Nao vou enviar de novo. Veja /nfse_status ${numero}.`,
          'ja_usado',
        );
      case 'processing':
        return commandOk(
          `Pedido ${String(result.numero)} enviado; a Sefin ainda esta processando. Consulte com /nfse_status ${String(result.numero)}. NAO envie de novo.`,
          'processando',
        );
      case 'finished': {
        const reply = describe(result.emission);
        return result.emission.status === NfseEmissionStatus.Autorizada
          ? commandOk(reply, detailOf(result.emission))
          : commandFailure(CommandOutcome.HandlerError, reply, detailOf(result.emission));
      }
    }
  }
}

/** `/nfse_status [numero]`: situacao dos seus pedidos; reconcilia por CONSULTA os de resultado incerto. */
export class NfseStatusCommandHandler implements CommandHandler {
  readonly name = 'nfse_status';
  readonly description = 'Situacao das suas NFS-e (use /nfse_status <numero> para uma especifica)';
  readonly permission = PermissionCode.NfseRead;
  readonly audit = AUDIT;

  constructor(private readonly service: NfseService) {}

  async handle(context: CommandContext): Promise<CommandResult> {
    const ref = argumentsOf(context.text).split(/\s+/)[0] || undefined;
    const result = await this.service.status(context.user.id, ref);
    switch (result.kind) {
      case 'disabled':
        return failure(MESSAGES.disabled, 'desligado');
      case 'misconfigured':
        return failure(MESSAGES.misconfigured, 'nao_configurado');
      case 'bad_format':
        return failure(MESSAGES.badStatus, 'formato_invalido');
      case 'list':
        return commandOk(
          result.items.length === 0
            ? 'Nenhuma NFS-e sua encontrada.'
            : result.items.map(describe).join('\n\n'),
          'consulta',
        );
    }
  }
}
