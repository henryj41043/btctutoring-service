/**
 * One-off: re-freeze a closed month for the families named on the command
 * line, under the current billing rule (the straddling-weeks rule shipped
 * 2026-10-14). Prints each family's stored statement next to the new one;
 * writes only with --execute. The same calculation as the service's
 * POST /billing/statements/refreeze, run locally with the real tables.
 *
 * Usage (from the repo root; prefix with
 * `eval "$(aws configure export-credentials --format env)"`):
 *   npx ts-node scripts/refreeze-families.ts 2026-09 "Soren Davison" "Mya Puccio"
 *   npx ts-node scripts/refreeze-families.ts 2026-09 "Soren Davison" --execute
 */
import 'dotenv/config';
import { StudentsModel } from '../src/models/students.model';
import { ContactsModel } from '../src/models/contacts.model';
import { PackagesModel } from '../src/models/packages.model';
import { BillingModel } from '../src/models/billing.model';
import { Student } from '../src/models/student.model';
import { Contact } from '../src/models/contact.model';
import { BillingRecord } from '../src/models/billing-record.model';
import { PackageRow } from '../src/models/package-row.model';
import { PackageCatalog } from '../src/billing/package-config';
import {
  buildStatement,
  parseMonth,
  Statement,
  StatementLine,
} from '../src/billing/statement-engine';

const lineText = (l: StatementLine): string =>
  `${l.student_name}: ${l.package} ${l.from}→${l.to} ${l.sessions_billed}/${l.sessions_in_month} $${l.amount} [${l.flags.join(',')}]`;

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== '--execute');
  const execute = process.argv.includes('--execute');
  const [month, ...names] = args;
  const parsed = parseMonth(month ?? '');
  if (!parsed || names.length === 0) {
    throw new Error('usage: refreeze-families.ts YYYY-MM "Student name"...');
  }
  const [students, contacts, packages, records] = await Promise.all([
    StudentsModel.scan().all().exec() as unknown as Promise<Student[]>,
    ContactsModel.scan().all().exec() as unknown as Promise<Contact[]>,
    PackagesModel.scan().all().exec() as unknown as Promise<PackageRow[]>,
    BillingModel.scan()
      .where('period_start')
      .beginsWith(month)
      .all()
      .exec() as unknown as Promise<BillingRecord[]>,
  ]);
  const catalog: PackageCatalog = {};
  for (const row of packages) {
    catalog[row.id] = {
      monthlyCost: row.monthlyCost,
      sessionsPerWeek: row.sessionsPerWeek,
      sessionLengthMin: row.sessionLengthMin,
      retired: !!row.retired,
    };
  }
  const contactIds = new Set<string>();
  for (const name of names) {
    const student = students.find((s) => s.name === name);
    if (!student) throw new Error(`No student named ${name}`);
    contactIds.add(student.contact_id);
  }
  const frozenAt = new Date().toISOString();
  for (const contactId of contactIds) {
    const contact = contacts.find((c) => c.id === contactId);
    if (!contact) throw new Error(`No contact ${contactId}`);
    const id = `stmt#${contactId}#${month}`;
    const stored = (await BillingModel.get({ id })) as unknown as
      | { statement?: string }
      | undefined;
    const before = stored?.statement
      ? (JSON.parse(stored.statement) as Statement)
      : null;
    const after = buildStatement(
      contact,
      students,
      records,
      parsed.year,
      parsed.month,
      catalog,
    );
    console.log(
      `\n== ${contact.first_name} ${contact.last_name} (${contactId}) ${month}`,
    );
    console.log(`  stored: total $${before?.total ?? 'none'}`);
    for (const l of before?.lines ?? []) console.log(`    ${lineText(l)}`);
    console.log(`  new:    total $${after?.total ?? 'none'}`);
    for (const l of after?.lines ?? []) console.log(`    ${lineText(l)}`);
    if (!after) {
      console.log('  nothing to bill: left as is');
      continue;
    }
    if (!execute) continue;
    await BillingModel.create(
      {
        id,
        contact_id: contactId,
        statement_month: month,
        frozen_at: frozenAt,
        statement: JSON.stringify({ ...after, frozen_at: frozenAt }),
      },
      { overwrite: true },
    );
    console.log('  re-frozen');
  }
  console.log(execute ? '\nDone.' : '\nDry run: nothing written.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
