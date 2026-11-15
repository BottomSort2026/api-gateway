import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GatewayConfig } from '../config/gateway-config';
import { ProxyService } from '../proxy/proxy.service';

/**
 * Flame Lab. Both routes go to the MCP service, under the same path. The MCP calls the
 * engine, which is internal: no public route reaches it.
 *   POST /lab/predict    -> `${MCP_URL}/lab/predict`
 *   GET  /lab/model-info -> `${MCP_URL}/lab/model-info`
 * The contracts belong to the MCP (its README), so bodies are forwarded as is.
 * /lab/predict waits for an LLM explanation, so it gets the same timeout as /chat.
 */
@Controller('lab')
export class LabController {
  constructor(
    private readonly config: GatewayConfig,
    private readonly proxy: ProxyService,
  ) {}

  @Post('predict')
  predict(@Req() req: Request, @Res() res: Response): void {
    this.forward(req, res, '/lab/predict', this.config.chatTimeoutMs);
  }

  @Get('model-info')
  modelInfo(@Req() req: Request, @Res() res: Response): void {
    this.forward(req, res, '/lab/model-info', this.config.upstreamTimeoutMs);
  }

  private forward(
    req: Request,
    res: Response,
    path: string,
    timeoutMs: number,
  ): void {
    this.proxy.forward(req, res, {
      service: 'mcp',
      target: this.config.mcpUrl,
      path,
      timeoutMs,
      stripCors: true,
    });
  }
}
