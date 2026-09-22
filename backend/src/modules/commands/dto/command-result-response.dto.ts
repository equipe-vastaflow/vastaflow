import { ApiProperty } from '@nestjs/swagger';
import { CommandOutcome, type CommandResult } from '../command.types';

/**
 * Resultado da execucao.
 *
 * A resposta e sempre 200, inclusive quando `success` e `false`: comando
 * inexistente, sem permissao ou que falhou sao desfechos do motor, nao erros
 * de protocolo. Um adaptador de mensageria precisa sempre de um texto para
 * devolver ao usuario. Erros de protocolo de verdade (sem token, corpo
 * invalido) continuam sendo 401/400 como em qualquer outra rota.
 */
export class CommandResultResponseDto {
  @ApiProperty({ description: 'Se o comando foi executado com sucesso', example: true })
  success: boolean;

  @ApiProperty({
    enum: CommandOutcome,
    description: 'Desfecho em formato estavel, para o adaptador reagir sem interpretar o texto.',
    example: CommandOutcome.Ok,
  })
  outcome: CommandOutcome;

  @ApiProperty({
    description: 'Texto a devolver ao usuario. Nunca contem stack trace nem dado sensivel.',
    example: 'Comandos disponiveis:\n/ajuda - Lista os comandos disponiveis',
  })
  reply: string;
}

export function toCommandResultResponse(result: CommandResult): CommandResultResponseDto {
  return { success: result.success, outcome: result.outcome, reply: result.reply };
}
