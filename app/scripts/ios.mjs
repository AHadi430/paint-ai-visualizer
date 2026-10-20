// Prepare the iOS app for testing on an iPhone and open it in Xcode.
//
//   npm run ios            the phone loads the production build
//                          (fast; serve it with `npm run phone`)
//   npm run ios -- --dev   the phone loads the dev server instead
//                          (live reload while editing; slower)
//
// Points the native app at this computer's Wi-Fi address, syncs the
// Xcode project and opens it.

import { execSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';

function wifiAddress() {
  const candidates = Object.entries(networkInterfaces())
    .flatMap(([name, addresses]) =>
      (addresses ?? []).map((address) => ({ name, ...address }))
    )
    .filter((address) => address.family === 'IPv4' && !address.internal);

  // Prefer the usual Wi-Fi / Ethernet interfaces over VPNs and bridges.
  candidates.sort(
    (a, b) => Number(!a.name.startsWith('en')) - Number(!b.name.startsWith('en'))
  );

  return candidates[0]?.address;
}

const address = process.env.IOS_HOST ?? wifiAddress();

if (!address) {
  console.error(
    'Could not find this computer\'s network address. Connect to Wi-Fi, or run:\n' +
      '  IOS_HOST=<your-ip> npm run ios'
  );
  process.exit(1);
}

const dev = process.argv.includes('--dev');
const port = dev ? 5174 : 4174;
const serverUrl = `http://${address}:${port}`;

const run = (command, env = {}) =>
  execSync(command, { stdio: 'inherit', env: { ...process.env, ...env } });

// dist/ must exist for `cap sync`, even though the phone loads the
// dev server.
run('npx vite build');
run('npx cap sync ios', { CAP_SERVER_URL: serverUrl });

console.log(`
The iPhone app will load ${serverUrl}

1. Keep the backend and \`${dev ? 'npm run dev' : 'npm run phone'}\` (in app/) running.
2. Connect your iPhone to this Mac (cable or same Wi-Fi) and unlock it.
3. In Xcode: choose your iPhone at the top, then press Run (▶).
   First time only: Signing & Capabilities → Team → your Apple ID.
4. On the phone, allow "Local Network" access when asked.
`);

if (!process.argv.includes('--no-open')) {
  run('npx cap open ios');
}
