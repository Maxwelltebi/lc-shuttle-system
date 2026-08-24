import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The .env is at the repo root, shared with the backend. Only VITE_*
  // vars are exposed to client code, so the server secrets in it stay put.
  envDir: '..',
})
