import { Request, Response, NextFunction, RequestHandler } from 'express';

/** Request with string route params (Express 5 types allow string[]; our routes never use repeated params). */
export type ApiRequest = Omit<Request, 'params'> & { params: Record<string, string> };

/** Wrap async route handlers so rejections reach the error middleware. */
export function asyncHandler(
  fn: (req: ApiRequest, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req as unknown as ApiRequest, res, next).catch(next);
  };
}
