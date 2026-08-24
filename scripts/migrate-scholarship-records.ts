/**
 * One-off migration: fold each contact's single-valued scholarship checklist
 * fields into a month-keyed scholarship record (id = `${contact_id}#${month}`)
 * so history survives month-end clearing. Contacts whose six scholarship
 * fields are all empty are skipped; the contact's own fields are left in
 * place (harmlessly stale — the app no longer reads or writes them).
 *
 * Creates use dynamoose Model.create (implicit attribute_not_exists), so
 * re-runs are safe: existing records are counted as "skipped (exists)".
 *
 * Usage (from the repo root, with .env providing AWS creds/region):
 *   npx ts-node scripts/migrate-scholarship-records.ts                    # dry run
 *   npx ts-node scripts/migrate-scholarship-records.ts --month=2026-08   # dry run, pinned month
 *   npx ts-node scripts/migrate-scholarship-records.ts --execute         # apply
 */
import 'dotenv/config';
import { ContactsModel } from '../src/models/contacts.model';
import { Contact } from '../src/models/contact.model';
import { ScholarshipsModel } from '../src/models/scholarships.model';
import { ScholarshipsService } from '../src/scholarships/scholarships.service';

const FIELDS = [
  'scholarship_state',
  'invoice_Month',
  'date_funds_requested_by_btc',
  'date_funds_requested_by_family',
  'invoice_number',
  'invoice_paid_date',
] as const;

/** True when the contact carries any scholarship checklist value to migrate. */
export function hasScholarshipData(contact: Contact): boolean {
  return FIELDS.some((field) => {
    const value = (contact as unknown as Record<string, unknown>)[field];
    return value !== undefined && value !== null && value !== '';
  });
}

function targetMonth(): string {
  const pinned = process.argv.find((a) => a.startsWith('--month='));
  if (pinned) {
    const month = pinned.slice('--month='.length);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new Error(`--month must be YYYY-MM, got '${month}'`);
    }
    return month;
  }
  const now = new Date();
  return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
}

function isAlreadyExists(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? '';
  const message = (error as { message?: string })?.message ?? '';
  return (
    name === 'ConditionalCheckFailedException' ||
    message.includes('ConditionalCheckFailedException') ||
    message.includes('The conditional request failed')
  );
}

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const month = targetMonth();
  const contacts = (await ContactsModel.scan()
    .all()
    .exec()) as unknown as Contact[];
  const candidates = contacts.filter(hasScholarshipData);

  console.log(
    `Scanned ${contacts.length} contact(s); ${candidates.length} carry scholarship data.`,
  );
  console.log(`Target month: ${month}\n`);

  for (const contact of candidates) {
    const id = ScholarshipsService.recordId(contact.id!, month);
    const values = FIELDS.map(
      (f) => `${f}=${(contact as unknown as Record<string, unknown>)[f] ?? ''}`,
    ).join(', ');
    console.log(`${contact.first_name ?? ''} ${contact.last_name ?? ''} → ${id}`);
    console.log(`  ${values}`);
  }

  if (!execute) {
    console.log('\nDry run — nothing written. Re-run with --execute to apply.');
    return;
  }

  let created = 0;
  let skipped = 0;
  for (const contact of candidates) {
    const id = ScholarshipsService.recordId(contact.id!, month);
    try {
      await ScholarshipsModel.create({
        id,
        contact_id: contact.id,
        month,
        scholarship_state: contact.scholarship_state,
        invoice_Month: contact.invoice_Month,
        date_funds_requested_by_btc: contact.date_funds_requested_by_btc,
        date_funds_requested_by_family: contact.date_funds_requested_by_family,
        invoice_number: contact.invoice_number,
        invoice_paid_date: contact.invoice_paid_date,
      });
      created++;
    } catch (error) {
      if (isAlreadyExists(error)) {
        skipped++;
        console.log(`  skipped (exists): ${id}`);
      } else {
        throw error;
      }
    }
  }
  console.log(`\nCreated ${created} record(s); skipped ${skipped} existing.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
