import type { ApiError, ApiErrorCode } from '../types';

/**
 * Single HTTP entry point.
 *
 * Until the Express backend exists, `VITE_API_URL` is unset and every
 * call resolves to the empty value supplied by the caller. That is what
 * makes the app render its empty states rather than crash — no mock
 * data anywhere, just nothing yet.
 *
 * When the backend is ready: set VITE_API_URL and delete the early
 * return below. No component changes.
 */

const BASE = import.meta.env.VITE_API_URL ?? '';

export const isBackendConnected = Boolean(BASE);

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

function toApiError(code: ApiErrorCode, message: string): ApiError {
  return { code, message };
}

const STATUS_TO_CODE: Record<number, ApiErrorCode> = {
  400: 'validation_failed',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'claim_conflict',
  422: 'validation_failed',
};

export async function request<T>(
  path: string,
  options: RequestInit & { fallback: T },
): Promise<T> {
  const { fallback, ...init } = options;

  // No backend yet — hand back the empty shape so the UI shows its
  // empty state instead of an error the user cannot act on.
  if (!BASE) return fallback;

  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    let body: Partial<ApiError> = {};
    try {
      body = await response.json();
    } catch {
      // Non-JSON error body; fall through to the status mapping.
    }
    throw {
      code: body.code ?? STATUS_TO_CODE[response.status] ?? 'server_error',
      message: body.message ?? 'Something went wrong. Try again.',
      fields: body.fields,
    } satisfies ApiError;
  }

  return (await response.json()) as T;
}

export { toApiError };
