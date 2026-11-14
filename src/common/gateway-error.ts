import type { Response } from 'express';

/** Shape of every error produced by the gateway itself. */
export interface GatewayErrorBody {
  error: string;
  detail: string;
}

export function sendGatewayError(
  res: Response,
  status: number,
  error: string,
  detail: string,
): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const body: GatewayErrorBody = { error, detail };
  res.status(status).json(body);
}
