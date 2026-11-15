import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ChatController } from './chat/chat.controller';
import { GatewayExceptionFilter } from './common/gateway-exception.filter';
import { GatewayConfig } from './config/gateway-config';
import { HealthController } from './health/health.controller';
import { LabController } from './lab/lab.controller';
import { ProfilesController } from './profiles/profiles.controller';
import { ProxyService } from './proxy/proxy.service';

@Module({
  controllers: [
    HealthController,
    ProfilesController,
    ChatController,
    LabController,
  ],
  providers: [
    {
      provide: GatewayConfig,
      useFactory: () => GatewayConfig.fromEnv(process.env),
    },
    ProxyService,
    { provide: APP_FILTER, useClass: GatewayExceptionFilter },
  ],
})
export class AppModule {}
