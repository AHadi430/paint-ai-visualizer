from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    app_name: str = "Paint AI Visualizer"
    environment: str = "development"
    max_upload_mb: int = 15
    upload_dir: str = "../uploads"
    output_dir: str = "../outputs"
    model_dir: str = "../models"
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
