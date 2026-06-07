import { Injectable, Logger } from '@nestjs/common';
import { ContactsModel } from '../models/contacts.model';
import { Contact } from '../models/contact.model';
import { randomUUID } from 'crypto';

@Injectable()
export class ContactsService {
  async getContact(id: string) {
    return ContactsModel.scan({
      id: { eq: id },
    })
      .exec()
      .then((contacts) => {
        return contacts;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async getContacts() {
    return ContactsModel.scan()
      .exec()
      .then((contacts) => {
        return contacts;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async createContact(contact: Contact) {
    const newUuid: string = randomUUID();
    const newContact = new ContactsModel({
      id: newUuid,
      first_name: contact.first_name,
      last_name: contact.last_name,
      email: contact.email,
      phone_number: contact.phone_number,
      service: contact.service,
      status: contact.status,
      monthly_charge: contact.monthly_charge,
      charge_per_billing_cycle: contact.charge_per_billing_cycle,
      amount_to_be_paid_this_month: contact.amount_to_be_paid_this_month,
      billing_cycle: contact.billing_cycle,
      cc_authorization_received: contact.cc_authorization_received,
      twenty_five_deducted: contact.twenty_five_deducted,
      payment_one_received: contact.payment_one_received,
      payment_two_received: contact.payment_two_received,
      payment_three_received: contact.payment_three_received,
      payment_four_received: contact.payment_four_received,
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
      scholarship_student: contact.scholarship_student,
      scholarship_name: contact.scholarship_name,
      trial_date: contact.trial_date,
      registration_sent: contact.registration_sent,
      registration_received: contact.registration_received,
      title: contact.title,
      currently_accepting_students: contact.currently_accepting_students,
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

  async updateContact(contact: Contact) {
    return ContactsModel.update(
      {
        id: contact.id,
      },
      {
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email,
        phone_number: contact.phone_number,
        service: contact.service,
        status: contact.status,
        monthly_charge: contact.monthly_charge,
        charge_per_billing_cycle: contact.charge_per_billing_cycle,
        amount_to_be_paid_this_month: contact.amount_to_be_paid_this_month,
        billing_cycle: contact.billing_cycle,
        cc_authorization_received: contact.cc_authorization_received,
        twenty_five_deducted: contact.twenty_five_deducted,
        payment_one_received: contact.payment_one_received,
        payment_two_received: contact.payment_two_received,
        payment_three_received: contact.payment_three_received,
        payment_four_received: contact.payment_four_received,
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
        scholarship_student: contact.scholarship_student,
        scholarship_name: contact.scholarship_name,
        trial_date: contact.trial_date,
        registration_sent: contact.registration_sent,
        registration_received: contact.registration_received,
        title: contact.title,
        currently_accepting_students: contact.currently_accepting_students,
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
      },
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
