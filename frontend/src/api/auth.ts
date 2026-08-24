import type { AuthSession, CurrentUser, Role } from '../types';
import { request } from './client';

/**
 * Auth calls.
 *
 * Each returns `null` while no backend is configured, which keeps the
 * forms inert rather than faking a signed-in user.
 */

export interface SignInInput {
  email: string;
  password: string;
  /** Sent so the server can reject a student signing in on the driver
   *  tab, rather than silently landing them in the wrong app. */
  role: Role;
}

export function signIn(input: SignInInput) {
  return request<AuthSession | null>('/api/auth/signin', {
    method: 'POST',
    body: JSON.stringify(input),
    fallback: null,
  });
}

export interface SignUpInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  homeStopId?: string;
}

export function signUpStudent(input: SignUpInput) {
  return request<AuthSession | null>('/api/auth/signup/student', {
    method: 'POST',
    body: JSON.stringify(input),
    fallback: null,
  });
}

/** Returns no session: the driver cannot sign in until staff approve. */
export function signUpDriver(input: SignUpInput) {
  return request<{ pending: true } | null>('/api/auth/signup/driver', {
    method: 'POST',
    body: JSON.stringify(input),
    fallback: null,
  });
}

/** Rehydrates the session from a stored token. The server decides. */
export function fetchMe() {
  return request<CurrentUser | null>('/api/auth/me', { fallback: null });
}

export function signOut() {
  return request<null>('/api/auth/signout', { method: 'POST', fallback: null });
}
