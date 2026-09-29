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
