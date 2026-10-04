import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { MAKEUP_SET_MAX } from '../makeup-set';

export class MakeupSetSessionDto {
  @IsISO8601()
  start_datetime: string;

  @IsISO8601()
  end_datetime: string;
}

/** POST /sessions/makeup-set payload: one student, one tutor, many dates. */
export class MakeupSetDto {
  @IsString()
  student_id: string;

  @IsString()
  tutor_id: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  tutor_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAKEUP_SET_MAX)
  @ValidateNested({ each: true })
  @Type(() => MakeupSetSessionDto)
  sessions: MakeupSetSessionDto[];
}
