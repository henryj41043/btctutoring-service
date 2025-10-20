import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DynamodbModule } from './dynamodb/dynamodb.module';
import { UsersService } from './users/users.service';
import { UsersController } from './users/users.controller';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { JwtStrategy } from './auth/jwt.strategy';
import { PassportModule } from '@nestjs/passport';
import { CognitoIdTokenStrategy } from './auth/cognito-id-token.strategy';
import { JwtService } from '@nestjs/jwt';

@Module({
  imports: [
    DynamodbModule.forRoot(),
    AuthModule,
    ConfigModule.forRoot(),
    PassportModule.register({}),
  ],
  controllers: [AppController, UsersController],
  providers: [
    AppService,
    UsersService,
    JwtStrategy,
    CognitoIdTokenStrategy,
    JwtService,
  ],
  exports: [PassportModule],
})
export class AppModule {}
