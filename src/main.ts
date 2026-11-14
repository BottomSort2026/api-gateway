import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { GatewayConfig } from './config/gateway-config';

async function bootstrap() {
  // Local development: read .env when it exists. In Compose the variables come
  // from the environment and there is no .env file.
  try {
    process.loadEnvFile();
  } catch {
    // no .env file
  }

  // The gateway streams bodies to the services and never parses them.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  configureApp(app);
  await app.listen(app.get(GatewayConfig).port);
}
void bootstrap();
