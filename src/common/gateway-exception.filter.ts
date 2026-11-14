import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { sendGatewayError } from './gateway-error';

const ERROR_CODES: Record<number, string> = {
  400: 'bad_request',
  404: 'not_found',
  405: 'method_not_allowed',
  413: 'payload_too_large',
};

/** Gives Nest's own errors (unknown route, etc.) the gateway's JSON error shape. */
@Catch()
export class GatewayExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Gateway');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      sendGatewayError(
        res,
        status,
        ERROR_CODES[status] ?? `http_${status}`,
        exception.message,
      );
      return;
    }

    this.logger.error(
      exception instanceof Error ? exception.stack : String(exception),
    );
    sendGatewayError(res, 500, 'internal_error', 'Unexpected gateway error');
  }
}
