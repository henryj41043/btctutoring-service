import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { ContactsService } from '../contacts/contacts.service';
import { StudentsService } from '../students/students.service';
import { Contact } from '../models/contact.model';
import { ScheduleSlot, Student } from '../models/student.model';
import { CUSTOM_PACKAGE } from '../billing/package-config';

/** How far ahead of the effective date the notice goes out. */
export const NOTICE_DAYS_AHEAD = 14;

const ACTIVE_STUDENT = 'Active Student';

const WEEKDAY_LABELS: Record<string, string> = {
  SUNDAY: 'Sun',
  MONDAY: 'Mon',
  TUESDAY: 'Tue',
  WEDNESDAY: 'Wed',
  THURSDAY: 'Thu',
  FRIDAY: 'Fri',
  SATURDAY: 'Sat',
};

/** One student's scheduled change, resolved for the email body. */
interface ChangeNotice {
  student: Student;
  familyName: string;
  effective: string;
  tutorIds: string[];
}

/**
 * Daily 9am ET job (client request 2026-09): warns admins and the student's
 * tutors ahead of a scheduled package change so the new schedule can be set
 * before the 1st-of-month cron promotes it. A change is announced once — the
 * first morning it falls within the next NOTICE_DAYS_AHEAD days — and the
 * effective date is stamped on the student so reruns and later mornings never
 * repeat it. A change scheduled with fewer than 14 days' notice is announced
 * the next morning.
 */
@Injectable()
export class PackageChangeNoticeService {
  private readonly logger = new Logger(PackageChangeNoticeService.name);
  private readonly ses = new SESClient({
    region: process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
  });

  constructor(
    private readonly studentsService: StudentsService,
    private readonly contactsService: ContactsService,
  ) {}

