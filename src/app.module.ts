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
import { NotificationsModule } from './notifications/notifications.module';

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
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [AppService, JwtStrategy],
  exports: [PassportModule],
})
export class AppModule {}
