
import { ErrorRequestHandler } from 'express';

export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  // Temporary diagnostic logging: backend terminal only
  console.error('[DevSentry API Error]', {
    name: error?.name,
    message: error?.message,
    code: error?.code,
    status: error?.status,
    stack: error?.stack,
  });

  if (res.headersSent) {
    return next(error);
  }

  const status =
    typeof error?.status === 'number' ? error.status : 500;

  const message =
    status < 500 ? error.message : 'Internal server error';

  res.status(status).json({
    error: {
      code: status === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR',
      message,
      ...(status < 500 && error?.details
        ? { details: error.details }
        : {}),
    },
  });
};
