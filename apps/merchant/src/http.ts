import type { Request, Response, NextFunction, RequestHandler } from "express";
import { z } from "zod";
import { ApolloError } from "./providers/apollo";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Validate a parsed JSON body against a zod schema, throwing a 400 on failure. */
export function parseBody<T extends z.ZodTypeAny>(body: unknown, schema: T): z.infer<T> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new HttpError(400, "Invalid request", parsed.error.flatten());
  }
  return parsed.data;
}

/** Wrap an async route handler so thrown/rejected errors reach the error middleware. */
export const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

/** Terminal error middleware — turns known errors into clean JSON responses. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  if (err instanceof ApolloError) {
    res.status(502).json({ error: "Upstream data provider error", detail: err.message });
    return;
  }
  console.error("[error]", err);
  res.status(500).json({ error: "Internal server error" });
}
