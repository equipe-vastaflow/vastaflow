import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ClientIp } from '../../common/decorators/client-ip.decorator';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({
    summary: 'Cadastra um novo usuario',
    description:
      'Cadastro publico. O usuario sempre nasce com o perfil USUARIO e ja recebe um token de acesso.',
  })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({
    description: 'Dados invalidos (e-mail malformado, senha fora da politica)',
  })
  @ApiConflictResponse({ description: 'E-mail ja cadastrado' })
  register(@Body() dto: RegisterDto, @ClientIp() ip: string | null): Promise<AuthResponseDto> {
    return this.authService.register(dto, ip);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Autentica com e-mail e senha e devolve um JWT' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({ description: 'Corpo da requisicao invalido' })
  @ApiUnauthorizedResponse({ description: 'E-mail inexistente ou senha incorreta' })
  @ApiForbiddenResponse({ description: 'Usuario inativo' })
  login(@Body() dto: LoginDto, @ClientIp() ip: string | null): Promise<AuthResponseDto> {
    return this.authService.login(dto, ip);
  }

  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Devolve o usuario autenticado' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiUnauthorizedResponse({ description: 'Token ausente, invalido ou expirado' })
  me(@CurrentUser() user: UserResponseDto): UserResponseDto {
    return user;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Registra o logout na auditoria',
    description:
      'O JWT e stateless: o cliente deve descartar o token. Ele continua tecnicamente valido ate expirar.',
  })
  @ApiNoContentResponse({ description: 'Logout registrado' })
  @ApiUnauthorizedResponse({ description: 'Token ausente, invalido ou expirado' })
  async logout(@CurrentUser() user: UserResponseDto, @ClientIp() ip: string | null): Promise<void> {
    await this.authService.logout(user, ip);
  }
}
