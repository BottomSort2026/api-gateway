import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { requestId } from './common/request-id.middleware';
import { GatewayConfig } from './config/gateway-config';
import { ProxyService } from './proxy/proxy.service';

/**
 * Paths owned by the API. They must never be page routes in the frontend. A GET under any
 * other prefix goes to the frontend, so every new API prefix must be added here.
 * `ml` has no routes any more (the Flame Lab moved to /lab, and the engine is internal); it
 * stays reserved so an old client gets a JSON 404 instead of a page.
 */
const API_PATH = /^\/(health|profiles|chat|lab|ml)(\/|$)/;

/**
 * Everything that is configured on the HTTP server, shared by main.ts and the
 * e2e tests so both run the same application.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(GatewayConfig);
  const proxy = app.get(ProxyService);

  app.disable('x-powered-by');
  app.enableShutdownHooks();
  app.use(requestId);

  // The gateway is the only place that sets CORS headers.
  app.enableCors({
    origin: config.corsAllowedOrigin,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
    exposedHeaders: ['X-Request-ID'],
    maxAge: 600,
  });

  // Single entry point: anything that is not an API path is the frontend's
  // (pages and assets). Without FRONTEND_URL the gateway is API-only.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const isPageRequest = req.method === 'GET' || req.method === 'HEAD';
    if (!config.frontendUrl || !isPageRequest || API_PATH.test(req.path)) {
      next();
      return;
    }
    proxy.forward(req, res, {
      service: 'frontend',
      target: config.frontendUrl,
      path: req.path,
      timeoutMs: config.upstreamTimeoutMs,
    });
  });
}
