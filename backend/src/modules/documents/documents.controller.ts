import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ClientIp } from '../../common/decorators/client-ip.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { PermissionCode } from '../permissions/permission-code.enum';
import { contentDispositionFor } from './content-disposition';
import { ALLOWED_EXTENSIONS, type UploadedFileLike } from './document-file.policy';
import { DocumentsService } from './documents.service';
import { decodeMultipartFilename } from './multipart-filename';
import { DocumentPageResponseDto } from './dto/document-page-response.dto';
import { DEFAULT_PAGE_SIZE, ListDocumentsQuery } from './dto/list-documents.query';
import { DocumentResponseDto, toDocumentResponse } from './dto/document-response.dto';

/** Campo do multipart que carrega o arquivo. */
const FILE_FIELD = 'arquivo';

/**
 * Documentos armazenados pelo sistema.
 *
 * Nenhuma rota e publica: todas exigem JWT (guard global) e uma permissao
 * granular. Esta fase tem apenas enviar, listar e baixar - nao ha renomear,
 * excluir, versionar nem compartilhar.
 *
 * O autor do envio vem sempre do usuario autenticado; nenhum identificador de
 * usuario e aceito no corpo, e a chave fisica nunca e aceita nem devolvida.
 */
@ApiTags('Documents')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Token ausente, invalido ou expirado' })
@ApiForbiddenResponse({ description: 'Perfil sem a permissao necessaria' })
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @RequirePermissions(PermissionCode.DocumentsCreate)
  // O limite de tamanho vem do `MulterModule`, configurado com
  // `DOCUMENT_MAX_FILE_SIZE` no modulo - nao e fixado aqui.
  @UseInterceptors(FileInterceptor(FILE_FIELD))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: `Arquivo no campo \`${FILE_FIELD}\`. Extensoes aceitas: ${ALLOWED_EXTENSIONS.join(', ')}.`,
    schema: {
      type: 'object',
      required: [FILE_FIELD],
      properties: { [FILE_FIELD]: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Envia um documento',
    description:
      'Exige `documents:create`. Recebe `multipart/form-data`. O nome enviado e preservado como ' +
      'metadado, mas NAO define o caminho fisico: a chave de armazenamento e gerada pelo ' +
      'servidor e nunca aparece na resposta. O tipo e validado pela extensao e pela coerencia ' +
      'com o `Content-Type` declarado.',
  })
  @ApiCreatedResponse({ type: DocumentResponseDto })
  @ApiBadRequestResponse({
    description: 'Arquivo ausente, vazio, nome invalido, extensao nao permitida ou MIME incoerente',
  })
  @ApiPayloadTooLargeResponse({ description: 'Arquivo acima do limite configurado' })
  async upload(
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFile() file: UploadedFileLike | undefined,
    @ClientIp() ip: string | null,
  ): Promise<DocumentResponseDto> {
    // O nome do arquivo e corrigido AQUI, na borda: o `busboy` o decodifica
    // como latin1 e todo acento chega corrompido. E peculiaridade do transporte
    // multipart, nao regra de documento - por isso nao fica no service.
    const corrigido =
      file === undefined
        ? undefined
        : { ...file, originalname: decodeMultipartFilename(file.originalname) };

    const { document, autor } = await this.documentsService.create(actor, corrigido, ip);
    return toDocumentResponse(document, autor);
  }

  @Get()
  @RequirePermissions(PermissionCode.DocumentsRead)
  @ApiOperation({
    summary: 'Lista os documentos, paginado',
    description:
      'Exige `documents:read`. Ordenado pela data de envio, decrescente; o id desempata. ' +
      'Devolve apenas metadados - nunca o conteudo nem a chave de armazenamento.',
  })
  @ApiOkResponse({ type: DocumentPageResponseDto })
  @ApiBadRequestResponse({ description: 'Parametros de paginacao invalidos' })
  async findPage(@Query() query: ListDocumentsQuery): Promise<DocumentPageResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const { items, total } = await this.documentsService.list(page, limit);

    return {
      items: items.map(({ document, autor }) => toDocumentResponse(document, autor)),
      total,
      page,
      limit,
    };
  }

  @Get(':id/download')
  @RequirePermissions(PermissionCode.DocumentsRead)
  @ApiOperation({
    summary: 'Baixa o conteudo de um documento',
    description:
      'Exige `documents:read`. Responde sempre como ANEXO, com `X-Content-Type-Options: ' +
      'nosniff` - o conteudo nunca e renderizado pelo navegador. O arquivo e transmitido em ' +
      'streaming, sem ser carregado inteiro na memoria. Registra `DOCUMENT_DOWNLOADED`.',
  })
  @ApiProduces('application/octet-stream')
  @ApiOkResponse({
    description: 'Conteudo do documento como anexo',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiBadRequestResponse({ description: 'Id nao e um UUID' })
  @ApiNotFoundResponse({ description: 'Documento nao encontrado' })
  @ApiInternalServerErrorResponse({
    description: 'O registro existe mas o conteudo nao esta no storage',
  })
  async download(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientIp() ip: string | null,
    @Res() response: Response,
  ): Promise<void> {
    // O service resolve e abre o objeto ANTES de qualquer cabecalho ser
    // escrito: assim 404 e 500 saem como JSON de erro pelo filtro global, em
    // vez de no meio de um arquivo ja comecado.
    const { document, object } = await this.documentsService.download(actor, id, ip);

    response.setHeader('Content-Type', document.mimeType);
    // Impede o navegador de ignorar o Content-Type e adivinhar pelo conteudo.
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // Nome saneado contra injecao de cabecalho; ver `content-disposition.ts`.
    response.setHeader('Content-Disposition', contentDispositionFor(document.nomeOriginal));
    // O tamanho vem do storage, nao do banco: e o do objeto que esta sendo
    // enviado agora.
    response.setHeader('Content-Length', String(object.size));

    object.stream.pipe(response);
  }
}
