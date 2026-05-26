from sqlalchemy import Column, Integer, Float, ForeignKey, DateTime, String
from sqlalchemy.sql import func
from app.database import Base


class WeatherSnapshot(Base):
    __tablename__ = "weather_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    telescope_id = Column(Integer, ForeignKey("telescopes.id"), nullable=False, index=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    temperature = Column(Float)
    cloud_cover = Column(Float)
    cloud_cover_low = Column(Float)
    cloud_cover_mid = Column(Float)
    cloud_cover_high = Column(Float)
    precipitation = Column(Float)
    rain = Column(Float)
    snowfall = Column(Float)
    humidity = Column(Float)
    wind_speed = Column(Float)
    wind_gusts = Column(Float)
    visibility_km = Column(Float)
    weather_code = Column(Integer)
    source = Column(String(20), default="open-meteo")  # open-meteo or mock
