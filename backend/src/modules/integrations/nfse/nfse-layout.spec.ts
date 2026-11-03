import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getLayout,
  layoutForAmbiente,
  NFSE_LAYOUT_BY_AMBIENTE,
  NFSE_LAYOUTS,
  type NfseLayoutId,
} from './nfse-layout';
import { validateDpsXml } from './nfse-xsd.validator';

const read = (...partes: string[]): string => readFileSync(join(__dirname, ...partes), 'utf8');
const semComentarios = (codigo: string): string =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('NFS-e - selecao de leiaute por ambiente', () => {
  it('producao usa o leiaute de producao e restrita usa o da restrita', () => {
    expect(layoutForAmbiente('producao').id).toBe('producao-2026-02');
    expect(layoutForAmbiente('producao').pasta).toBe('producao-2026-02-09');
    expect(layoutForAmbiente('restrita').id).toBe('restrita-2026-10');
    expect(layoutForAmbiente('restrita').pasta).toBe('restrita-2026-10-20');
  });

  it('cada leiaute pertence ao ambiente que o seleciona (a tabela nao cruza)', () => {
    for (const ambiente of ['producao', 'restrita'] as const) {
      expect(NFSE_LAYOUTS[NFSE_LAYOUT_BY_AMBIENTE[ambiente]].ambiente).toBe(ambiente);
    }
    expect(Object.keys(NFSE_LAYOUT_BY_AMBIENTE).sort()).toEqual(['producao', 'restrita']);
  });

  it('os dois leiautes declaram a MESMA versao: o atributo versao nao distingue os pacotes', () => {
    const versoes = new Set(Object.values(NFSE_LAYOUTS).map((layout) => layout.versaoDocumento));
    expect([...versoes]).toEqual(['1.01']);
    expect(NFSE_LAYOUTS['producao-2026-02'].pasta).not.toBe(NFSE_LAYOUTS['restrita-2026-10'].pasta);
  });

  it('registro e tabela sao imutaveis: nada troca o leiaute da producao em tempo de execucao', () => {
    expect(Object.isFrozen(NFSE_LAYOUTS)).toBe(true);
    expect(Object.isFrozen(NFSE_LAYOUT_BY_AMBIENTE)).toBe(true);
    for (const layout of Object.values(NFSE_LAYOUTS)) {
      expect(Object.isFrozen(layout)).toBe(true);
    }
    expect(() => {
      (NFSE_LAYOUT_BY_AMBIENTE as Record<string, string>).producao = 'restrita-2026-10';
    }).toThrow(TypeError);
    expect(layoutForAmbiente('producao').id).toBe('producao-2026-02');
  });

  it.each([
    '',
    'producao',
    'restrita',
    'restrita-2026-10 ',
    '__proto__',
    'constructor',
    'toString',
  ])('identificador desconhecido (%j) e recusado', (id) => {
    expect(() => getLayout(id)).toThrow('Leiaute da NFS-e desconhecido');
  });

  it('o validador recusa um leiaute desconhecido em vez de usar um pacote qualquer', async () => {
    await expect(validateDpsXml('<DPS/>', 'inexistente' as NfseLayoutId)).rejects.toThrow(
      'Leiaute da NFS-e desconhecido',
    );
  });
});

describe('NFS-e - a escolha do leiaute nao pode ser acidental', () => {
  it('o servico so obtem o leiaute pelo ambiente configurado (nenhum identificador fixo no codigo)', () => {
    const servico = semComentarios(read('nfse.service.ts'));
    const chamadas = servico.match(/validateDpsXml\(/g) ?? [];
    expect(chamadas.length).toBeGreaterThanOrEqual(3);
    // Toda validacao usa a variavel derivada de `layoutForAmbiente(settings.ambiente)`.
    expect(servico.match(/layoutForAmbiente\(settings\.ambiente\)\.id/g)?.length).toBe(2);
    expect(servico).not.toMatch(/producao-2026-02|restrita-2026-10/);
    expect(servico).not.toMatch(/validateDpsXml\([^)]*['"]/);
  });

  it('nao existe variavel de ambiente, argumento ou configuracao que escolha o leiaute', () => {
    for (const arquivo of ['nfse-settings.ts', 'nfse-layout.ts', 'nfse-xsd.validator.ts']) {
      const codigo = semComentarios(read(arquivo));
      expect(codigo).not.toMatch(/process\.env/);
      // Nenhuma chave de configuracao NFSE_LAYOUT* (o identificador NFSE_LAYOUTS do registro nao e chave).
      expect(codigo).not.toMatch(/['"]NFSE_LAYOUT/);
    }
    const raiz = join(__dirname, '..', '..', '..', '..', '..');
    for (const arquivo of ['docker-compose.production.yml', '.env.example']) {
      expect(readFileSync(join(raiz, arquivo), 'utf8')).not.toMatch(/NFSE_LAYOUT/i);
    }
    expect(readFileSync(join(raiz, 'backend/src/config/env.validation.ts'), 'utf8')).not.toMatch(
      /NFSE_LAYOUT/i,
    );
  });

  it('o validador exige o leiaute: nao ha pacote padrao', () => {
    const validador = semComentarios(read('nfse-xsd.validator.ts'));
    expect(validador).toMatch(/validateDpsXml\(xml: string, layout: NfseLayoutId\)/);
    expect(validador).not.toMatch(/layout\s*[:=]\s*['"]/);
    expect(validador).not.toMatch(/layout\??:\s*NfseLayoutId\s*=/);
  });
});
