import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DynamodbModule } from './dynamodb/dynamodb.module';
import { UsersService } from './users/users.service';
import { UsersController } from './users/users.controller';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { JwtStrategy } from './auth/jwt.strategy';

@Module({
  imports: [DynamodbModule.forRoot(), AuthModule, ConfigModule.forRoot()],
  controllers: [AppController, UsersController],
  providers: [AppService, UsersService, JwtStrategy],
})
export class AppModule {}
