from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, Enum as SAEnum
from app.database import Base
import enum


class OrbitType(str, enum.Enum):
    LEO = "LEO"
    MEO = "MEO"
    GEO = "GEO"
    HEO = "HEO"


class Satellite(Base):
    __tablename__ = "satellites"

    id = Column(Integer, primary_key=True, index=True)
    category = Column(String(100))
    international_designator = Column(String(20))
    norad_id = Column(Integer, unique=True, index=True, nullable=False)
    name = Column(String(200), nullable=False)
    orbit_type = Column(SAEnum(OrbitType), nullable=False)
    priority = Column(Integer, default=1)
    active = Column(Boolean, default=True)
    home_telescope_id = Column(Integer, ForeignKey("telescopes.id"), nullable=True)
    assigned_telescope_id = Column(Integer, ForeignKey("telescopes.id"), nullable=True)
