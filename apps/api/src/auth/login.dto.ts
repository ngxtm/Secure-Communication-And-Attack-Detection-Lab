import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'alice', description: 'Seeded demo username.' })
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,64}$/)
  username!: string;

  @ApiProperty({ description: 'Password configured in the root .env file.' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
