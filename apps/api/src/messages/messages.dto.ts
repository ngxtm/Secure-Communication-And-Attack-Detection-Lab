import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const USERNAME = /^[A-Za-z0-9._-]+$/;

export class PublishIdentityDto {
  @IsString()
  @MinLength(350)
  @MaxLength(1024)
  @Matches(BASE64URL)
  publicKey!: string;

  @IsOptional()
  @IsBoolean()
  replaceExisting?: boolean;
}

export class SendMessageDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(USERNAME)
  recipientUsername!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(24_000)
  @Matches(BASE64URL)
  ciphertext!: string;

  @IsString()
  @Length(16, 16)
  @Matches(BASE64URL)
  iv!: string;

  @IsString()
  @Length(342, 342)
  @Matches(BASE64URL)
  senderWrappedKey!: string;

  @IsString()
  @Length(342, 342)
  @Matches(BASE64URL)
  recipientWrappedKey!: string;
}
