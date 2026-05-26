import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import settings
from app.database import init_db, AsyncSessionLocal
from app.seed.seed_data import run_seed
from app.services.weather_service import update_all_weather
from app.services.tle_service import update_all_tles
from app.services.assignment_engine import run_assignment
from app.services.event_service import log_event
from app.models.event_log import EventLevel, EventType
from app.websocket.manager import ws_manager
from app.api import telescopes, satellites, tle, weather, passes, assignments, dashboard, events

scheduler = AsyncIOScheduler()


async def scheduled_weather_update():
    async with AsyncSessionLocal() as db:
        await update_all_weather(db)
    await ws_manager.send_event("weather_updated", {"auto": True})


async def scheduled_tle_update():
    async with AsyncSessionLocal() as db:
        stats = await update_all_tles(db)
    await ws_manager.send_event("tle_updated", stats)


async def scheduled_assignment_update():
    async with AsyncSessionLocal() as db:
        stats = await run_assignment(db)
    await ws_manager.send_event("assignments_updated", stats)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB and seed
    await init_db()
    async with AsyncSessionLocal() as db:
        await run_seed(db)
        await log_event(db, EventType.SYSTEM_START, "Satellite Watcher system started", EventLevel.INFO)
        await db.commit()

    # Initial data fetch — runs in background so startup doesn't block
    async def _initial_fetch():
        async with AsyncSessionLocal() as db:
            try:
                await update_all_weather(db)
            except Exception as e:
                print(f"Initial weather fetch failed: {e}")
        async with AsyncSessionLocal() as db:
            try:
                await update_all_tles(db)
            except Exception as e:
                print(f"Initial TLE fetch failed: {e}")
        async with AsyncSessionLocal() as db:
            try:
                await run_assignment(db)
            except Exception as e:
                print(f"Initial assignment failed: {e}")

    asyncio.create_task(_initial_fetch())

    # Schedule periodic updates
    scheduler.add_job(
        scheduled_weather_update,
        "interval",
        seconds=settings.weather_update_interval,
        id="weather_update",
    )
    scheduler.add_job(
        scheduled_tle_update,
        "interval",
        seconds=settings.tle_update_interval,
        id="tle_update",
    )
    scheduler.add_job(
        scheduled_assignment_update,
        "interval",
        seconds=settings.assignment_update_interval,
        id="assignment_update",
    )
    scheduler.start()

    yield

    scheduler.shutdown(wait=False)


app = FastAPI(
    title="Satellite Watcher",
    description="Automated spacecraft distribution system for Ukrainian optical telescopes",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(telescopes.router)
app.include_router(satellites.router)
app.include_router(tle.router)
app.include_router(weather.router)
app.include_router(passes.router)
app.include_router(assignments.router)
app.include_router(dashboard.router)
app.include_router(events.router)


@app.websocket("/ws/dashboard")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            # Keep connection alive; server pushes events via ws_manager.broadcast
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)


@app.get("/health")
async def health():
    return {"status": "ok"}


# Serve React SPA (must be last — catches all non-API routes)
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

_static = Path(__file__).parent.parent / "static"
if _static.is_dir():
    app.mount("/assets", StaticFiles(directory=str(_static / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def _spa(full_path: str):
        f = _static / full_path
        if f.is_file():
            return FileResponse(str(f))
        return FileResponse(str(_static / "index.html"))
