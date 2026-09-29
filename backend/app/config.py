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
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / "backend" / ".env",
        extra="ignore",
    )

settings = Settings()
