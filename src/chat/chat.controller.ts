import { Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GatewayConfig } from '../config/gateway-config';
import { ProxyService } from '../proxy/proxy.service';

/**
 * Chatbot view. POST /chat -> MCP agent `${MCP_URL}/chat`.
 * Only /chat reaches MCP: the MCP protocol endpoint is internal and never exposed.
 * The request and response schema is not fixed yet (ARCHITECTURE.md), so the body
 * is forwarded as is.
 */
@Controller('chat')
export class ChatController {
  constructor(
    private readonly config: GatewayConfig,
    private readonly proxy: ProxyService,
  ) {}

  @Post()
  chat(@Req() req: Request, @Res() res: Response): void {
    this.proxy.forward(req, res, {
      service: 'mcp',
      target: this.config.mcpUrl,
      path: '/chat',
      timeoutMs: this.config.chatTimeoutMs,
      stripCors: true,
    });
  }
}
