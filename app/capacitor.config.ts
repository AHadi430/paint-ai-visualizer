import type { CapacitorConfig } from '@capacitor/cli';

/*
 * Native iOS wrapper around the web app (see ios/).
 *
 * For testing on a phone, `npm run ios` sets CAP_SERVER_URL to this
 * computer's Wi-Fi address, and `npm run tunnel` to a secure Cloudflare
 * Tunnel address that works on any network. The iPhone app then
 * loads the app from there, so:
 *   - /api reaches the backend through Vite's proxy (no CORS setup),
 *   - code changes show up on the phone immediately (live reload).
 *
 * Without CAP_SERVER_URL the built files in dist/ are bundled into the
 * app instead (for a release; needs a hosted https backend).
 */
const serverUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'com.ahadi430.paintai',
  appName: 'Griplac',
  webDir: 'dist',
  backgroundColor: '#f8f6fa',
  ios: {
    // The web app handles the notch and home indicator itself
    // (viewport-fit=cover + safe-area insets in the CSS).
    contentInset: 'never',
  },
  ...(serverUrl && {
    server: {
      url: serverUrl,
      // Plain http is only needed for the Wi-Fi address; the
      // tunnel (`npm run tunnel`) is https.
      cleartext: serverUrl.startsWith('http://'),
    },
  }),
};

export default config;
