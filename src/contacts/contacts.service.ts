import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ContactsModel } from '../models/contacts.model';
import { Contact } from '../models/contact.model';
import { randomUUID } from 'crypto';

/** The slice of a DocumentClient scan page the summary listing consumes. */
interface SummaryScanPage {
  Items?: Record<string, unknown>[];
  LastEvaluatedKey?: Record<string, unknown>;
}

@Injectable()
export class ContactsService {
  constructor(private readonly documentClient: DynamoDBDocumentClient) {}

  async getContact(id: string) {
    // Keyed GetItem; array-of-one preserves the old scan-result shape.
    return ContactsModel.get(id)
      .then((contact) => {
        return contact ? [contact] : [];
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async getContacts() {
    return ContactsModel.scan()
      .all()
      .exec()
      .then((contacts) => {
        return contacts;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  /**
   * Lean projection for the contacts table: only the columns the list renders
   * (the full record is fetched by id when a contact is opened). Uses the raw
   * DocumentClient instead of dynamoose — dynamoose's per-item Item/schema
   * machinery dominates list latency at 1,200+ rows (~9x slower than a plain
   * projected scan, measured), and a read-only list needs no validation.
   */
  async getContactsSummary(): Promise<Record<string, unknown>[]> {
    try {
      const items: Record<string, unknown>[] = [];
      let lastKey: Record<string, unknown> | undefined = undefined;
      do {
        const page = (await this.documentClient.send(
          new ScanCommand({
            TableName: 'BTCTutoring-Contacts-Table',
            ProjectionExpression: '#id, #fn, #ln, #em, #ph, #sv, #ug, #st',
            ExpressionAttributeNames: {
              '#id': 'id',
              '#fn': 'first_name',
              '#ln': 'last_name',
              '#em': 'email',
              '#ph': 'phone_number',
              '#sv': 'service',
              '#ug': 'user_group',
              '#st': 'status',
            },
            ExclusiveStartKey: lastKey,
          }),
        )) as unknown as SummaryScanPage;
        items.push(...(page.Items ?? []));
        lastKey = page.LastEvaluatedKey;
      } while (lastKey);
      return items;
    } catch (error) {
      Logger.error((error as Error).message, error);
      return Promise.reject(error as Error);
    }
  }

  /** Admin users (user_group=Admins) — reminder digest recipients. */
  async getAdminContacts() {
    return ContactsModel.scan({
      user_group: { eq: 'Admins' },
    })
      .all()
      .exec()
      .then((contacts) => {
        return contacts;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  /** Current staff only (service=Hiring, status=Staff) — the tutor dropdowns. */
  async getStaffContacts() {
    return ContactsModel.scan({
      service: { eq: 'Hiring' },
      status: { eq: 'Staff' },
    })
      .all()
      .exec()
      .then((contacts) => {
        return contacts;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  /**
   * A contact's unique identifier is their email. Compares case-insensitively
   * (and ignoring surrounding whitespace) so Jane@x.com can't duplicate
   * jane@x.com.
   */
  private async findByEmail(email: string): Promise<Contact | undefined> {
    const normalized = email.trim().toLowerCase();
    const contacts = (await ContactsModel.scan()
      .all()
      .exec()) as unknown as Contact[];
    return contacts.find((c) => c.email?.trim().toLowerCase() === normalized);
  }

  async createContact(contact: Contact) {
    if (contact.email && (await this.findByEmail(contact.email))) {
      throw new ConflictException('A contact with this email already exists.');
    }
    const newUuid: string = randomUUID();
    const newContact = new ContactsModel({
      id: newUuid,
      first_name: contact.first_name,
      last_name: contact.last_name,
      email: contact.email,
      phone_number: contact.phone_number,
      service: contact.service,
      status: contact.status,
      billing_cycle: contact.billing_cycle,
      sibling_discount: contact.sibling_discount,
      cc_authorization_received: contact.cc_authorization_received,
      twenty_five_deducted: contact.twenty_five_deducted,
      special_circumstance: contact.special_circumstance,
      scholarship_state: contact.scholarship_state,
      invoice_Month: contact.invoice_Month,
      date_funds_requested_by_btc: contact.date_funds_requested_by_btc,
      date_funds_requested_by_family: contact.date_funds_requested_by_family,
      invoice_number: contact.invoice_number,
      invoice_paid_date: contact.invoice_paid_date,
      inquiry_received: contact.inquiry_received,
      inquiry_note_from_parent: contact.inquiry_note_from_parent,
      consult_date: contact.consult_date,
      twenty_five_received: contact.twenty_five_received,
      twenty_five_status: contact.twenty_five_status,
      scholarship_student: contact.scholarship_student,
      scholarship_name: contact.scholarship_name,
      trial_date: contact.trial_date,
      registration_sent: contact.registration_sent,
      registration_received: contact.registration_received,
      title: contact.title,
      currently_accepting_students: contact.currently_accepting_students,
      is_tutor: contact.is_tutor,
      availability: contact.availability?.map((block) => ({
        days: block.days,
        start_time: block.start_time,
        end_time: block.end_time,
      })),
      zoom_link: contact.zoom_link,
      hourly_rate: contact.hourly_rate,
      hiring_inquiry_received: contact.hiring_inquiry_received,
      interview_offer_sent: contact.interview_offer_sent,
      interview_scheduled: contact.interview_scheduled,
      offer_sent: contact.offer_sent,
      onboarding_paperwork_received: contact.onboarding_paperwork_received,
      training_completed: contact.training_completed,
      user_profile_created: contact.user_profile_created,
      user_group: contact.user_group,
    });
    return newContact
      .save()
      .then(() => {
        return Promise.resolve({
          id: newUuid,
          message: 'Contact created successfully.',
        });
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  /**
   * Drops undefined entries from an update payload. The app omits
   * form-disabled fields entirely (e.g. `status` for a non-admin saving their
   * own page), and writing those through as undefined would erase stored
   * values — a status wipe would silently drop a tutor off the staff scans.
   * Empty strings still pass through, so deliberate clears keep working.
   */
  private stripUndefined(
    attributes: Record<string, unknown>,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(attributes).filter(([, value]) => value !== undefined),
    );
  }

  async updateContact(contact: Contact) {
    return ContactsModel.update(
      {
        id: contact.id,
      },
      this.stripUndefined({
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email,
        phone_number: contact.phone_number,
        service: contact.service,
        status: contact.status,
        billing_cycle: contact.billing_cycle,
        sibling_discount: contact.sibling_discount,
        cc_authorization_received: contact.cc_authorization_received,
        twenty_five_deducted: contact.twenty_five_deducted,
        special_circumstance: contact.special_circumstance,
        scholarship_state: contact.scholarship_state,
        invoice_Month: contact.invoice_Month,
        date_funds_requested_by_btc: contact.date_funds_requested_by_btc,
        date_funds_requested_by_family: contact.date_funds_requested_by_family,
        invoice_number: contact.invoice_number,
        invoice_paid_date: contact.invoice_paid_date,
        inquiry_received: contact.inquiry_received,
        inquiry_note_from_parent: contact.inquiry_note_from_parent,
        consult_date: contact.consult_date,
        twenty_five_received: contact.twenty_five_received,
        twenty_five_status: contact.twenty_five_status,
        scholarship_student: contact.scholarship_student,
        scholarship_name: contact.scholarship_name,
        trial_date: contact.trial_date,
        registration_sent: contact.registration_sent,
        registration_received: contact.registration_received,
        title: contact.title,
        currently_accepting_students: contact.currently_accepting_students,
        is_tutor: contact.is_tutor,
        availability: contact.availability?.map((block) => ({
          days: block.days,
          start_time: block.start_time,
          end_time: block.end_time,
        })),
        zoom_link: contact.zoom_link,
        hourly_rate: contact.hourly_rate,
        hiring_inquiry_received: contact.hiring_inquiry_received,
        interview_offer_sent: contact.interview_offer_sent,
        interview_scheduled: contact.interview_scheduled,
        offer_sent: contact.offer_sent,
        onboarding_paperwork_received: contact.onboarding_paperwork_received,
        training_completed: contact.training_completed,
        user_profile_created: contact.user_profile_created,
        user_group: contact.user_group,
      }),
    )
      .then((updatedContact) => {
        return updatedContact;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async deleteContact(id: string) {
    return ContactsModel.delete({
      id: id,
    })
      .then(() => {
        return Promise.resolve({
          id: id,
          message: 'Contact deleted successfully.',
        });
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }
}
