import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { ContactsService } from '../contacts/contacts.service';
import { StudentsService } from '../students/students.service';
import { Contact } from '../models/contact.model';
import { isCurrentAdmin } from '../models/user-groups';
import { Student } from '../models/student.model';
import { brandedEmail } from './email-template';

/** How far ahead of the end date the reminder goes out. */
export const END_REMINDER_DAYS_AHEAD = 14;
/** Where a student's family page lives (the email links to it). */
export const APP_CONTACT_URL = 'https://btchub.bitshiftstudio.io/contacts/';

const ACTIVE_STUDENT = 'Active Student';

/** One student whose service ends soon, resolved for the email body. */
export interface EndReminder {
  student: Student;
  endDate: string;
  familyName: string;
  tutorName: string;
}

/**
 * Daily 9am ET job (client request 2026-10-13): reminds every current admin
 * two weeks before a student's service end date, so the family's last weeks
 * can be arranged. Each end date is announced once, the first morning it
 * falls within the next END_REMINDER_DAYS_AHEAD days, and is stamped on the
 * student; a moved end date no longer matches the stamp and is announced
 * again, and an end date entered with fewer than 14 days' notice goes out the
 * next morning.
 */
@Injectable()
export class ServiceEndReminderService {
  private readonly logger = new Logger(ServiceEndReminderService.name);
  private readonly ses = new SESClient({
    region: process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
  });

  constructor(
    private readonly studentsService: StudentsService,
    private readonly contactsService: ContactsService,
  ) {}

  @Cron('0 9 * * *', { timeZone: 'America/New_York' })
  async sendServiceEndReminders(): Promise<void> {
    this.logger.log('Running service-end reminder job...');

    // Fail closed BEFORE stamping anything: a config fix still delivers the
    // next morning.
    const fromEmail = process.env.SES_FROM_EMAIL;
    if (!fromEmail) {
      this.logger.error('SES_FROM_EMAIL is not set — cannot send reminders.');
      return;
    }

    let students: Student[];
    let contacts: Contact[];
    try {
      [students, contacts] = (await Promise.all([
        this.studentsService.getStudents(),
        this.contactsService.getContacts(),
      ])) as unknown as [Student[], Contact[]];
    } catch (err) {
      this.logger.error('Failed to fetch data for service-end reminders', err);
      return;
    }

    const today = this.easternToday();
    const horizon = this.addDays(today, END_REMINDER_DAYS_AHEAD);
    const contactsById = new Map<string, Contact>();
    for (const c of contacts) {
      if (c.id) contactsById.set(c.id, c);
    }

    const reminders: EndReminder[] = students
      .filter(
        (s) =>
          s.status === ACTIVE_STUDENT &&
          typeof s.service_end_date === 'string' &&
          s.service_end_date > today &&
          s.service_end_date <= horizon &&
          s.end_reminder_sent !== s.service_end_date,
      )
      .map((student) => ({
        student,
        endDate: student.service_end_date as string,
        familyName: this.contactName(contactsById.get(student.contact_id)),
        tutorName: this.contactName(
          contactsById.get(student.assigned_tutor_id ?? ''),
        ),
      }))
      .sort((a, b) => a.endDate.localeCompare(b.endDate));

    if (reminders.length === 0) {
      this.logger.log('No upcoming service end dates to announce.');
      return;
    }
    this.logger.log(`Found ${reminders.length} upcoming service end date(s).`);

    // Current admins only — former staff may still carry the group.
    const admins = contacts.filter(isCurrentAdmin);
    let delivered = false;
    for (const admin of admins) {
      if (!admin.email) {
        this.logger.warn(`No email for admin ${admin.id}, skipping.`);
        continue;
      }
      try {
        await this.sendReminderEmail(fromEmail, admin, reminders);
        delivered = true;
        this.logger.log(
          `Service-end reminder sent to ${admin.email} (${reminders.length} student(s)).`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to send service-end reminder to ${admin.email}`,
          err,
        );
      }
    }

    // Stamped once at least one admin received it; when every send failed
    // nothing is stamped and the next morning retries.
    if (!delivered) {
      this.logger.warn('No admin received the service-end reminder.');
      return;
    }
    for (const reminder of reminders) {
      try {
        await this.studentsService.markServiceEndReminderSent(
          reminder.student,
          reminder.endDate,
        );
      } catch (err) {
        this.logger.error(
          `Failed to stamp the reminder on student ${reminder.student.id}`,
          err,
        );
      }
    }
  }

  private async sendReminderEmail(
    fromEmail: string,
    recipient: Contact,
    reminders: EndReminder[],
  ): Promise<void> {
    const firstName =
      (recipient.first_name ?? '').trim() || this.contactName(recipient);
    const count = reminders.length;
    const subject =
      count === 1
        ? `Service ending soon: ${reminders[0].student.name} on ${this.formatDate(reminders[0].endDate)}`
        : `${count} students' service ending soon`;

    const blocks = reminders.map((r) => {
      const s = r.student;
      return [
        `${s.name} (${r.familyName})`,
        `  Last day of service: ${this.formatDate(r.endDate)}`,
        `  Then: ${s.end_status || 'Past Student'}`,
        `  Package: ${s.package || '—'}`,
        `  Tutor: ${r.tutorName}`,
        `  ${APP_CONTACT_URL}${s.contact_id}`,
      ].join('\n');
    });

    const message = brandedEmail({
      title: 'Service ending soon',
      greeting: `Hi ${firstName},`,
      intro:
        count === 1
          ? `A student's service ends in the next ${END_REMINDER_DAYS_AHEAD} days:`
          : `${count} students' service ends in the next ${END_REMINDER_DAYS_AHEAD} days:`,
      body: blocks.join('\n\n'),
      outro: `The final month is billed up to the last day of service, and the pending sessions after it are removed. This reminder is sent once per end date.`,
    });

    await this.ses.send(
      new SendEmailCommand({
        Source: fromEmail,
        Destination: { ToAddresses: [recipient.email] },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: message,
        },
      }),
    );
  }

  private contactName(contact: Contact | undefined): string {
    if (!contact) return 'Unknown';
    return (
      `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() ||
      'Unknown'
    );
  }

  /** 'YYYY-MM-DD' → 'Mon D, YYYY' (UTC in and out — no off-by-one). */
  private formatDate(iso: string): string {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${iso}T00:00:00Z`));
  }

  /** Today's Eastern wall date as 'YYYY-MM-DD' (en-CA formats ISO-style). */
  private easternToday(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
    }).format(new Date());
  }

  /** 'YYYY-MM-DD' + n days, in UTC arithmetic (dates only, no DST drift). */
  private addDays(iso: string, days: number): string {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
}
