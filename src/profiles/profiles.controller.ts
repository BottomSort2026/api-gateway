import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { sendGatewayError } from '../common/gateway-error';
import { GatewayConfig } from '../config/gateway-config';
import { ProxyService } from '../proxy/proxy.service';

/**
 * Information view. GET /profiles returns the investigation profiles.
 * Where they are hosted is OPEN (ARCHITECTURE.md §7), so both options work and the
 * choice is configuration only:
 *   PROFILES_MODE=static -> the offline-built profiles.json, mounted read-only
 *   PROFILES_MODE=proxy  -> `${PROFILES_UPSTREAM}/profiles` (default: the MCP service)
 */
@Controller('profiles')
export class ProfilesController {
  constructor(
    private readonly config: GatewayConfig,
    private readonly proxy: ProxyService,
  ) {}

  @Get()
  profiles(@Req() req: Request, @Res() res: Response): void {
    if (this.config.profilesMode === 'proxy') {
      this.proxy.forward(req, res, {
        service: 'profiles',
        target: this.config.profilesUpstream,
        path: '/profiles',
        timeoutMs: this.config.upstreamTimeoutMs,
        stripCors: true,
      });
      return;
    }

    const file = createReadStream(this.config.profilesPath);
    file.once('error', () => {
      sendGatewayError(
        res,
        404,
        'profiles_not_built',
        'profiles.json is not available to the gateway',
      );
    });
    file.once('open', () => {
      res.status(200);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      file.pipe(res);
    });
  }
}
