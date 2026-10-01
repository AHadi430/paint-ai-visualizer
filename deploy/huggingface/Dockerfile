# Backend image for a Hugging Face Docker Space (free CPU tier).
# Build context: a folder containing this Dockerfile and backend/
# (assembled by .github/workflows/deploy-backend.yml).
FROM python:3.11-slim

# git: SAM 2 is installed from GitHub. curl: model downloads.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl \
    && rm -rf /var/lib/apt/lists/*

# Spaces run the container as user 1000.
RUN useradd -m -u 1000 user
USER user

ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/home/user/.cache/huggingface \
    # No GPU here: don't try to compile SAM 2's CUDA extension.
    SAM2_BUILD_CUDA=0 \
    # Keep the AI steps usable on 2 CPUs.
    MAX_IMAGE_SIDE=1600 \
    INPAINT_MAX_SIDE=1024

WORKDIR /home/user/app

# CPU-only PyTorch. The default wheels bundle CUDA (several GB).
RUN pip install --no-cache-dir --user \
    torch==2.14.0 torchvision==0.29.0 \
    --index-url https://download.pytorch.org/whl/cpu

COPY --chown=user backend/requirements.txt backend/requirements.txt

# SAM 2 declares torch as a build dependency; build it against the
# CPU torch above instead of downloading the CUDA one. It is then
# left out of the second install: pip would rebuild a git
# requirement in an isolated environment (pulling CUDA torch again).
RUN grep "^SAM-2" backend/requirements.txt \
        | xargs -I{} pip install --no-cache-dir --user --no-build-isolation "{}" \
    && grep -v "^SAM-2" backend/requirements.txt > /tmp/requirements.txt \
    && pip install --no-cache-dir --user -r /tmp/requirements.txt

# Model weights (not in git) and the Grounding DINO cache.
RUN mkdir -p models \
    && curl -fsSL -o models/sam2.1_hiera_small.pt \
        https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt \
    && curl -fsSL -o models/big-lama.pt \
        https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt \
    && python -c "from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection as M; \
name = 'IDEA-Research/grounding-dino-tiny'; AutoProcessor.from_pretrained(name); M.from_pretrained(name)"

COPY --chown=user backend backend
RUN mkdir -p uploads outputs

WORKDIR /home/user/app/backend
EXPOSE 7860
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
