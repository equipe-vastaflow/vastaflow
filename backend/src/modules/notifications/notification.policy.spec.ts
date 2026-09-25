import { MESSAGE_MAX_LENGTH, TITLE_MAX_LENGTH } from './entities/notification.entity';
import { NotificationType } from './notification.enums';
import { validateNotification, type NewNotificationInput } from './notification.policy';

const VALIDO: NewNotificationInput = {
  usuarioId: 'user-1',
  titulo: 'Lancamento aprovado',
  mensagem: 'O lancamento de manutencao foi marcado como pago.',
  tipo: NotificationType.Success,
};

function recusa(overrides: Partial<NewNotificationInput>): string {
  const resultado = validateNotification({ ...VALIDO, ...overrides });
  if (resultado.ok) {
    throw new Error(`esperava recusa, mas o conteudo foi aceito: ${JSON.stringify(overrides)}`);
  }
  return resultado.erro;
}

describe('validateNotification', () => {
  it('aceita um conteudo completo e devolve os campos normalizados', () => {
    expect(validateNotification(VALIDO)).toEqual({ ok: true, value: VALIDO });
  });

  it('remove espacos nas pontas de todos os textos', () => {
    const resultado = validateNotification({
      ...VALIDO,
      usuarioId: '  user-1  ',
      titulo: '  Titulo  ',
      mensagem: '  Mensagem  ',
    });

    expect(resultado).toEqual({
      ok: true,
      value: { ...VALIDO, usuarioId: 'user-1', titulo: 'Titulo', mensagem: 'Mensagem' },
    });
  });

  describe('destinatario', () => {
    it.each([
      ['vazio', ''],
      ['so espacos', '   '],
    ])('recusa usuarioId %s', (_nome, usuarioId) => {
      expect(recusa({ usuarioId })).toContain('usuarioId');
    });
  });

  describe('titulo', () => {
    it.each([
      ['vazio', ''],
      ['so espacos', '   '],
    ])('recusa titulo %s', (_nome, titulo) => {
      expect(recusa({ titulo })).toContain('titulo e obrigatorio');
    });

    it(`aceita exatamente ${TITLE_MAX_LENGTH} caracteres e recusa um a mais`, () => {
      expect(validateNotification({ ...VALIDO, titulo: 'a'.repeat(TITLE_MAX_LENGTH) }).ok).toBe(
        true,
      );
      expect(recusa({ titulo: 'a'.repeat(TITLE_MAX_LENGTH + 1) })).toContain('no maximo');
    });
  });

  describe('mensagem', () => {
    it.each([
      ['vazia', ''],
      ['so espacos', '   '],
    ])('recusa mensagem %s', (_nome, mensagem) => {
      expect(recusa({ mensagem })).toContain('mensagem e obrigatoria');
    });

    it(`aceita exatamente ${MESSAGE_MAX_LENGTH} caracteres e recusa um a mais`, () => {
      expect(validateNotification({ ...VALIDO, mensagem: 'a'.repeat(MESSAGE_MAX_LENGTH) }).ok).toBe(
        true,
      );
      expect(recusa({ mensagem: 'a'.repeat(MESSAGE_MAX_LENGTH + 1) })).toContain('no maximo');
    });
  });

  describe('tipo', () => {
    it.each(Object.values(NotificationType))('aceita %s', (tipo) => {
      expect(validateNotification({ ...VALIDO, tipo }).ok).toBe(true);
    });

    it.each([
      ['valor fora do enum', 'URGENTE'],
      ['minusculo', 'info'],
      ['vazio', ''],
    ])('recusa %s', (_nome, tipo) => {
      expect(recusa({ tipo: tipo as NotificationType })).toContain('tipo deve ser um destes');
    });

    it('a mensagem lista os tipos aceitos', () => {
      expect(recusa({ tipo: 'URGENTE' as NotificationType })).toBe(
        'tipo deve ser um destes valores: INFO, SUCCESS, WARNING, ERROR',
      );
    });
  });

  it('os limites batem com as colunas da tabela', () => {
    // Se a coluna encolher sem o validador acompanhar, o texto so falharia no
    // banco - tarde demais. Este teste liga os dois.
    expect(TITLE_MAX_LENGTH).toBe(120);
    expect(MESSAGE_MAX_LENGTH).toBe(500);
  });
});
