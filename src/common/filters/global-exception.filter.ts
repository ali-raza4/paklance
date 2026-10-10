import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse: any =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    const message =
      typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? exceptionResponse.message || exceptionResponse
        : exceptionResponse;

    // Log with full detail so Vercel runtime logs show the real cause
    const errName =
      exception instanceof Error
        ? exception.constructor.name
        : typeof exception;
    const errMsg =
      exception instanceof Error ? exception.message : String(exception);
    const errStack =
      exception instanceof Error ? exception.stack : '';

    this.logger.error(
      `[${errName}] HTTP ${status} | ${errMsg} | Path: ${request.url}`,
      errStack,
    );

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
      errorDetail: errMsg,
    });
  }
}

