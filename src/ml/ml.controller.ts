import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GatewayConfig } from '../config/gateway-config';
import { ProxyService } from '../proxy/proxy.service';

/**
 * Simulator view. The public /ml prefix is removed before reaching the ML service:
 *   GET  /ml/model-info -> `${ML_URL}/model-info`
 *   POST /ml/predict    -> `${ML_URL}/predict`
 * The prediction target is OPEN, so inputs and outputs are forwarded as is.
 */
@Controller('ml')
export class MlController {
  constructor(
    private readonly config: GatewayConfig,
    private readonly proxy: ProxyService,
  ) {}

  @Get('model-info')
  modelInfo(@Req() req: Request, @Res() res: Response): void {
    this.forward(req, res, '/model-info');
  }

  @Post('predict')
  predict(@Req() req: Request, @Res() res: Response): void {
    this.forward(req, res, '/predict');
  }

  private forward(req: Request, res: Response, path: string): void {
    this.proxy.forward(req, res, {
      service: 'ml',
      target: this.config.mlUrl,
      path,
      timeoutMs: this.config.upstreamTimeoutMs,
      stripCors: true,
    });
  }
}
