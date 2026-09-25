import { Transform } from 'class-transformer';
import {
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const USERNAME = /^[A-Za-z0-9._-]+$/;

export class UploadFileDto {
  @IsString()
  @IsUUID('4')
  requestId!: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(USERNAME)
  recipientUsername!: string;

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
