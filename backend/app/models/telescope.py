from sqlalchemy import Column, Integer, String, Float, Boolean, Enum as SAEnum
from app.database import Base
import enum


class TelescopeStatus(str, enum.Enum):
    ONLINE = "ONLINE"
    OFFLINE = "OFFLINE"
    WEATHER_BLOCKED = "WEATHER_BLOCKED"
    PARTIAL = "PARTIAL"
    MANUAL_MODE = "MANUAL_MODE"
    ERROR = "ERROR"


class Telescope(Base):
    __tablename__ = "telescopes"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(200), nullable=False)
    region = Column(String(100))
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    altitude_m = Column(Float, default=0.0)
    status = Column(SAEnum(TelescopeStatus), default=TelescopeStatus.ONLINE, nullable=False)
    min_elevation_deg = Column(Float, default=15.0)
    max_cloud_cover_percent = Column(Float, default=40.0)
    max_low_cloud_cover_percent = Column(Float, default=25.0)
    max_wind_speed_mps = Column(Float, default=12.0)
    min_visibility_km = Column(Float, default=10.0)
    active = Column(Boolean, default=True)
    address = Column(String(300), nullable=True)
