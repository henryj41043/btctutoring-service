import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { randomUUID } from 'crypto';
import { RemindersModel } from '../models/reminders.model';
import { Reminder } from '../models/reminder.model';
import { ContactsService } from '../contacts/contacts.service';
import { Contact } from '../models/contact.model';
import { nextOccurrence, Recurrence } from './recurrence';

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);
  private readonly ses = new SESClient({
    region: process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
  });

  constructor(private readonly contactsService: ContactsService) {}

  async getReminders() {
    return RemindersModel.scan()
      .all()
      .exec()
      .then((reminders) => {
        return reminders;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async createReminder(reminder: Reminder) {
    const newUuid: string = randomUUID();
    const newReminder = new RemindersModel({
      id: newUuid,
      title: reminder.title,
      message: reminder.message,
      date: reminder.date,
      all_admins: reminder.all_admins ?? false,
      recipient_ids: reminder.recipient_ids ?? [],
      contact_id: reminder.contact_id,
      created_by: reminder.created_by,
      due_date: reminder.due_date,
      recurrence: reminder.recurrence,
    });
    return newReminder
      .save()
      .then(() => {
        return Promise.resolve({
          id: newUuid,
          message: 'Reminder created successfully.',
        });
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async updateReminder(reminder: Reminder) {
    // Attribute allowlist — sent_at/completed_at are owned by the cron and the
    // complete endpoint; an edit re-arms them only via an actual DATE change
    // (rescheduling means "fire again on the new day", even for a reminder
    // that was already sent or completed). Note: the read-then-update pair
    // races the 9am cron's advance by milliseconds once a day — accepted.
    const stored = (await RemindersModel.get({
      id: reminder.id!,
    }).catch((error: Error) => {
      Logger.error(error.message, error);
      return Promise.reject(error);
    })) as unknown as Reminder | undefined;
    const dateChanged = !stored || stored.date !== reminder.date;

    const base: Record<string, unknown> = {
      title: reminder.title,
      message: reminder.message,
      date: reminder.date,
      all_admins: reminder.all_admins ?? false,
      recipient_ids: reminder.recipient_ids ?? [],
    };
    // Cleared/absent optional fields remove the attribute (dynamoose rejects
    // null on a typed field). Push order is spec-pinned.
    const removals: string[] = [];
    if (dateChanged) {
      removals.push('sent_at', 'completed_at');
    }
    if (reminder.contact_id) {
      base.contact_id = reminder.contact_id;
    } else {
      removals.push('contact_id');
    }
    if (reminder.due_date) {
      base.due_date = reminder.due_date;
    } else {
      removals.push('due_date');
    }
    if (reminder.recurrence) {
      base.recurrence = reminder.recurrence;
      // Invariant: recurring reminders never carry a completion stamp.
      if (!removals.includes('completed_at')) {
        removals.push('completed_at');
      }
    } else {
      removals.push('recurrence');
    }
    // created_by is set-only — a partial payload never wipes provenance.
    if (reminder.created_by) {
      base.created_by = reminder.created_by;
    }
    return RemindersModel.update(
      { id: reminder.id },
      { $SET: base, $REMOVE: removals },
    )
      .then((updated) => {
        return updated;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  /**
   * Cron + the Done checkbox share one advance path: roll the date to the
   * next occurrence and clear the fire-once flag so the new date emails.
   */
  private async advanceRecurring(
    reminder: Reminder,
    today: string,
  ): Promise<void> {
    const after = (reminder.date ?? '') > today ? reminder.date : today;
    const next = nextOccurrence(
      reminder.date,
      reminder.recurrence as Recurrence,
      after,
    );
    await RemindersModel.update(
      { id: reminder.id },
      { $SET: { date: next }, $REMOVE: ['sent_at'] },
    );
  }

  /** One-time: stamps completed_at. Recurring: advances to the next occurrence. */
  async completeReminder(id: string) {
    const stored = (await RemindersModel.get({ id }).catch((error: Error) => {
      Logger.error(error.message, error);
      return Promise.reject(error);
    })) as unknown as Reminder | undefined;
    if (!stored) {
      throw new NotFoundException('Reminder not found');
    }
    try {
      if (stored.recurrence) {
        await this.advanceRecurring(stored, this.easternToday());
        return { id, message: 'Reminder occurrence completed.' };
      }
      await RemindersModel.update({ id }, { completed_at: new Date().toISOString() });
      return { id, message: 'Reminder completed.' };
    } catch (error) {
      Logger.error((error as Error).message, error);
      throw error;
    }
  }

  /** Reopens a completed one-time reminder ($REMOVE is a no-op otherwise). */
  async uncompleteReminder(id: string) {
    return RemindersModel.update({ id }, { $REMOVE: ['completed_at'] })
      .then(() => {
        return { id, message: 'Reminder reopened.' };
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async deleteReminder(id: string) {
    return RemindersModel.delete({
      id: id,
    })
      .then(() => {
        return Promise.resolve({
          id: id,
          message: 'Reminder deleted successfully.',
        });
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  /** 'YYYY-MM-DD' → 'Mon D' (UTC in and out — no off-by-one). */
  private formatDueDate(iso: string): string {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${iso}T00:00:00Z`));
  }

  /** Today's Eastern wall date as 'YYYY-MM-DD' (en-CA formats ISO-style). */
  private easternToday(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
    }).format(new Date());
  }

  /**
   * Runs every morning at 9am US Eastern time.
   * Emails each recipient admin a digest of the reminders due today, then
   * stamps sent_at so a reminder only ever fires once (idempotent across
   * restarts and redeploys).
   */
  @Cron('0 9 * * *', { timeZone: 'America/New_York' })
  async sendDueReminders(): Promise<void> {
    this.logger.log('Running admin reminder job...');

    // Fail closed BEFORE marking anything sent — a config fix still
    // delivers the next morning.
    const fromEmail = process.env.SES_FROM_EMAIL;
    if (!fromEmail) {
      this.logger.error('SES_FROM_EMAIL is not set — cannot send reminders.');
      return;
    }

    const today = this.easternToday();
    let due: Reminder[];
    try {
      const all = (await this.getReminders()) as unknown as Reminder[];
      due = all.filter(
        (r) => r.date === today && !r.sent_at && !r.completed_at,
      );
    } catch (err) {
      this.logger.error('Failed to fetch reminders for reminder job', err);
      return;
    }

    if (due.length === 0) {
      this.logger.log('No reminders due today.');
      return;
    }

    let admins: Contact[];
    try {
      admins =
        (await this.contactsService.getAdminContacts()) as unknown as Contact[];
    } catch (err) {
      this.logger.error('Failed to fetch admin contacts for reminder job', err);
      return;
    }

    // One digest per admin covering all of their due reminders.
    const byAdmin = new Map<Contact, Reminder[]>();
    for (const admin of admins) {
      const theirs = due.filter(
        (r) => r.all_admins || (r.recipient_ids ?? []).includes(admin.id ?? ''),
      );
      if (theirs.length > 0) {
        byAdmin.set(admin, theirs);
      }
    }

    for (const [admin, reminders] of byAdmin) {
      if (!admin.email) {
        this.logger.warn(`No email for admin ${admin.id}, skipping.`);
        continue;
      }
      try {
        await this.sendDigestEmail(fromEmail, admin, reminders);
        this.logger.log(
          `Reminder digest sent to ${admin.email} (${reminders.length} reminder(s)).`,
        );
      } catch (err) {
        // One admin's failure never blocks the others.
        this.logger.error(`Failed to send digest to admin ${admin.id}`, err);
      }
    }

    // Fire once: mark every due reminder attempted, even on partial send
    // failures — a daily re-send loop is worse than a missed email here.
    const now = new Date().toISOString();
    for (const reminder of due) {
      try {
        if (reminder.recurrence) {
          // Recurring reminders never stamp — they roll to the next date.
          await this.advanceRecurring(reminder, today);
        } else {
          await RemindersModel.update({ id: reminder.id }, { sent_at: now });
        }
      } catch (err) {
        this.logger.error(`Failed to mark reminder ${reminder.id} sent`, err);
      }
    }
  }

  private async sendDigestEmail(
    fromEmail: string,
    admin: Contact,
    reminders: Reminder[],
  ): Promise<void> {
    const firstName = admin.first_name || 'there';
    const count = reminders.length;

    const reminderLines = reminders
      .map(
        (r) =>
          `  • ${r.title}${r.message ? ` — ${r.message}` : ''}` +
          (r.due_date ? ` (due ${this.formatDueDate(r.due_date)})` : ''),
      )
      .join('\n');

    const subject =
      count === 1
        ? `Reminder: ${reminders[0].title}`
        : `${count} reminders for today`;

    const body = [
      `Hi ${firstName},`,
      ``,
      `You have ${count === 1 ? 'a reminder' : `${count} reminders`} for today:`,
      ``,
      reminderLines,
      ``,
      `— Beyond the Chalkboard Tutoring`,
    ].join('\n');

    await this.ses.send(
      new SendEmailCommand({
        Source: fromEmail,
        Destination: { ToAddresses: [admin.email] },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Text: { Data: body, Charset: 'UTF-8' } },
        },
      }),
    );
  }
}
