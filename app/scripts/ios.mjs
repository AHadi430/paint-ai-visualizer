// Prepare the iOS app for testing on an iPhone and open it in Xcode.
//
//   npm run ios
//
// Points the native app at this computer's dev server (Wi-Fi address,
// port 5174), syncs the Xcode project and opens it. Keep `npm run dev`
// (and the backend) running while you use the app on the phone.

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

const serverUrl = `http://${address}:5174`;

const run = (command, env = {}) =>
  execSync(command, { stdio: 'inherit', env: { ...process.env, ...env } });

// dist/ must exist for `cap sync`, even though the phone loads the
// dev server.
run('npx vite build');
run('npx cap sync ios', { CAP_SERVER_URL: serverUrl });

console.log(`
The iPhone app will load ${serverUrl}

1. Keep the backend and \`npm run dev\` (in app/) running.
2. Connect your iPhone to this Mac (cable or same Wi-Fi) and unlock it.
3. In Xcode: choose your iPhone at the top, then press Run (▶).
   First time only: Signing & Capabilities → Team → your Apple ID.
4. On the phone, allow "Local Network" access when asked.
`);

if (!process.argv.includes('--no-open')) {
  run('npx cap open ios');
}
