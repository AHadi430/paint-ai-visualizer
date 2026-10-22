import asyncio
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .api.visualizer import router
from .services.cleanup_service import delete_old_files
from .services.rate_limit import RateLimiter


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


@app.middleware("http")
async def require_access_password(
    request: Request,
    call_next,
):
    """
    A shared password for small private deployments.

    Only POST requests (the ones that run the AI models)
    are protected. Images are served by unguessable
    random ids, and <img> tags cannot send headers.
    """

    if (
        settings.access_password
        and request.method == "POST"
        and not secrets.compare_digest(
            request.headers
            .get("x-access-password", "")
            .encode(),
            settings.access_password.encode(),
        )
    ):
        return JSONResponse(
            {"detail": "Access password required."},
            status_code=401,
        )

    return await call_next(request)


rate_limiter = RateLimiter(
    per_minute=settings.rate_limit_per_minute or 10**9,
    heavy_per_10_minutes=settings.rate_limit_heavy_per_10_minutes or 10**9,
)


@app.middleware("http")
async def limit_internet_visitors(
    request: Request,
    call_next,
):
    """
    Usage limits for visitors coming through Cloudflare (the tunnel
    sets CF-Connecting-IP). Use on this computer is not limited.
    """

    client = request.headers.get("cf-connecting-ip")

    if client and request.method == "POST":
        retry_after = rate_limiter.check(client, request.url.path)

        if retry_after is not None:
            return JSONResponse(
                {
                    "detail": (
                        "You're doing that a lot. Please wait "
                        f"{retry_after} seconds and try again."
                    )
                },
                status_code=429,
                headers={"Retry-After": str(retry_after)},
            )

    return await call_next(request)


# Added last so it runs first: CORS headers must also be
# present on 401 responses or the browser hides them.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=(
        settings.cors_origin_regex or None
    ),
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


@app.post("/api/check-access")
def check_access():
    """
    Lets the frontend test a password: the middleware
    above has already rejected a wrong one.
    """

    return {
        "ok": True,
        "password_required": bool(
            settings.access_password
        ),
    }