  @Cron('0 9 * * *', { timeZone: 'America/New_York' })
  async sendPackageChangeNotices(): Promise<void> {
    this.logger.log('Running package-change notice job...');

    // Fail closed BEFORE stamping anything — a config fix still delivers
    // the next morning.
    const fromEmail = process.env.SES_FROM_EMAIL;
    if (!fromEmail) {
      this.logger.error('SES_FROM_EMAIL is not set — cannot send notices.');
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
      this.logger.error('Failed to fetch data for package-change notices', err);
      return;
    }

    const today = this.easternToday();
    const horizon = this.addDays(today, NOTICE_DAYS_AHEAD);
    const contactsById = new Map<string, Contact>();
    for (const c of contacts) {
      if (c.id) contactsById.set(c.id, c);
    }

    const notices: ChangeNotice[] = students
      .filter(
        (s) =>
          s.status === ACTIVE_STUDENT &&
          !!s.pending_package &&
          !!s.pending_package_effective &&
          s.pending_package_effective > today &&
          s.pending_package_effective <= horizon &&
          s.pending_change_notice_sent !== s.pending_package_effective,
      )
      .map((student) => ({
        student,
        familyName: this.contactName(contactsById.get(student.contact_id)),
        effective: student.pending_package_effective as string,
        tutorIds: this.effectiveTutorIds(student),
      }));

    if (notices.length === 0) {
      this.logger.log('No upcoming package changes to announce.');
      return;
    }
    this.logger.log(`Found ${notices.length} upcoming package change(s).`);

    // Recipients: every admin gets every notice; each tutor gets the
    // notices for their own students. One digest per recipient.
    const byRecipient = new Map<string, ChangeNotice[]>();
    const add = (id: string | undefined, notice: ChangeNotice) => {
      if (!id) return;
      byRecipient.set(id, [...(byRecipient.get(id) ?? []), notice]);
    };
    const admins = contacts.filter((c) => c.user_group === 'Admins');
    for (const notice of notices) {
      for (const admin of admins) add(admin.id, notice);
      for (const tutorId of notice.tutorIds) add(tutorId, notice);
    }

    // A change is stamped once at least one recipient received it; a change
    // whose every send failed stays unstamped and retries next morning.
    const delivered = new Set<ChangeNotice>();
    for (const [recipientId, theirs] of byRecipient) {
      const recipient = contactsById.get(recipientId);
      if (!recipient?.email) {
        this.logger.warn(`No email for contact ${recipientId}, skipping.`);
        continue;
      }
      // Dedupe: a tutor can be both assigned and a slot tutor.
      const unique = [...new Set(theirs)];
      try {
        await this.sendNoticeEmail(fromEmail, recipient, unique, contactsById);
        unique.forEach((n) => delivered.add(n));
        this.logger.log(
          `Package-change notice sent to ${recipient.email} (${unique.length} change(s)).`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to send package-change notice to ${recipient.email}`,
          err,
        );
      }
    }

    for (const notice of delivered) {
      try {
        await this.studentsService.markPendingChangeNoticeSent(
          notice.student.id as string,
          notice.effective,
        );
      } catch (err) {
        this.logger.error(
          `Failed to stamp notice on student ${notice.student.id}`,
          err,
        );
      }
    }
  }

  /** Assigned tutor plus any per-slot tutor on the current AND pending schedules. */
  private effectiveTutorIds(student: Student): string[] {
    const ids = new Set<string>();
    if (student.assigned_tutor_id) ids.add(student.assigned_tutor_id);
    for (const slot of [
      ...(student.schedule ?? []),
      ...(student.pending_schedule ?? []),
    ]) {
      if (slot?.tutor_id) ids.add(slot.tutor_id);
    }
    return [...ids];
  }

  private async sendNoticeEmail(
    fromEmail: string,
    recipient: Contact,
    notices: ChangeNotice[],
    contactsById: Map<string, Contact>,
  ): Promise<void> {
    const firstName =
      (recipient.first_name ?? '').trim() || this.contactName(recipient);
    const count = notices.length;
    const subject =
      count === 1
        ? `Upcoming package change: ${notices[0].student.name} on ${this.formatDate(notices[0].effective)}`
        : `${count} upcoming package changes`;

    const blocks = notices.map((n) => {
      const s = n.student;
      const lines = [
        `${s.name} (${n.familyName})`,
        `  Current package: ${s.package || '—'}`,
        `  New package: ${this.describePackage(s)}`,
        `  Effective: ${this.formatDate(n.effective)}`,
      ];
      if (s.pending_schedule && s.pending_schedule.length > 0) {
        lines.push(
          `  New weekly schedule: ${this.describeSchedule(s.pending_schedule, s, contactsById)}`,
        );
      } else {
        lines.push(
          `  ⚠ No new schedule has been set. The current weekly schedule will carry over unchanged when the package switches. If the new package needs different days, times, or lengths, set the pending schedule via Manage Schedule before ${this.formatDate(n.effective)}.`,
        );
      }
      return lines.join('\n');
    });

    const body = [
      `Hi ${firstName},`,
      ``,
      count === 1
        ? `A scheduled package change takes effect in the next ${NOTICE_DAYS_AHEAD} days:`
        : `${count} scheduled package changes take effect in the next ${NOTICE_DAYS_AHEAD} days:`,
      ``,
      blocks.join('\n\n'),
      ``,
      `Billing switches to the new package from the effective month automatically. This notice is sent once per scheduled change.`,
      ``,
      `— Beyond the Chalkboard Tutoring`,
    ].join('\n');

    await this.ses.send(
      new SendEmailCommand({
        Source: fromEmail,
        Destination: { ToAddresses: [recipient.email] },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Text: { Data: body, Charset: 'UTF-8' } },
        },
      }),
    );
  }

  /** 'Custom ($400/mo, 2×45 min)' or the package name. */
  private describePackage(s: Student): string {
    const name = s.pending_package || '—';
    if (name !== CUSTOM_PACKAGE) return name;
    const parts: string[] = [];
    if (s.pending_custom_monthly_cost !== undefined) {
      parts.push(`$${s.pending_custom_monthly_cost}/mo`);
    }
    if (
      s.pending_custom_sessions_per_week !== undefined ||
      s.pending_custom_session_length_min !== undefined
    ) {
      parts.push(
        `${s.pending_custom_sessions_per_week ?? '?'}×${s.pending_custom_session_length_min ?? '?'} min`,
      );
    }
    return parts.length > 0 ? `${name} (${parts.join(', ')})` : name;
  }

  /** 'Mon 4:00 PM–4:30 PM, Thu 4:00 PM–4:30 PM (Tess One)'. */
  private describeSchedule(
    slots: ScheduleSlot[],
    student: Student,
    contactsById: Map<string, Contact>,
  ): string {
    return slots
      .map((slot) => {
        const day = WEEKDAY_LABELS[slot.weekday] ?? slot.weekday;
        let text = `${day} ${this.formatTime(slot.start_time)}–${this.formatTime(slot.end_time)}`;
        if (slot.tutor_id && slot.tutor_id !== student.assigned_tutor_id) {
          text += ` (${this.contactName(contactsById.get(slot.tutor_id))})`;
        }
        return text;
      })
      .join(', ');
  }

  /** 'HH:mm' → 'h:mm AM/PM' (blank-safe). */
  private formatTime(time: string | undefined): string {
    const [h, m] = (time ?? '').split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return time ?? '';
    const suffix = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
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
