import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

export function validateBody(schema: ZodType): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
      res.status(400).json({ error: 'Check your details and try again.', fields });
      return;
    }
    req.body = result.data;
    next();
  };
}
