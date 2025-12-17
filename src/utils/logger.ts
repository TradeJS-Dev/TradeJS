import chalk from 'chalk';
import { createLogger, transports, format } from 'winston';

const baseFormat = format.combine(
  format.timestamp({ format: 'DD MMM HH:mm:ss' }),
  format.splat(),
);

export const logger = createLogger({
  format: baseFormat,
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize({ all: true }),
        format.printf(({ level, timestamp, message }) => `${level}: ${chalk.gray(timestamp)}: ${message}`),
      ),
    }),

    new transports.File({
      filename: 'service.log',
      format: format.combine(
        format.uncolorize(),
        format.printf(({ level, timestamp, message }) => `${level}: ${timestamp}: ${message}`),
      ),
    }),

    new transports.File({
      filename: 'error.log',
      format: format.combine(
        format.uncolorize(),
        format.printf(({ level, timestamp, message }) => `${level}: ${timestamp}: ${message}`),
      ),
      level: 'error',
    }),
  ],
});