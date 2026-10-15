/**
 * One-off: the 'custom' billing cycle is gone (replaced by 'weekly',
 * 2026-10-14). The engine always billed it as monthly, so every contact
 * carrying it becomes 'monthly' outright.
 *
 * Usage (from the repo root; prefix with
 * `eval "$(aws configure export-credentials --format env)"`):
 *   npx ts-node scripts/migrate-custom-billing-cycle.ts             # dry run
 *   npx ts-node scripts/migrate-custom-billing-cycle.ts --execute   # apply
 */
import 'dotenv/config';
import { ContactsModel } from '../src/models/contacts.model';
import { Contact } from '../src/models/contact.model';

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const contacts = (await ContactsModel.scan()
    .all()
    .exec()) as unknown as Contact[];
  const custom = contacts.filter((c) => c.billing_cycle === 'custom');
  console.log(
    `Scanned ${contacts.length} contact(s); ${custom.length} carry billing_cycle 'custom'.`,
  );
  for (const contact of custom) {
    console.log(
      `  ${contact.first_name} ${contact.last_name} (${contact.id}) ${contact.status ?? ''}`,
    );
    if (!execute) continue;
    await ContactsModel.update(
      { id: contact.id },
      { billing_cycle: 'monthly' },
    );
    console.log('    -> monthly');
  }
  console.log(execute ? 'Done.' : 'Dry run: nothing written.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
