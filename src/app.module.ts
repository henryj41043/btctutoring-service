import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DynamodbModule } from './dynamodb/dynamodb.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { JwtStrategy } from './guards/jwt.strategy';
import { PassportModule } from '@nestjs/passport';
import { ScheduleModule } from '@nestjs/schedule';
import { SessionsModule } from './sessions/sessions.module';
import { ContactsModule } from './contacts/contacts.module';
import { StudentsModule } from './students/students.module';
import { NotesModule } from './notes/notes.module';
import { RemindersModule } from './reminders/reminders.module';
import { TeamsModule } from './teams/teams.module';
import { NotificationsModule } from './notifications/notifications.module';
import { BillingModule } from './billing/billing.module';
import { EmailsModule } from './emails/emails.module';
import { ScholarshipsModule } from './scholarships/scholarships.module';

@Module({
  imports: [
    DynamodbModule.forRoot(),
    AuthModule,
    ConfigModule.forRoot(),
    PassportModule.register({}),
    ScheduleModule.forRoot(),
    SessionsModule,
    ContactsModule,
    StudentsModule,
    NotesModule,
    RemindersModule,
    TeamsModule,
    NotificationsModule,
    BillingModule,
    EmailsModule,
    ScholarshipsModule,
  ],
  controllers: [AppController],
  providers: [AppService, JwtStrategy],
  exports: [PassportModule],
})
export class AppModule {}
