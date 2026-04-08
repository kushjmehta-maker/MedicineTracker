import pino from 'pino';

// ─────────────────────────────────────────────────────────────────────────────
// Structured logger (pino)
//
// In development:  pretty-printed human-readable output via pino-pretty
// In production:   JSON lines to stdout (consumed by log aggregator)
// ─────────────────────────────────────────────────────────────────────────────

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    // Rename pino's `msg` field to `message` for compatibility with most log platforms
    messageKey: 'message',
    base: {
      service: 'medicine-tracker-backend',
      env: process.env.NODE_ENV ?? 'development',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label.toUpperCase() };
      },
    },
  },
  isDev
    ? pino.transport({
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
      })
    : undefined,
);

// Child loggers for each service — carry the service name automatically
export const ingestionLog = logger.child({ service: 'event-ingestion' });
export const computationLog = logger.child({ service: 'adherence-computation' });
export const strategyLog = logger.child({ service: 'notification-strategy' });
