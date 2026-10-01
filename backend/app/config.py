from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Project root (paint-ai-visualizer/). Paths are resolved
# from here so the server works no matter which directory
# uvicorn is started from.
BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    app_name: str = "Paint AI Visualizer"
    environment: str = "development"
    max_upload_mb: int = 15
    upload_dir: str = str(BASE_DIR / "uploads")
    output_dir: str = str(BASE_DIR / "outputs")
    model_dir: str = str(BASE_DIR / "models")
    # Uploaded photos and generated images older than this
    # are deleted automatically. 0 disables the cleanup.
    retention_days: int = 7

    # Uploads are downscaled to this longest side. Lower it
    # on CPU-only servers: every AI step scales with it.
    max_image_side: int = 2400
    # Working resolution for clean-render inpainting.
    inpaint_max_side: int = 1600

    # Comma-separated list of sites allowed to call the
    # API, plus an optional regex (e.g. Vercel previews).
    cors_origins: str = (
        "http://localhost:5173,http://localhost:3000"
    )
    cors_origin_regex: str = ""

    # When set, every POST request must send this in the
    # X-Access-Password header. Leave empty locally.
    access_password: str = ""

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / "backend" / ".env",
        extra="ignore",
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [
            origin.strip()
            for origin in self.cors_origins.split(",")
            if origin.strip()
        ]


settings = Settings()
