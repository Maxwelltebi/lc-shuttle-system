import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

/**
 * The `.env` lives at the repo root, shared with the frontend (see
 * `frontend/vite.config.ts`, which points Vite's `envDir` at the same
 * file). Plain `dotenv/config` resolves against `process.cwd()`, which
 * is `backend/` under `npm run dev` — so it would never find it.
 *
 * Import this module first in every entrypoint, before anything that
 * reads `process.env`.
 */
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
