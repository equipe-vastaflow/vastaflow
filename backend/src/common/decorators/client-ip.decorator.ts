import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

const IPV4_MAPPED_PREFIX = '::ffff:';

/**
 * IP do cliente, ou `null` quando indisponivel.
 *
 * Atras de proxy reverso/load balancer, `request.ip` so devolve o IP real se o
 * Express estiver configurado com `trust proxy`; caso contrario aparece o IP do
 * proxy.
 */
export const ClientIp = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | null => {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = request.ip ?? request.socket.remoteAddress;
    if (!ip) {
      return null;
    }
    // O Node representa IPv4 em socket dual-stack como `::ffff:1.2.3.4`.
    return ip.startsWith(IPV4_MAPPED_PREFIX) ? ip.slice(IPV4_MAPPED_PREFIX.length) : ip;
  },
);
