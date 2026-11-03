import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { EnvironmentVariables } from '../../config/env.validation';
import { AuditAction, AuditModuleName } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { RoleName } from '../roles/role-name.enum';
import type { ChangePasswordDto } from '../users/dto/change-password.dto';
import { toUserResponse } from '../users/dto/user-response.dto';
import type { User } from '../users/entities/user.entity';
import { PasswordService } from '../users/password.service';
import { UsersService } from '../users/users.service';
import { parseDurationToSeconds } from './auth.config';
import type { AuthenticatedUser, JwtPayload } from './auth.types';
import type { AuthResponseDto } from './dto/auth-response.dto';
import type { LoginDto } from './dto/login.dto';
import { passwordVersion } from './password-version';
import type { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private readonly expiresIn: number;

  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.expiresIn = parseDurationToSeconds(config.get('JWT_EXPIRES_IN', { infer: true }));
  }

  /**
   * Cadastro publico: sempre cria um USUARIO, nunca um perfil elevado.
   *
   * @throws ConflictException quando o e-mail ja esta cadastrado.
   */
  async register(dto: RegisterDto, ip: string | null): Promise<AuthResponseDto> {
    const user = await this.usersService.create({
      nome: dto.nome,
      email: dto.email,
      senha: dto.senha,
      role: RoleName.Usuario,
    });

    await this.auditService.record({
      usuarioId: user.id,
      acao: AuditAction.Register,
      modulo: AuditModuleName.Auth,
      descricao: `Cadastro do usuario ${user.email}`,
      ip,
    });

    return this.buildAuthResponse(user);
  }

  /**
   * @throws UnauthorizedException e-mail inexistente ou senha incorreta (mesma
   *   resposta para os dois, para nao revelar quais e-mails existem).
   * @throws ForbiddenException credenciais corretas, mas usuario inativo.
   */
  async login(dto: LoginDto, ip: string | null): Promise<AuthResponseDto> {
    const user = await this.usersService.findByEmail(dto.email);

    // A senha e conferida mesmo quando o usuario nao existe (ver
    // PasswordService.verify), mantendo o tempo de resposta equivalente.
    const passwordMatches = await this.passwordService.verify(dto.senha, user?.senhaHash);

    if (!user || !passwordMatches) {
      await this.auditService.record({
        usuarioId: user?.id,
        acao: AuditAction.LoginFailed,
        modulo: AuditModuleName.Auth,
        descricao: `Login recusado: credenciais invalidas (${dto.email})`,
        ip,
        metadados: { motivo: 'CREDENCIAIS_INVALIDAS' },
      });
      throw new UnauthorizedException('Credenciais invalidas');
    }

    // A checagem de status vem depois da senha: quem nao sabe a senha nao
    // consegue descobrir se a conta esta inativa.
    if (!user.ativo) {
      await this.auditService.record({
        usuarioId: user.id,
        acao: AuditAction.LoginFailed,
        modulo: AuditModuleName.Auth,
        descricao: `Login recusado: usuario inativo (${user.email})`,
        ip,
        metadados: { motivo: 'USUARIO_INATIVO' },
      });
      throw new ForbiddenException('Usuario inativo');
    }

    await this.auditService.record({
      usuarioId: user.id,
      acao: AuditAction.Login,
      modulo: AuditModuleName.Auth,
      descricao: `Login realizado por ${user.email}`,
      ip,
    });

    return this.buildAuthResponse(user);
  }

  /**
   * O JWT e stateless, entao o servidor nao tem como invalida-lo: o logout
   * registra a auditoria e o cliente descarta o token, que segue valido ate
   * expirar. Revogacao imediata exigiria uma lista de tokens revogados.
   */
  async logout(user: AuthenticatedUser, ip: string | null): Promise<void> {
    await this.auditService.record({
      usuarioId: user.id,
      acao: AuditAction.Logout,
      modulo: AuditModuleName.Auth,
      descricao: `Logout de ${user.email}`,
      ip,
    });
  }

  /**
   * Troca da PROPRIA senha. O alvo e sempre `actor` (vem do JWT): nao ha parametro de usuario.
   *
   * Exige a senha atual, aplica a politica de senha (no DTO) e recusa reaproveitar a senha atual. A
   * gravacao so vale se o hash ainda for o que foi verificado (duas trocas simultaneas: so uma passa).
   * Depois da troca os tokens emitidos ANTES deixam de valer (o `pv` deles nao confere mais com o hash
   * novo - ver `JwtAuthGuard`); por isso devolve um token NOVO para a sessao de quem trocou.
   *
   * A senha atual errada responde 400, nunca 401: o frontend trata 401 como sessao expirada e deslogaria.
   * Nenhuma senha nem hash vai para log, resposta ou auditoria.
   *
   * @throws UnauthorizedException a conta sumiu ou ficou inativa entre o guard e esta chamada.
   * @throws BadRequestException senha atual incorreta, ou nova senha igual a atual.
   * @throws ConflictException a senha mudou durante a operacao.
   */
  async changePassword(
    actor: AuthenticatedUser,
    dto: ChangePasswordDto,
    ip: string | null,
  ): Promise<AuthResponseDto> {
    const user = await this.usersService.findById(actor.id);
    if (!user?.ativo) {
      throw new UnauthorizedException('Token de acesso invalido ou expirado');
    }

    if (!(await this.passwordService.verify(dto.senhaAtual, user.senhaHash))) {
      throw new BadRequestException('Senha atual incorreta');
    }
    if (await this.passwordService.verify(dto.novaSenha, user.senhaHash)) {
      throw new BadRequestException('A nova senha deve ser diferente da senha atual');
    }

    const novoHash = await this.passwordService.hash(dto.novaSenha);
    const quando = new Date();
    if (!(await this.usersService.replacePasswordHash(user.id, user.senhaHash, novoHash, quando))) {
      throw new ConflictException('A senha foi alterada por outra requisicao. Tente novamente.');
    }

    await this.auditService.record({
      usuarioId: user.id,
      acao: AuditAction.PasswordChanged,
      modulo: AuditModuleName.Auth,
      descricao: 'Senha propria alterada',
      ip,
      metadados: { alvoId: user.id },
    });

    return this.buildAuthResponse({ ...user, senhaHash: novoHash, updatedAt: quando });
  }

  private async buildAuthResponse(user: User): Promise<AuthResponseDto> {
    const payload: JwtPayload = { sub: user.id, pv: passwordVersion(user.senhaHash) };
    return {
      accessToken: await this.jwtService.signAsync(payload),
      tokenType: 'Bearer',
      expiresIn: this.expiresIn,
      user: toUserResponse(user),
    };
  }
}
