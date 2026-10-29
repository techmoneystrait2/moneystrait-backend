import type { ErrorRequestHandler, RequestHandler } from 'express';
import { HttpError } from './httpError';

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Not found.' });
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express needs all four arguments.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // Body-parser errors carry a 4xx status.
  const status = (err as { status?: number }).status;
  if (status && status >= 400 && status < 500) {
    res.status(status).json({ error: 'Invalid request.' });
    return;
  }
  // The name only: messages can contain personal data.
  console.error(`Unhandled error: ${(err as Error).name}`);
  res.status(500).json({ error: 'Something went wrong.' });
};
