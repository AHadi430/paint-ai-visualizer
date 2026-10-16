import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app talks to the backend through /api on its own origin, so a
// phone on the same Wi-Fi only needs to reach this server and no CORS
// setup is needed. Set VITE_API_URL to call a hosted backend instead.
const proxy = {
  '/api': 'http://localhost:8000',
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    proxy,
  },
  preview: {
    host: true,
    port: 4174,
    proxy,
  },
});
