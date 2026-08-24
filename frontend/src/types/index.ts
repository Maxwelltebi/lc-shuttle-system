/**
 * Re-export of the shared contract at ../../../shared/types.ts.
 *
 * Frontend and backend import the same file, so a shape can never drift
 * between them: change it once and both sides fail to compile until
 * they agree.
 */
export * from '../../../shared/types';
