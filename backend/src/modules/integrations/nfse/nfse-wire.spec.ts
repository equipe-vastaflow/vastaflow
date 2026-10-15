import { gzipSync } from 'node:zlib';
import {
  decodeGzipBase64,
  encodeEmissionBody,
  interpretDpsLookup,
  interpretEmissionResponse,
  interpretNfseFetch,
} from './nfse-wire';

const CHAVE = '31062002211222333000181000000000000726101234567890'.slice(0, 50);
const nfseXml = (chave: string): string =>
  `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS${chave}"></infNFSe></NFSe>`;
const b64 = (text: string): string => gzipSync(Buffer.from(text, 'utf8')).toString('base64');

const okBody = (chave = CHAVE, xml = nfseXml(chave)): string =>
  JSON.stringify({ chaveAcesso: chave, nfseXmlGZipB64: b64(xml) });

describe('NFS-e - troca com a Sefin (contrato de transporte)', () => {
  it('codifica a DPS assinada como gzip + base 64 num JSON', () => {
    const body = JSON.parse(encodeEmissionBody('<DPS>ç</DPS>')) as { dpsXmlGZipB64: string };
    expect(decodeGzipBase64(body.dpsXmlGZipB64)).toBe('<DPS>ç</DPS>');
  });

  it('decodifica so base 64 + gzip validos e limitados', () => {
    expect(decodeGzipBase64('nao e base64!')).toBeNull();
    expect(decodeGzipBase64(Buffer.from('texto puro').toString('base64'))).toBeNull();
    expect(decodeGzipBase64(undefined)).toBeNull();
    // Bomba de descompressao: passa do limite de saida e e recusada.
    expect(decodeGzipBase64(gzipSync(Buffer.alloc(3 * 1024 * 1024)).toString('base64'))).toBeNull();
  });

  describe('POST /nfse', () => {
    it('sucesso completo (chave de 50 digitos + XML que a cita) = AUTORIZADA', () => {
      expect(interpretEmissionResponse(201, okBody())).toEqual({
        kind: 'authorized',
        chave: CHAVE,
        nfseXml: nfseXml(CHAVE),
      });
      expect(interpretEmissionResponse(200, okBody()).kind).toBe('authorized');
    });

    it('sucesso INCOMPLETO nunca vira autorizada: e incerto', () => {
      const cases = [
        '{}',
        'nao e json',
        JSON.stringify({ chaveAcesso: CHAVE }),
        JSON.stringify({ chaveAcesso: '123', nfseXmlGZipB64: b64(nfseXml('123')) }),
        okBody(CHAVE, nfseXml('9'.repeat(50))),
        JSON.stringify({ chaveAcesso: CHAVE, nfseXmlGZipB64: 'AAAA' }),
      ];
      for (const body of cases) {
        expect(interpretEmissionResponse(201, body).kind).toBe('uncertain');
      }
    });

    it('rejeicao so com codigo oficial E#### = REJEITADA (a nota nao foi gerada)', () => {
      const body = JSON.stringify({
        erro: [{ codigo: 'E0310', descricao: 'Codigo de tributacao inexistente' }],
      });
      expect(interpretEmissionResponse(400, body)).toEqual({
        kind: 'rejected',
        code: 'E0310',
        message: 'Codigo de tributacao inexistente',
      });
      expect(
        interpretEmissionResponse(
          422,
          JSON.stringify({ erros: [{ codigo: 'E0160', mensagem: 'x' }] }),
        ).kind,
      ).toBe('rejected');
    });

    it('recusa SEM codigo oficial reconhecivel e incerta (nao se conclui "nao emitida")', () => {
      expect(interpretEmissionResponse(400, '{"erro":"qualquer"}').kind).toBe('uncertain');
      expect(
        interpretEmissionResponse(
          400,
          JSON.stringify({ erro: [{ codigo: 'XYZ', descricao: 'a' }] }),
        ).kind,
      ).toBe('uncertain');
      expect(interpretEmissionResponse(400, '<html>gateway</html>').kind).toBe('uncertain');
    });

    it('falha do servidor, redirecionamento e status desconhecido = INCERTA', () => {
      for (const status of [500, 502, 503, 504, 301, 302, 204, 418, 0]) {
        expect(interpretEmissionResponse(status, '').kind).toBe('uncertain');
      }
    });

    it('barrada na borda (401, 403, 429) sem documento = nao enviada; com documento = incerta', () => {
      for (const status of [401, 403, 429]) {
        expect(interpretEmissionResponse(status, '{}').kind).toBe('not_sent');
        expect(interpretEmissionResponse(status, JSON.stringify({ chaveAcesso: CHAVE })).kind).toBe(
          'uncertain',
        );
      }
    });
  });

  describe('consultas (somente leitura)', () => {
    it('GET /dps/{id}: encontrada, nao encontrada e desconhecida', () => {
      expect(interpretDpsLookup(200, JSON.stringify({ chaveAcesso: CHAVE }))).toEqual({
        kind: 'found',
        chave: CHAVE,
      });
      expect(interpretDpsLookup(200, '{}')).toEqual({ kind: 'unknown' });
      expect(interpretDpsLookup(404, '')).toEqual({ kind: 'not_found' });
      expect(interpretDpsLookup(500, '')).toEqual({ kind: 'unknown' });
    });

    it('GET /nfse/{chave}: so aceita XML que cita a chave pedida', () => {
      expect(interpretNfseFetch(200, okBody(), CHAVE)).toEqual({
        kind: 'ok',
        nfseXml: nfseXml(CHAVE),
      });
      expect(interpretNfseFetch(200, okBody(), '1'.repeat(50))).toEqual({ kind: 'unknown' });
      expect(interpretNfseFetch(404, '', CHAVE)).toEqual({ kind: 'unknown' });
    });
  });
});
