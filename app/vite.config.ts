import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app talks to the backend through /api on its own origin, so a
// phone on the same Wi-Fi only needs to reach this server and no CORS
// setup is needed. Set VITE_API_URL to call a hosted backend instead.
const proxy = {
  '/api': 'http://localhost:8000',
};

// Internet addresses that may reach this server: Cloudflare quick
// tunnels (`npm run tunnel`), plus your own tunnel domain if you set
// TUNNEL_HOST (e.g. TUNNEL_HOST=app.griplac.com).
const allowedHosts = [
  '.trycloudflare.com',
  ...(process.env.TUNNEL_HOST ? [process.env.TUNNEL_HOST] : []),
];

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    allowedHosts,
    proxy,
  },
  preview: {
    host: true,
    port: 4174,
    strictPort: true,
    allowedHosts,
    proxy,
  },
});
