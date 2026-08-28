import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

/**
 * Loads `backend/.env`, resolved relative to this file rather than to
 * `process.cwd()` — so it works whether the server is started from the
 * repo root or from `backend/`.
 *
 * Import this module first in every entrypoint, before anything that
 * reads `process.env`.
 */
config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
