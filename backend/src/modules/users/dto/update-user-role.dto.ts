import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { RoleName } from '../../roles/role-name.enum';

export class UpdateUserRoleDto {
  @ApiProperty({ enum: RoleName, example: RoleName.Operador })
  @IsEnum(RoleName, {
    message: `role deve ser um destes valores: ${Object.values(RoleName).join(', ')}`,
  })
  role: RoleName;
}
