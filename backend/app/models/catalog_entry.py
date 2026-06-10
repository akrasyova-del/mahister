from sqlalchemy import Column, Integer, String, Float, DateTime
from sqlalchemy.sql import func
from app.database import Base


class CatalogEntry(Base):
    """Cached entry from Space-Track satcat — Russian payloads available for tracking."""
    __tablename__ = "catalog_entries"

    id = Column(Integer, primary_key=True, index=True)
    norad_id = Column(Integer, unique=True, index=True, nullable=False)
    name = Column(String(200), nullable=False)
    international_designator = Column(String(20), nullable=True)
    country = Column(String(20), nullable=True)
    object_type = Column(String(30), nullable=True)
    launch_date = Column(String(20), nullable=True)
    period_min = Column(Float, nullable=True)
    apogee_km = Column(Float, nullable=True)
    perigee_km = Column(Float, nullable=True)
    inclination_deg = Column(Float, nullable=True)
    last_synced_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
