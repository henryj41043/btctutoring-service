import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DynamodbModule } from './dynamodb/dynamodb.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { JwtStrategy } from './auth/jwt.strategy';
import { PassportModule } from '@nestjs/passport';
import { SessionsModule } from './sessions/sessions.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    DynamodbModule.forRoot(),
    AuthModule,
    ConfigModule.forRoot(),
    PassportModule.register({}),
    SessionsModule,
    UserModule,
  ],
  controllers: [AppController],
  providers: [AppService, JwtStrategy],
  exports: [PassportModule],
})
export class AppModule {}
