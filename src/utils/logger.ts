import { createLogger, transports, format } from 'winston';

export const logger = createLogger({
  format: format.combine(format.timestamp(), format.splat(), format.simple()),
  transports: [
    // Логируем всё в консоль (включая цвет)
    new transports.Console({
      format: format.combine(format.colorize({ all: true }), format.simple()),
    }),

    new transports.File({ filename: 'service.log' }),

    new transports.File({ filename: 'error.log', level: 'error' }),
  ],
});
