import { Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as http from 'node:http';
import * as https from 'node:https';
import { GatewayConfig } from '../config/gateway-config';
import { sendGatewayError } from '../common/gateway-error';
import { REQUEST_ID_HEADER } from '../common/request-id.middleware';

/** Headers that belong to one connection and must not be forwarded. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export interface ForwardOptions {
  /** Name used in logs: "mcp", "ml", "frontend"... */
  service: string;
  /** Base URL of the service, from the environment. */
  target: string;
  /** Path on the service, e.g. "/predict". The query string is copied as is. */
  path: string;
  /** Time allowed until the service starts answering. */
  timeoutMs: number;
  /** API routes: drop the service's CORS headers, the gateway owns CORS. */
  stripCors?: boolean;
}

/**
 * Streams a request to a service and streams the answer back.
 *
 * The gateway never parses bodies: it does not know the /chat or /predict schemas,
 * so it does not change when those contracts do, and a streamed answer passes
 * through untouched. Status codes and bodies returned by a service are forwarded
 * unchanged; only "unreachable" (502) and "too slow" (504) are produced here.
 */
@Injectable()
export class ProxyService {
  private readonly logger = new Logger('Proxy');

  constructor(private readonly config: GatewayConfig) {}

  forward(req: Request, res: Response, options: ForwardOptions): void {
    const startedAt = Date.now();
    const requestId = String(req.headers[REQUEST_ID_HEADER] ?? '-');
    const { maxBodyBytes } = this.config;

    const describe = (outcome: string) =>
      `${req.method} ${req.originalUrl} -> ${options.service} ${outcome} ` +
      `${Date.now() - startedAt}ms rid=${requestId}`;

    if (Number(req.headers['content-length'] ?? 0) > maxBodyBytes) {
      this.logger.warn(describe('413 (not forwarded)'));
      sendGatewayError(res, 413, 'payload_too_large', bodyLimit(maxBodyBytes));
      return;
    }

    const url = new URL(options.target + options.path);
    const queryStart = req.originalUrl.indexOf('?');
    if (queryStart !== -1) url.search = req.originalUrl.slice(queryStart);

    const transport = url.protocol === 'https:' ? https : http;
    const upstream = transport.request(url, {
      method: req.method,
      headers: this.requestHeaders(req),
    });

    // "settled" = the outcome of this request is decided (answer started, error
    // sent, or client gone). Whatever happens afterwards must not answer again.
    let settled = false;

    const fail = (status: number, error: string, detail: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.logger.warn(describe(`${status} ${error}`));
      sendGatewayError(res, status, error, detail);
    };

    const timer = setTimeout(() => {
      fail(
        504,
        'upstream_timeout',
        `The ${options.service} service did not answer within ${options.timeoutMs} ms`,
      );
      upstream.destroy();
    }, options.timeoutMs);

    upstream.on('response', (upstreamRes) => {
      if (settled) {
        upstreamRes.resume();
        return;
      }
      settled = true;
      clearTimeout(timer);

      res.status(upstreamRes.statusCode ?? 502);
      for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (value === undefined || HOP_BY_HOP.has(name)) continue;
        if (options.stripCors && name.startsWith('access-control-')) continue;
        res.setHeader(name, value);
      }
      upstreamRes.on('error', () => res.destroy());
      upstreamRes.pipe(res);
      this.logger.log(describe(String(upstreamRes.statusCode)));
    });

    upstream.on('error', () => {
      fail(
        502,
        'upstream_unavailable',
        `The ${options.service} service is not reachable`,
      );
    });

    // The client went away before the answer finished: stop the upstream call.
    res.on('close', () => {
      if (res.writableFinished) return;
      settled = true;
      clearTimeout(timer);
      upstream.destroy();
    });

    // Bodies sent without Content-Length are counted while they stream.
    let received = 0;
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBodyBytes) {
        req.unpipe(upstream);
        req.resume();
        fail(413, 'payload_too_large', bodyLimit(maxBodyBytes));
        upstream.destroy();
      }
    });

    req.pipe(upstream);
  }

  private requestHeaders(req: Request): http.OutgoingHttpHeaders {
    const headers: http.OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(req.headers)) {
      // "host" is left out so Node sets it to the service's own host.
      if (value === undefined || name === 'host' || HOP_BY_HOP.has(name)) {
        continue;
      }
      headers[name] = value;
    }

    const clientIp = req.socket.remoteAddress ?? '';
    const forwardedFor = req.headers['x-forwarded-for'];
    headers['x-forwarded-for'] = forwardedFor
      ? `${String(forwardedFor)}, ${clientIp}`
      : clientIp;
    headers['x-forwarded-proto'] = req.protocol;
    if (req.headers.host) headers['x-forwarded-host'] = req.headers.host;
    return headers;
  }
}

function bodyLimit(maxBodyBytes: number): string {
  return `Request bodies are limited to ${maxBodyBytes} bytes`;
}
