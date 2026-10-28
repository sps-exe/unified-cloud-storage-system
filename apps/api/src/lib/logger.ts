// =============================================================================
// UCSS API — Structured Logger (Pino)
// =============================================================================
// Outputs structured JSON logs. High-performance, zero worker thread overhead.

import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  // Without this, `{ error }` logs only own enumerable props and hides the message/stack (e.g. Google's reason).
  serializers: { error: pino.stdSerializers.err, err: pino.stdSerializers.err },
});
