import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PackageChangeNoticeService } from './package-change-notice.service';
import { SessionsModule } from '../sessions/sessions.module';
import { ContactsModule } from '../contacts/contacts.module';
import { StudentsModule } from '../students/students.module';

@Module({
  imports: [SessionsModule, ContactsModule, StudentsModule],
  providers: [NotificationsService, PackageChangeNoticeService],
})
export class NotificationsModule {}
