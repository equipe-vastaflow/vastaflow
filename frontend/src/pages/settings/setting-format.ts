import type { SettingValue, SystemSettingType } from '../../api/client';

/** Nome do tipo na tela. */
export const TYPE_LABELS: Record<SystemSettingType, string> = {
  STRING: 'Texto',
  NUMBER: 'Número',
  BOOLEAN: 'Booleano',
};

/** Valor como texto de leitura. O booleano vira Sim/Não; o resto vai como esta. */
export function formatSettingValue(valor: SettingValue): string {
  if (typeof valor === 'boolean') {
    return valor ? 'Sim' : 'Não';
  }
  return String(valor);
}

/**
 * Converte o texto digitado num numero, ou `null` quando nao e um numero valido.
 *
 * Aceita virgula como separador decimal, porque e o que se digita em pt-BR.
 * `null` significa "nao envie" - o backend tambem recusaria, mas avisar antes
 * evita uma ida a rede so para receber 400.
 */
export function parseNumberInput(texto: string): number | null {
  const limpo = texto.trim().replace(',', '.');
  if (limpo === '') {
    return null;
  }
  const numero = Number(limpo);
  return Number.isFinite(numero) ? numero : null;
}
