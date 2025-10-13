import { DynamicModule, Module } from '@nestjs/common';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

@Module({})
export class DynamodbModule {
  static forRoot(): DynamicModule {
    return {
      module: DynamodbModule,
      providers: [
        {
          provide: DynamoDBDocumentClient,
          useValue: DynamoDBDocumentClient.from(new DynamoDBClient()),
        },
      ],
      exports: [DynamoDBDocumentClient],
    };
  }
}
