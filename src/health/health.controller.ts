import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  /** Liveness of the gateway itself. It does not depend on the other services. */
  @Get()
  health() {
    return { status: 'ok', service: 'gateway' };
  }
}
