import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { AutoRenewService } from './auto-renew.service';
import { StudentsModule } from '../students/students.module';
import { SessionsModule } from '../sessions/sessions.module';
import { ContactsModule } from '../contacts/contacts.module';
import { PackagesModule } from '../packages/packages.module';

@Module({
  imports: [StudentsModule, SessionsModule, ContactsModule, PackagesModule],
  controllers: [BillingController],
  providers: [BillingService, AutoRenewService],
  exports: [BillingService],
})
export class BillingModule {}
