import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { SessionsModule } from '../sessions/sessions.module';
import { ContactsModule } from '../contacts/contacts.module';

@Module({
  imports: [SessionsModule, ContactsModule],
  providers: [NotificationsService],
})
export class NotificationsModule {}
