import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document } from './entities/document.entity';

/** Campos que a aplicacao informa ao criar um documento. */
export type NewDocument = Pick<
  Document,
  'nome' | 'nomeOriginal' | 'mimeType' | 'tamanho' | 'storageKey' | 'criadoPorId'
>;

@Injectable()
export class DocumentsRepository {
  constructor(
    @InjectRepository(Document)
    private readonly repository: Repository<Document>,
  ) {}

  findById(id: string): Promise<Document | null> {
    return this.repository.findOne({ where: { id } });
  }

  /**
   * Pagina de documentos, do mais recente para o mais antigo.
   *
   * O `id` desempata: varios documentos podem ser enviados no mesmo instante e,
   * sem criterio estavel, o mesmo registro poderia aparecer em duas paginas - ou
   * em nenhuma. Mesmo cuidado ja aplicado no financeiro e na auditoria.
   */
  findPage(skip: number, take: number): Promise<[Document[], number]> {
    return this.repository.findAndCount({
      order: { createdAt: 'DESC', id: 'DESC' },
      skip,
      take,
    });
  }

  create(data: NewDocument): Promise<Document> {
    return this.repository.save(this.repository.create(data));
  }
}
