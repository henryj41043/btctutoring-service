import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import compression from 'compression';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Gzip responses — collection endpoints ship hundreds of KB of JSON that
  // compresses ~10x, which dominates load time on slower connections.
  app.use(compression());
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.enableCors({
    origin: ['http://localhost:4200', 'https://btchub.bitshiftstudio.io'],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    allowedHeaders: 'Content-Type, Accept, Authorization, X-ID-Token',
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap().catch((error: Error) => {
  Logger.error('Error during application bootstrap:', error.stack);
});
