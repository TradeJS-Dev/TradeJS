import { createLogger, transports, format } from 'winston';

export const logger = createLogger({
  format: format.combine(
    format.timestamp(),
    format.colorize({ all: true }),
    format.splat(),
    format.simple(),
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'service.log' }),
  ],
});
