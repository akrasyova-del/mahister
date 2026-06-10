from sqlalchemy import text, event
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.config import settings

engine = create_async_engine(settings.database_url, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@event.listens_for(engine.sync_engine, "connect")
def _set_sqlite_wal(dbapi_conn, _record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    from app.models import telescope, satellite, tle_record, weather, pass_window, assignment, event_log, catalog_entry  # noqa
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
