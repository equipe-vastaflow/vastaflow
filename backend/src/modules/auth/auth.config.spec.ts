import { parseDurationToSeconds } from './auth.config';

describe('parseDurationToSeconds', () => {
  it.each([
    ['30s', 30],
    ['15m', 900],
    ['1h', 3600],
    ['7d', 604800],
  ])('converte %s em %i segundos', (input, expected) => {
    expect(parseDurationToSeconds(input)).toBe(expected);
  });

  it.each(['', '1', 'h', '1w', '-5m', '1.5h', 'uma hora'])('rejeita %j', (input) => {
    expect(() => parseDurationToSeconds(input)).toThrow(/Duracao invalida/);
  });
});
