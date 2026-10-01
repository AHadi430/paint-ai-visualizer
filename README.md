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
