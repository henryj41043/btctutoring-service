import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { SessionsService } from '../sessions/sessions.service';
import { ContactsService } from '../contacts/contacts.service';
import { Session, SessionType } from '../models/session.model';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly ses = new SESClient({
    region: process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
  });

  constructor(
    private readonly sessionsService: SessionsService,
    private readonly contactsService: ContactsService,
  ) {}

  /**
   * Runs every morning at 9am US Eastern time.
   * Finds all TUTORING sessions that ended before today and are still PENDING,
   * then sends a digest reminder email to each assigned tutor.
   */
  @Cron('0 9 * * *', { timeZone: 'America/New_York' })
  async sendPendingSessionReminders(): Promise<void> {
    this.logger.log('Running pending session reminder job...');

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    let allSessions: Session[];
    try {
      allSessions = (await this.sessionsService.getAllSessions()) as unknown as Session[];
    } catch (err) {
      this.logger.error('Failed to fetch sessions for reminder job', err);
      return;
    }

    // Filter: TUTORING type, Pending status, ended before start of today
    const staleSessions = allSessions.filter(
      (s) =>
        s.type === SessionType.TUTORING &&
        s.status === 'Pending' &&
        s.end_datetime &&
        new Date(s.end_datetime) < startOfToday,
    );

    if (staleSessions.length === 0) {
      this.logger.log('No stale pending sessions found.');
      return;
    }

    this.logger.log(`Found ${staleSessions.length} stale pending session(s).`);

    // Group by tutor_id
    const byTutor = new Map<string, Session[]>();
    for (const session of staleSessions) {
      if (!session.tutor_id) continue;
      const existing = byTutor.get(session.tutor_id) ?? [];
      byTutor.set(session.tutor_id, [...existing, session]);
    }

    // Send one digest email per tutor
    for (const [tutorId, sessions] of byTutor) {
      try {
        const contacts = await this.contactsService.getContact(tutorId);
        const tutor = contacts[0] as any;
        if (!tutor?.email) {
          this.logger.warn(`No email found for tutor ${tutorId}, skipping.`);
          continue;
        }
        const tutorName = `${tutor.first_name ?? ''} ${tutor.last_name ?? ''}`.trim();
        await this.sendReminderEmail(tutor.email, tutorName, sessions);
        this.logger.log(
          `Reminder sent to ${tutor.email} for ${sessions.length} session(s).`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to send reminder for tutor ${tutorId}`,
          err,
        );
      }
    }
  }

  private async sendReminderEmail(
    email: string,
    name: string,
    sessions: Session[],
  ): Promise<void> {
    const fromEmail = process.env.SES_FROM_EMAIL;
    if (!fromEmail) {
      this.logger.error('SES_FROM_EMAIL is not set — cannot send reminder.');
      return;
    }

    const firstName = name.split(' ')[0] || name;
    const count = sessions.length;

    // Sort sessions oldest-first for readability
    const sorted = [...sessions].sort(
      (a, b) =>
        new Date(a.start_datetime).getTime() -
        new Date(b.start_datetime).getTime(),
    );

    const sessionLines = sorted
      .map((s) => {
        const date = new Date(s.start_datetime).toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'America/New_York',
        });
        const time = new Date(s.start_datetime).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: 'America/New_York',
        });
        return `  • ${date} at ${time}${s.student_name ? ` — ${s.student_name}` : ''}`;
      })
      .join('\n');

    const subject =
      count === 1
        ? `Action Required: 1 session is awaiting attendance`
        : `Action Required: ${count} sessions are awaiting attendance`;

    const body = [
      `Hi ${firstName},`,
      ``,
      `This is a reminder that ${count === 1 ? 'a session' : `${count} sessions`} from your schedule ${count === 1 ? 'is' : 'are'} still marked as Pending and need${count === 1 ? 's' : ''} an attendance update:`,
      ``,
      sessionLines,
      ``,
      `Please log in to Beyond the Chalkboard Tutoring and update the session status at your earliest convenience.`,
      ``,
      `You will continue to receive this reminder each morning until the status is updated.`,
      ``,
      `— Beyond the Chalkboard Tutoring`,
    ].join('\n');

    await this.ses.send(
      new SendEmailCommand({
        Source: fromEmail,
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Text: { Data: body, Charset: 'UTF-8' } },
        },
      }),
    );
  }
}
