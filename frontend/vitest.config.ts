import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('http://test.invalid') },
  test: { environment: 'jsdom', include: ['test/**/*.test.tsx'] },
});
