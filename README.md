# Paint AI Visualizer

Upload a photo of a room or building, select surfaces, and preview paint
shades from a company shade card, with the original lighting and texture
preserved.

## Features
- **Surface selection**: outline an exact area with Polygon, or use AI Click
  (SAM 2) to select a surface with one click.
- **Automatic surface detection**: Grounding DINO + SAM 2 find walls, columns
  and facade sections, and protect windows, doors and railings.
- **Realistic recolouring**: paint follows the original lighting, shadows and
  texture.
- **Clean render**: removes overhead wires, vehicles, people, poles and loose
  objects (LaMa inpainting), plus an Erase brush for anything left behind.
- **Download** the painted result as a PNG.

Stack: React + TypeScript (Vite) frontend, FastAPI backend, PyTorch models.

## Project layout

| Folder | What it is |
|---|---|
| `frontend/` | The full visualizer website (detailed tools: polygons, clean render, area editing) |
| `app/` | The customer app: a simple, phone-first app installable to the home screen |
| `backend/` | The shared AI backend used by both |

### Customer app
Three tabs:
- **Paint**: take or choose a photo, tap a wall, pick a shade; undo,
  before/after, and share or save the result.
- **Identify**: tap any colour in a photo. The AI finds the surface and
  reports its colour (name, hex/RGB, warm/cool, light/dark) and the
  closest shades from the shade card, plus the photo's main colours.
- **Shades**: browse and search the shade card, save favourites and try
  any shade on a wall.

Run it (with the backend running):
```bash
cd app
npm install
npm run dev
```
Open http://localhost:5174. To try it on a phone, connect the phone to the
same Wi-Fi and open the **Network** address Vite prints (e.g.
`http://192.168.1.44:5174`); in Safari use *Share → Add to Home Screen* to
install it. The app forwards `/api` to the backend on this computer, so
nothing else needs to be exposed.

### iPhone app (Xcode)
`app/ios/` is a native iOS app (Capacitor) around the same app. While
testing, the iPhone app loads the app from this Mac over Wi-Fi.

1. Start the backend, then `npm run phone` in `app/` (builds the app and
   serves the fast production version on port 4174).
2. In `app/`, run `npm run ios`. It points the iPhone app at this Mac's
   Wi-Fi address, syncs the Xcode project and opens it in Xcode.
   (`npm run ios -- --dev` uses the dev server instead: code changes show
   up live, but the app is slower.)
3. Connect the iPhone with a cable (or on the same Wi-Fi once paired),
   unlock it, choose it at the top of Xcode and press **Run**.
4. First time only, on the iPhone:
   - Settings → Privacy & Security → **Developer Mode** → on (restarts the
     phone).
   - Settings → General → VPN & Device Management → trust the developer
     app.
   - Allow **Local Network** access when Paint AI asks.

Apps signed with a free Apple account stop opening after 7 days; press Run
in Xcode again to renew. If the Mac's Wi-Fi address changes, run
`npm run ios` again.

If something goes wrong:
- **"Can't reach Griplac" on the phone**: the Mac isn't serving the app.
  Start the backend and `npm run phone` (or `npm run tunnel`); the app
  reconnects by itself. If the Mac's address changed, run `npm run ios`
  (or `npm run tunnel`) and press Run in Xcode again.
- **The iPhone isn't in Xcode's device list**: plug it in, unlock it and
  tap *Trust* if asked. Xcode may offer to download an iOS simulator
  after it updates; a real iPhone doesn't need it.

### Use it from anywhere (free Cloudflare Tunnel)
To use the app on mobile data or another network, while the AI still runs
on this Mac:

```bash
brew install cloudflared   # once
cd app
npm run tunnel
```

This starts the backend (if needed) and the fast app build, opens a free
Cloudflare quick tunnel, prints its `https://….trycloudflare.com` address
and points the iPhone app at it. Then press **Run** in Xcode once; any
phone can also open the address in a browser.

- Keep the terminal window open and the Mac plugged in, online and awake
  (the script keeps it from sleeping). Ctrl+C takes the app offline.
- The address changes every time the tunnel starts, so press Run in Xcode
  again after each restart. A fixed address needs a domain in Cloudflare
  (a "named tunnel"); set `TUNNEL_HOST` to it so the app server accepts it.
- Visitors coming through the tunnel are rate-limited
  (`RATE_LIMIT_PER_MINUTE`, default 240 requests/min, and
  `RATE_LIMIT_HEAVY_PER_10_MINUTES`, default 40 uploads, detections and
  clean-ups per 10 min, per visitor). Use on this Mac is never limited.
- If it keeps saying Cloudflare was slow to respond, Cloudflare's free
  service can't be reached well from your network right now. Try again
  later or on another network, or use the Wi-Fi setup above meanwhile.

## Setup

### 1. Model weights
Download these into `models/` (they are not stored in the repo):
```bash
mkdir -p models

# SAM 2.1 (segmentation)
curl -L -o models/sam2.1_hiera_small.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt

# LaMa (clean render / object removal)
curl -L -o models/big-lama.pt \
  https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt
```
Grounding DINO is downloaded automatically from Hugging Face on first run.

### 2. Backend
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Runs on Apple Silicon (MPS), NVIDIA GPUs (CUDA) or CPU.

Uploaded photos and generated images are deleted automatically after 7
days. Change this with `RETENTION_DAYS=30` in `backend/.env` (0 turns the
cleanup off).

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

## Deployment

| Part | Host | Redeploys when |
|---|---|---|
| Backend | Hugging Face Space (Docker, free CPU) | a push to `main` changes `backend/` or `deploy/` |
| Frontend | Vercel (free Hobby plan) | any push to `main` (other branches get preview URLs) |

The free Space has 2 CPUs and no GPU, so it works on smaller images
(`MAX_IMAGE_SIDE=1600`, `INPAINT_MAX_SIDE=1024`) and is slower than running
locally. It sleeps after 48 hours without visits; the first request then
takes a few minutes while it wakes up.

The Space has to be **public** so the website can reach it, which means its
backend code is visible on Hugging Face. Use of the API is protected by
`ACCESS_PASSWORD`; the deploy refuses to run without one.

### One-time setup

1. **Hugging Face**: create an account and a token with *write* access at
   https://huggingface.co/settings/tokens.
2. **GitHub settings** (run in this folder; `gh` prompts for the secret
   values so they never end up in your shell history):
   ```bash
   gh secret set HF_TOKEN              # the Hugging Face token
   gh secret set ACCESS_PASSWORD       # the password people will type
   gh variable set HF_SPACE --body "<hf-username>/paint-ai-visualizer"
   gh variable set CORS_ORIGIN_REGEX --body 'https://paint-ai-visualizer[a-z0-9-]*\.vercel\.app'
   gh workflow run deploy-backend.yml
   ```
   The first Space build takes about 15 minutes. Watch it on the Space
   page; the API is at `https://<hf-username>-paint-ai-visualizer.hf.space`.
3. **Vercel**: sign in with GitHub, *Add New → Project*, import this repo and
   set
   - Root Directory: `frontend`
   - Environment variable `VITE_API_URL` = the Space URL from step 2

### Making changes after deployment

Develop and test locally as usual, then commit and push to `main`: the
frontend redeploys on Vercel within a minute, and the backend rebuilds on
Hugging Face when backend files changed. Push to another branch first to
get a Vercel preview URL without touching the live site.
