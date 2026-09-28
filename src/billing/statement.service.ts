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
  applyRecords,
  buildStatement,
  buildStatements,
  parseMonth,
  Statement,
} from './statement-engine';
import { easternDateKey } from './eastern-time';

export interface FreezeResult {
  month: string;
  /** Statements written by this run (families already frozen are skipped). */
  frozen: number;
}

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

  /**
   * Every family's statement for a month ('YYYY-MM'). A month that has
   * closed and was frozen is served from its stored copy — what the family
   * was billed, whatever the students look like today — with the paid state
   * and overrides laid over it. Anything else is calculated now.
   */
  async getStatements(
    month: string,
    now: Date = new Date(),
  ): Promise<Statement[]> {
    const parsed = this.monthOf(month);
    if (month < easternDateKey(now).slice(0, 7)) {
      const stored = await this.storedStatements(month);
      if (stored.length > 0) {
        const records = (await this.billing.getBillingRecordsByMonth(
          month,
        )) as unknown as BillingRecord[];
        return stored
          .map((statement) => applyRecords(statement, records))
          .sort((a, b) => a.contact_name.localeCompare(b.contact_name));
      }
    }
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

  /** The frozen statements of a month; an unreadable one is skipped and logged. */
  private async storedStatements(month: string): Promise<Statement[]> {
    const statements: Statement[] = [];
    for (const json of await this.billing.getFrozenStatements(month)) {
      try {
        const statement = JSON.parse(json) as Statement;
        if (
          statement &&
          statement.contact_id &&
          Array.isArray(statement.dues)
        ) {
          statements.push(statement);
        }
      } catch {
        this.logger.error(`Unreadable frozen statement for ${month}.`);
      }
    }
    return statements;
  }

  /**
   * Freezes a CLOSED month: every family's statement is calculated one last
   * time and stored. Families already frozen for the month are left alone,
   * so re-running is safe. The inputs may be passed in by a caller that has
   * already loaded them (the 1st-of-month run).
   */
  async freezeMonth(
    month: string,
    now: Date = new Date(),
    loaded?: {
      students: Student[];
      contacts: Contact[];
      catalog: PackageCatalog;
    },
  ): Promise<FreezeResult> {
    const parsed = this.monthOf(month);
    if (month >= easternDateKey(now).slice(0, 7)) {
      throw new BadRequestException(
        'Only a month that has ended can be frozen.',
      );
    }
    const catalog = loaded?.catalog ?? (await this.catalog());
    const [students, contacts, records] = await Promise.all([
      loaded?.students ?? this.students.getStudents(),
      loaded?.contacts ?? this.contacts.getContacts(),
      this.billing.getBillingRecordsByMonth(month),
    ]);
    const statements = buildStatements(
      contacts as unknown as Contact[],
      students as unknown as Student[],
      records as unknown as BillingRecord[],
      parsed.year,
      parsed.month,
      catalog,
    );
    const frozenAt = now.toISOString();
    let frozen = 0;
    for (const statement of statements) {
      const created = await this.billing.createFrozenStatementIfAbsent({
        contact_id: statement.contact_id,
        month,
        frozen_at: frozenAt,
        statement: JSON.stringify({ ...statement, frozen_at: frozenAt }),
      });
      if (created) frozen++;
    }
    this.logger.log(
      `Froze ${month}: ${frozen} statement(s) written, ${statements.length - frozen} already frozen.`,
    );
    return { month, frozen };
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
