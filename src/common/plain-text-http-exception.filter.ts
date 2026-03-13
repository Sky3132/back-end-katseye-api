import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch(HttpException)
export class PlainTextHttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    const status = exception.getStatus();
    const payload = exception.getResponse() as
      | string
      | { message?: string | string[]; error?: string };

    const message =
      typeof payload === 'string'
        ? payload
        : Array.isArray(payload?.message)
          ? payload.message.join('\n')
          : (payload?.message ?? 'Request failed.');

    res.status(status).type('text/plain').send(message);
  }
}
