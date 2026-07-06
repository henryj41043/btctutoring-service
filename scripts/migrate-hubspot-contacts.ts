/**
 * One-off migration: legacy HubSpot contacts CSV → BTCTutoring DynamoDB.
 *
 * Reads the HubSpot export, maps each row to the new Contact shape (plus one
 * traceability Note per contact), and writes via the real dynamoose models so
 * items are schema-identical to app-created records.
 *
 * Usage (from the btctutoring-service repo root, with AWS credentials/region
 * configured in the environment — the same account the service runs in):
 *
 *   npx ts-node scripts/migrate-hubspot-contacts.ts --csv <path-to-export.csv>            # dry run (default)
 *   npx ts-node scripts/migrate-hubspot-contacts.ts --csv <path-to-export.csv> --execute  # write
 *
 * Behavior:
 * - DRY RUN by default: no writes; prints + saves the full report.
 * - Idempotent: existing contact emails (case-insensitive) are skipped, so the
 *   script is safely re-runnable after a partial failure.
 * - Rows with a blank email are skipped and listed (email is the unique key).
 * - Writes in batchPut chunks of 25 (DynamoDB limit), contacts before notes.
 */
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { ContactsModel } from '../src/models/contacts.model';
import { NotesModel } from '../src/models/notes.model';

// ── Locked mapping decisions (2026-07-06) ────────────────────────────────────
/** Program-aware legacy Service → new Service. */
const SERVICE_MAP: Record<string, string> = {
  'Tutoring': 'Tutoring',
  'BTC & Me': 'Tutoring',
  'BTC & Me/Tutoring': 'Tutoring',
  'Grade Level Testing': 'Tutoring',
  'IEP Review': 'Tutoring',
  'BTC Enrichment': 'Tutoring',
  'BTC Read With Me': 'Tutoring',
  'Hiring': 'Hiring',
  'Staff': 'Hiring',
  'Email List': 'Newsletter',
  'Networking': 'Newsletter',
  '': 'Newsletter',
};

/** Legacy Current Customer → new Status ('' = leave unset). */
const STATUS_MAP: Record<string, string> = {
  'YES': 'Active Student',
  'MIA': 'MIA',
  'EMPLOYEE': 'Staff',
  'INQUIRY': 'Onboarding',
  'NO': 'Past Student',
  'DECLINED SERVICES': 'Past Student',
  '': '',
};

interface LegacyRow {
  'Record ID': string;
  'First Name': string;
  'Last Name': string;
  'Service': string;
  'Email': string;
  'Phone Number': string;
  'Notes': string;
  'Current Customer': string;
  'Inquiry Date': string;
  'Interview Scheduled?': string;
  'Enrolled? (BTC & Me)': string;
}

interface MigrationContact {
  id: string;
  first_name?: string;
  last_name?: string;
  email: string;
  phone_number?: string;
  service: string;
  status?: string;
  inquiry_received?: string;
}

interface MigrationNote {
  id: string;
  message: string;
  date_time: string;
  author: string;
  author_id: string;
  recipient: string;
  recipient_id: string;
}

interface SkippedRow {
  reason: 'blank-email' | 'already-exists';
  record_id: string;
  name: string;
  email: string;
  phone: string;
  service: string;
}

/** digits-only; 11-digit leading-1 collapses to 10; otherwise keep the raw value. */
function normalizePhone(raw: string): string | undefined {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return undefined;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return trimmed; // unparseable — preserve as-is for manual cleanup
}

function traceabilityMessage(row: LegacyRow): string {
  const lines = [
    '[HubSpot import]',
    `Record ID: ${row['Record ID']}`,
    `Legacy Service: ${row['Service'] || '(blank)'}`,
    `Legacy Current Customer: ${row['Current Customer'] || '(blank)'}`,
  ];
  if ((row['Interview Scheduled?'] ?? '').trim()) {
    lines.push(`Interview Scheduled: ${row['Interview Scheduled?'].trim()}`);
  }
  if ((row['Enrolled? (BTC & Me)'] ?? '').trim()) {
    lines.push(`Enrolled (BTC & Me): ${row['Enrolled? (BTC & Me)'].trim()}`);
  }
  const notes = (row['Notes'] ?? '').trim();
  return notes ? `${lines.join('\n')}\n\n${notes}` : lines.join('\n');
}

function transform(row: LegacyRow): { contact: MigrationContact; note: MigrationNote } {
  const contactId = randomUUID();
  const legacyService = (row['Service'] ?? '').trim();
  const legacyCustomer = (row['Current Customer'] ?? '').trim().toUpperCase();
  const inquiry = (row['Inquiry Date'] ?? '').trim();

  // Staff rule: legacy Service=Staff OR Current Customer=EMPLOYEE → status Staff.
  let status = STATUS_MAP[legacyCustomer] ?? '';
  if (legacyService === 'Staff' || legacyCustomer === 'EMPLOYEE') {
    status = 'Staff';
  }

  const first = (row['First Name'] ?? '').trim();
  const last = (row['Last Name'] ?? '').trim();
  const contact: MigrationContact = {
    id: contactId,
    first_name: first || undefined,
    last_name: last || undefined,
    email: (row['Email'] ?? '').trim(),
    phone_number: normalizePhone(row['Phone Number']),
    service: SERVICE_MAP[legacyService] ?? 'Newsletter',
    status: status || undefined,
    inquiry_received: inquiry || undefined,
  };

  const note: MigrationNote = {
    id: randomUUID(),
    message: traceabilityMessage(row),
    date_time: inquiry ? new Date(`${inquiry}T00:00:00`).toISOString() : new Date().toISOString(),
    author: 'HubSpot Import',
    author_id: 'hubspot-import',
    recipient: [first, last].filter(Boolean).join(' '),
    recipient_id: contactId,
  };
  return { contact, note };
}

