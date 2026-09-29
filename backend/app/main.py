import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .api.visualizer import router
from .services.cleanup_service import delete_old_files


Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
Path(settings.output_dir).mkdir(parents=True, exist_ok=True)


# How often old uploads and outputs are cleaned up.
CLEANUP_INTERVAL_SECONDS = 6 * 60 * 60


async def cleanup_loop():

    while True:

        removed = await asyncio.to_thread(
            delete_old_files,
            [
                settings.upload_dir,
                settings.output_dir,
            ],
            settings.retention_days,
        )

        if removed:
            print(
                f"Cleanup: deleted {removed} file(s) older "
                f"than {settings.retention_days} days."
            )

        await asyncio.sleep(
            CLEANUP_INTERVAL_SECONDS
        )


@asynccontextmanager
async def lifespan(app: FastAPI):

    task = asyncio.create_task(
        cleanup_loop()
    )

    yield

    task.cancel()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(router)


@app.get("/")
def root():
    return {
        "name": settings.app_name,
        "version": "0.1.0",
        "status": "running",
    }


@app.get("/health")
def health():
    return {"status": "ok"}
