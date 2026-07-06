import { Module } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { ContactsController } from './contacts.controller';
import { DynamodbModule } from '../dynamodb/dynamodb.module';

@Module({
  imports: [DynamodbModule.forRoot()],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