/** Drops undefined/empty values (dynamoose rejects null/undefined typed fields). */
function compact(obj: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function count(values: (string | undefined)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v || '(none)'] = (out[v || '(none)'] ?? 0) + 1;
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const csvFlag = args.indexOf('--csv');
  const csvPath = csvFlag >= 0 ? args[csvFlag + 1] : undefined;
  if (!csvPath || !fs.existsSync(csvPath)) {
    console.error('Usage: ts-node scripts/migrate-hubspot-contacts.ts --csv <file> [--execute]');
    process.exit(1);
  }

  const rows: LegacyRow[] = parse(fs.readFileSync(csvPath, 'utf-8'), {
    columns: true,
    bom: true,
    skip_empty_lines: true,
  }) as LegacyRow[];
  console.log(`Parsed ${rows.length} legacy rows from ${csvPath}`);

  // Existing emails (case-insensitive) for idempotent skipping.
  console.log('Scanning existing contacts for duplicate emails…');
  const existing = (await ContactsModel.scan().all().exec()) as unknown as {
    email?: string;
  }[];
  const existingEmails = new Set(
    existing.map((c) => (c.email ?? '').trim().toLowerCase()).filter(Boolean),
  );
  console.log(`${existing.length} existing contacts (${existingEmails.size} with emails).`);

  const contacts: MigrationContact[] = [];
  const notes: MigrationNote[] = [];
  const skipped: SkippedRow[] = [];
  const seenInCsv = new Set<string>();

  for (const row of rows) {
    const email = (row['Email'] ?? '').trim().toLowerCase();
    const skipInfo = {
      record_id: row['Record ID'],
      name: `${row['First Name'] ?? ''} ${row['Last Name'] ?? ''}`.trim(),
      email: (row['Email'] ?? '').trim(),
      phone: (row['Phone Number'] ?? '').trim(),
      service: (row['Service'] ?? '').trim(),
    };
    if (!email) {
      skipped.push({ reason: 'blank-email', ...skipInfo });
      continue;
    }
    if (existingEmails.has(email) || seenInCsv.has(email)) {
      skipped.push({ reason: 'already-exists', ...skipInfo });
      continue;
    }
    seenInCsv.add(email);
    const { contact, note } = transform(row);
    contacts.push(contact);
    notes.push(note);
  }

  const report = {
    mode: execute ? 'EXECUTE' : 'DRY RUN',
    csv: csvPath,
    parsed_rows: rows.length,
    to_migrate: contacts.length,
    notes_to_create: notes.length,
    skipped_count: skipped.length,
    service_mapping: count(contacts.map((c) => c.service)),
    status_mapping: count(contacts.map((c) => c.status)),
    with_inquiry_date: contacts.filter((c) => c.inquiry_received).length,
    with_phone: contacts.filter((c) => c.phone_number).length,
    skipped,
    sample_contacts: contacts.slice(0, 3),
    sample_note_message: notes[0]?.message,
  };

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(outDir, `migration-report-${stamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('\n===== MIGRATION REPORT =====');
  console.log(`Mode:            ${report.mode}`);
  console.log(`Parsed rows:     ${report.parsed_rows}`);
  console.log(`To migrate:      ${report.to_migrate} contacts + ${report.notes_to_create} notes`);
  console.log(`Skipped:         ${report.skipped_count}`);
  console.log(`Service mapping: ${JSON.stringify(report.service_mapping)}`);
  console.log(`Status mapping:  ${JSON.stringify(report.status_mapping)}`);
  console.log(`Full report:     ${reportPath}`);
  if (skipped.length) {
    console.log('\nSkipped rows:');
    for (const s of skipped) {
      console.log(`  [${s.reason}] ${s.record_id} ${s.name} <${s.email}> ${s.phone} (${s.service})`);
    }
  }

  if (!execute) {
    console.log('\nDry run complete — nothing written. Re-run with --execute to migrate.');
    return;
  }

  console.log('\nWriting contacts…');
  let written = 0;
  for (const batch of chunk(contacts.map(compact), 25)) {
    await ContactsModel.batchPut(batch as never[]);
    written += batch.length;
    process.stdout.write(`\r  contacts written: ${written}/${contacts.length}`);
  }
  console.log('\nWriting notes…');
  written = 0;
  for (const batch of chunk(notes.map(compact), 25)) {
    await NotesModel.batchPut(batch as never[]);
    written += batch.length;
    process.stdout.write(`\r  notes written: ${written}/${notes.length}`);
  }
  console.log(`\nDone. ${contacts.length} contacts + ${notes.length} notes migrated.`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
