import { Injectable } from '@nestjs/common';
import type { FinancialEntry } from '../../finance/entities/financial-entry.entity';
import { FinanceService } from '../../finance/finance.service';
import { PermissionCode } from '../../permissions/permission-code.enum';
import { commandOk, type CommandHandler, type CommandResult } from '../command.types';

/** Formata um valor em reais, sem depender do fuso ou da localidade do servidor. */
export function formatMoney(valor: number): string {
  return `R$ ${valor.toFixed(2).replace('.', ',')}`;
}

/** `2026-09-23` -> `23/09/2026`. A data ja vem do banco neste formato. */
export function formatDate(data: string): string {
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano}`;
}

function formatEntry(entry: FinancialEntry): string {
  return `- ${formatDate(entry.data)} ${entry.tipo} ${formatMoney(entry.valor)} - ${entry.descricao} (${entry.status})`;
}

/**
 * `/financeiro` - ponto de entrada do dominio financeiro nos canais de
 * mensageria.
 *
 * Nesta primeira versao apenas consulta: devolve quantos lancamentos existem e
 * os mais recentes, com dados REAIS do banco. Sem lancamentos, diz exatamente
 * isso - nao inventa numero nem exemplo.
 *
 * Depende do `FinanceService`, nunca do repositorio, e nao conhece HTTP,
 * Telegram nem WhatsApp: recebe o `CommandContext` que o adaptador montou.
 *
 * Exige `finance:read` - a mesma permissao de quem lista pela API. Quem nao a
 * tem recebe recusa do proprio motor, antes de o handler rodar.
 */
@Injectable()
export class FinanceCommandHandler implements CommandHandler {
  readonly name = 'financeiro';
  readonly description = 'Resumo dos lancamentos financeiros';
  readonly permission = PermissionCode.FinanceRead;

  // Sem `audit`: a auditoria do motor e opt-in e este comando apenas consulta.
  // Nenhuma leitura financeira entra na trilha - nem aqui, nem em
  // `GET /finance/entries`. A trilha registra o que MUDA: criacao, edicao e
  // alteracao de status.

  constructor(private readonly financeService: FinanceService) {}

  async handle(): Promise<CommandResult> {
    const { total, recentes } = await this.financeService.overview();

    if (total === 0) {
      return commandOk(
        [
          'Nenhum lancamento financeiro registrado ainda.',
          'Assim que houver lancamentos, eles aparecem aqui.',
        ].join('\n'),
      );
    }

    return commandOk(
      [
        `Lancamentos registrados: ${total}`,
        '',
        `Mais recentes (${recentes.length}):`,
        ...recentes.map(formatEntry),
      ].join('\n'),
    );
  }
}
