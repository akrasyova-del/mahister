from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    database_url: str = "sqlite+aiosqlite:///./satellite_watcher.db"

    spacetrack_user: str = ""
    spacetrack_pass: str = ""
    celestrak_base_url: str = "https://celestrak.org"
    open_meteo_base_url: str = "https://api.open-meteo.com/v1"

    app_host: str = "0.0.0.0"
    app_port: int = 8000
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    weather_update_interval: int = 600
    tle_update_interval: int = 3600
    assignment_update_interval: int = 300

    tle_max_age_leo: int = 24
    tle_max_age_leo_maneuvering: int = 6
    tle_max_age_meo: int = 120  # MEO (GLONASS) orbits are stable — 5-day TLE is still accurate
    tle_max_age_geo: int = 168  # GEO is nearly static
    tle_max_age_heo: int = 24

    mock_tle: bool = False
    mock_weather: bool = False

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]

    @property
    def spacetrack_available(self) -> bool:
        return bool(self.spacetrack_user and self.spacetrack_pass)

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
