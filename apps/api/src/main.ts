import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http/all-exceptions.filter';
import { TransformInterceptor } from './common/http/transform.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const config = app.get(ConfigService);
  app.setGlobalPrefix('v1');
  const corsStr = config.get<string>('CORS_ORIGINS');
  const corsOrigins =
    corsStr
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  if (corsOrigins.length > 0) {
    app.enableCors({
      origin: corsOrigins,
      credentials: true,
    });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  const rawPort = config.get<string>('PORT') ?? '3333';
  const port = Number.parseInt(rawPort, 10);
  if (Number.isNaN(port)) {
    throw new Error(`PORT inválido: ${rawPort}`);
  }
  await app.listen(port);
  console.info(`API Nest a ouvir em http://localhost:${port}/v1`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
