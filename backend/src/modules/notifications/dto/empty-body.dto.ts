/**
 * Corpo vazio, para as rotas de marcar como lida.
 *
 * Nenhuma delas recebe dado: o que marcar vem da URL e de quem vem do JWT.
 * Declarar o corpo como esta classe sem propriedades faz o `ValidationPipe`
 * global (com `whitelist` e `forbidNonWhitelisted`) RECUSAR com 400 qualquer
 * campo enviado - inclusive uma tentativa de mandar `usuarioId`.
 *
 * Sem ela o corpo seria apenas ignorado. O resultado pratico seria o mesmo
 * (o destinatario nunca sairia do JWT), mas o projeto recusa campo desconhecido
 * em vez de ignora-lo em silencio - ver `app.setup.ts`.
 */
export class EmptyBodyDto {}
