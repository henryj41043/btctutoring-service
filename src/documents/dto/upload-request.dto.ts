import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { MAX_BYTES } from '../document-rules';

/** POST /documents/contact/:contactId/upload-url payload. */
export class UploadRequestDto {
  @IsString()
  @MaxLength(500)
  file_name: string;

  @IsString()
  @MaxLength(200)
  content_type: string;

  @IsInt()
  @Min(1)
  @Max(MAX_BYTES)
  size: number;
}
