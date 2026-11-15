import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { sendGatewayError } from '../common/gateway-error';
import { GatewayConfig } from '../config/gateway-config';

/** Public name of the file: the route and the name the browser saves it under. */
export const TRAINING_DATA_FILE = 'flex-training.csv';

/**
 * Data files the gateway serves itself, like profiles.json in static mode. There is no
 * database yet, so the file lives in this repository (data/) and ships in the image.
 *   GET /datasets/flex-training.csv -> the cleaned FLEX tests the Flame Lab was trained on
 * The file is streamed as stored: never parsed or rewritten.
 */
@Controller('datasets')
export class DatasetsController {
  constructor(private readonly config: GatewayConfig) {}

  @Get(TRAINING_DATA_FILE)
  trainingData(@Res() res: Response): void {
    const file = createReadStream(this.config.trainingDataPath);
    file.once('error', () => {
      sendGatewayError(
        res,
        404,
        'training_data_missing',
        'the training data CSV is not available to the gateway',
      );
    });
    file.once('open', () => {
      res.status(200);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${TRAINING_DATA_FILE}"`,
      );
      res.setHeader('Cache-Control', 'no-cache');
      file.pipe(res);
    });
  }
}
