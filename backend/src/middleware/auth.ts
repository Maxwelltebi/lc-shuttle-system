import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { ApiError, ApiErrorCode, Role } from '../../../shared/types';
import { Driver, Student } from '../models/index.js';

const SECRET = process.env.JWT_SECRET ?? 'lc-shuttle-dev-secret';
const TOKEN_TTL = '7d';

export interface TokenPayload {
  sub: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: TokenPayload;
      /** The loaded Student or Driver document for this request. */
      account?: any;
    }
  }
}

export function issueToken(payload: TokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: TOKEN_TTL });
}

/** Send an error in the exact shape the frontend's ApiError expects. */
export function fail(
  res: Response,
  status: number,
  code: ApiErrorCode,
  message: string,
  fields?: Record<string, string>,
): Response {
  const body: ApiError = { code, message, ...(fields ? { fields } : {}) };
  return res.status(status).json(body);
}

/** Requires a valid token and loads the account. */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return fail(res, 401, 'unauthorized', 'Sign in to continue.');
  }

  let payload: TokenPayload;
  try {
    payload = jwt.verify(header.slice(7), SECRET) as TokenPayload;
  } catch {
    return fail(res, 401, 'unauthorized', 'Your session has expired.');
  }

  /* Deliberately outside the try above. Wrapping the lookup in the same
     catch reports a database failure as an expired session, which sends
     you hunting through JWT config for a problem that is not there. */
  const account =
    payload.role === 'driver'
      ? await Driver.findById(payload.sub)
      : await Student.findById(payload.sub);

  if (!account) {
    return fail(res, 401, 'unauthorized', 'That account no longer exists.');
  }

  req.auth = payload;
  req.account = account;
  return next();
}

/** Restricts a route to one role. */
export function requireRole(role: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.auth?.role !== role) {
      return fail(
        res,
        403,
        'forbidden',
        role === 'driver'
          ? 'Only drivers can do that.'
          : 'Only students can do that.',
      );
    }
    return next();
  };
}

/**
 * Drivers must be approved by staff before they can go on duty or touch
 * the queue. Without this gate, anyone with a school email could
 * broadcast fake bus positions.
 */
export function requireApprovedDriver(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.account?.approved) {
    return fail(
      res,
      403,
      'not_approved',
      'Your driver account is waiting on approval from transportation staff.',
    );
  }
  return next();
}
