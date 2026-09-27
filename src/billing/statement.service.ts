import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { StudentsService } from '../students/students.service';
import { ContactsService } from '../contacts/contacts.service';
import { PackagesService } from '../packages/packages.service';
import { BillingService } from './billing.service';
import { Student } from '../models/student.model';
import { Contact } from '../models/contact.model';
import { BillingRecord } from '../models/billing-record.model';
import { PackageCatalog } from './package-config';
import {
  buildStatement,
  buildStatements,
  parseMonth,
  Statement,
} from './statement-engine';

/** POST /billing/statements/preview payload. */
export class StatementPreviewRequest {
  /** 'YYYY-MM' */
  month: string;
  /** The student as the dialog would save it (may be unsaved, without an id). */
  student: Student;
}

/**
 * Serves Billing v2 statements: loads the month's inputs and hands them to
 * the pure engine. Nothing here does arithmetic.
 */
@Injectable()
export class StatementService {
  private readonly logger = new Logger(StatementService.name);

  constructor(
    private readonly students: StudentsService,
    private readonly contacts: ContactsService,
    private readonly packages: PackagesService,
    private readonly billing: BillingService,
  ) {}

  private monthOf(month: string): { year: number; month: number } {
    const parsed = parseMonth(month);
    if (!parsed) {
      throw new BadRequestException('month must be formatted YYYY-MM.');
    }
    return parsed;
  }

  /** An empty catalog would price every named package at $0 — fail loudly. */
  private async catalog(): Promise<PackageCatalog> {
    const catalog = await this.packages.getCatalog();
    if (Object.keys(catalog).length === 0) {
      this.logger.error(
        'Statements unavailable: the package catalog is empty.',
      );
      throw new ServiceUnavailableException(
        'The package catalog is unavailable.',
      );
    }
    return catalog;
  }

  /** Every family's statement for a month ('YYYY-MM'). */
  async getStatements(month: string): Promise<Statement[]> {
    const parsed = this.monthOf(month);
    const catalog = await this.catalog();
    const [students, contacts, records] = await Promise.all([
      this.students.getStudents(),
      this.contacts.getContacts(),
      this.billing.getBillingRecordsByMonth(month),
    ]);
    return buildStatements(
      contacts as unknown as Contact[],
      students as unknown as Student[],
      records as unknown as BillingRecord[],
      parsed.year,
      parsed.month,
      catalog,
    );
  }

  /**
   * The family's statement as it WOULD be with an unsaved student change
   * (the dialogs' live preview). Nothing is written. Null when the family
   * would owe nothing that month.
   */
  async previewStatement(
    request: StatementPreviewRequest,
  ): Promise<Statement | null> {
    const parsed = this.monthOf(request?.month);
    const draft = request.student;
    if (!draft || !draft.contact_id) {
      throw new BadRequestException('student.contact_id is required.');
    }
    const catalog = await this.catalog();
    const [students, contacts, records] = await Promise.all([
      this.students.getStudents(),
      this.contacts.getContacts(),
      this.billing.getBillingRecordsByMonth(request.month),
    ]);
    const contact = (contacts as unknown as Contact[]).find(
      (c) => c.id === draft.contact_id,
    );
    if (!contact) {
      throw new BadRequestException('Contact not found.');
    }
    const others = (students as unknown as Student[]).filter(
      (s) => !draft.id || s.id !== draft.id,
    );
    return buildStatement(
      contact,
      [...others, draft],
      records as unknown as BillingRecord[],
      parsed.year,
      parsed.month,
      catalog,
    );
  }
}
