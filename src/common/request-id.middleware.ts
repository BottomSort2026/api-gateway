import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Every request gets an id that is forwarded to the services and echoed to the
 * client, so one request can be followed across the logs of all services.
 */
export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' &&
    incoming.length > 0 &&
    incoming.length <= 128
      ? incoming
      : randomUUID();
  req.headers[REQUEST_ID_HEADER] = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}
