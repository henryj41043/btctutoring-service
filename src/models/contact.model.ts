import {
  IsArray,
  IsDate,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AvailabilityBlock {
  @IsArray()
  @IsString({ each: true })
  days: string[];

  @IsString()
  start_time: string;

  @IsString()
  end_time: string;
}

export class Contact {
  id?: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  service: string;
  status?: string;
  monthly_charge?: number;
  charge_per_billing_cycle?: number;
  amount_to_be_paid_this_month?: number;
  billing_cycle?: string;
  cc_authorization_received?: boolean;
  twenty_five_deducted?: boolean;
  payment_one_received?: boolean;
  payment_two_received?: boolean;
  payment_three_received?: boolean;
  payment_four_received?: boolean;
  special_circumstance?: string;
  scholarship_state?: string;
  invoice_Month?: string;
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  date_funds_requested_by_btc?: Date;
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  date_funds_requested_by_family?: Date;
  invoice_number?: string;
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  invoice_paid_date?: Date;
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  inquiry_received?: Date;
  inquiry_note_from_parent?: string;
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  consult_date?: Date;
  twenty_five_received?: boolean;
  scholarship_student?: boolean;
  scholarship_name?: string;
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  trial_date?: Date;
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  registration_sent?: Date;
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  registration_received?: Date;
  title?: string;
  currently_accepting_students?: boolean;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AvailabilityBlock)
  availability?: AvailabilityBlock[];
  zoom_link?: string;
  hourly_rate?: number;
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  hiring_inquiry_received?: Date;
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  interview_offer_sent?: Date;
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  interview_scheduled?: Date;
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  offer_sent?: Date;
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  onboarding_paperwork_received?: Date;
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  training_completed?: Date;
  user_profile_created?: boolean;
  user_group?: string;
}
