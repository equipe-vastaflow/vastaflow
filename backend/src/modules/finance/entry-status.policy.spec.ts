import {
  allowedTransitionsFrom,
  canTransition,
  immutableFieldsFor,
  isFrozen,
  rejectedEdits,
} from './entry-status.policy';
import { FinancialEntryStatus } from './financial-entry.enums';

const { Pendente, Pago, Cancelado } = FinancialEntryStatus;

describe('entry-status.policy', () => {
  describe('transicoes permitidas', () => {
    it.each([
      [Pendente, Pago],
      [Pendente, Cancelado],
      [Pago, Cancelado],
    ])('%s -> %s', (de, para) => {
      expect(canTransition(de, para)).toBe(true);
    });
  });

  describe('transicoes recusadas', () => {
    it('PAGO -> PENDENTE: "despagar" apagaria o fato de que foi pago', () => {
      expect(canTransition(Pago, Pendente)).toBe(false);
    });

    it.each([
      [Cancelado, Pendente],
      [Cancelado, Pago],
    ])('CANCELADO e terminal: %s -> %s', (de, para) => {
      expect(canTransition(de, para)).toBe(false);
    });

    it.each([
      [Pendente, Pendente],
      [Pago, Pago],
      [Cancelado, Cancelado],
    ])('repetir o proprio status nao e transicao (%s)', (de, para) => {
      expect(canTransition(de, para)).toBe(false);
    });
  });

  describe('campos congelados por status', () => {
    it('PENDENTE: nada congelado - ainda e uma previsao', () => {
      expect(immutableFieldsFor(Pendente)).toEqual([]);
      expect(isFrozen(Pendente)).toBe(false);
      expect(rejectedEdits(Pendente, ['valor', 'data', 'descricao'])).toEqual([]);
    });

    it('PAGO: tipo, valor e data viram fato consumado', () => {
      expect(immutableFieldsFor(Pago)).toEqual(['tipo', 'valor', 'data']);
      expect(rejectedEdits(Pago, ['valor'])).toEqual(['valor']);
      expect(rejectedEdits(Pago, ['data'])).toEqual(['data']);
      expect(rejectedEdits(Pago, ['tipo'])).toEqual(['tipo']);
      expect(rejectedEdits(Pago, ['tipo', 'valor', 'data'])).toEqual(['tipo', 'valor', 'data']);
    });

    it('PAGO: trocar o tipo inverteria o sinal de um pagamento ja ocorrido', () => {
      // RECEITA <-> DESPESA nao e correcao de texto: viraria uma saida de caixa
      // em entrada sem que nada tivesse acontecido de fato.
      expect(immutableFieldsFor(Pago)).toContain('tipo');
      expect(rejectedEdits(Pago, ['tipo', 'descricao'])).toEqual(['tipo']);
    });

    it('PAGO: campos descritivos continuam editaveis', () => {
      expect(rejectedEdits(Pago, ['descricao', 'categoria', 'observacao'])).toEqual([]);
      expect(isFrozen(Pago)).toBe(false);
    });

    it('PAGO: recusa apenas os campos congelados de um lote misto', () => {
      expect(rejectedEdits(Pago, ['descricao', 'valor'])).toEqual(['valor']);
    });

    it('CANCELADO: estado terminal tambem para a edicao - nada muda', () => {
      expect(isFrozen(Cancelado)).toBe(true);
      expect(rejectedEdits(Cancelado, ['descricao'])).toEqual(['descricao']);
      expect(rejectedEdits(Cancelado, ['valor', 'data'])).toEqual(['valor', 'data']);
      expect(rejectedEdits(Cancelado, ['tipo', 'categoria', 'observacao'])).toEqual([
        'tipo',
        'categoria',
        'observacao',
      ]);
    });

    it('campo desconhecido nunca e reportado como recusado', () => {
      // O ValidationPipe ja rejeita campo fora do DTO; a policy so opina sobre
      // os campos que conhece.
      expect(rejectedEdits(Cancelado, ['inexistente'])).toEqual([]);
    });

    it('cobre todos os status do enum - status novo nao fica sem regra', () => {
      for (const status of Object.values(FinancialEntryStatus)) {
        expect(Array.isArray(immutableFieldsFor(status))).toBe(true);
      }
    });
  });

  describe('allowedTransitionsFrom', () => {
    it('lista os destinos validos de cada status', () => {
      expect(allowedTransitionsFrom(Pendente)).toEqual([Pago, Cancelado]);
      expect(allowedTransitionsFrom(Pago)).toEqual([Cancelado]);
      expect(allowedTransitionsFrom(Cancelado)).toEqual([]);
    });

    it('cobre todos os status do enum - status novo nao fica sem regra', () => {
      for (const status of Object.values(FinancialEntryStatus)) {
        expect(Array.isArray(allowedTransitionsFrom(status))).toBe(true);
      }
    });
  });
});
