import asyncio
import json
from fastapi import WebSocket
from typing import Any


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict[str, Any]):
        data = json.dumps(message, default=str)
        dead = []
        for connection in self.active_connections:
            try:
                await connection.send_text(data)
            except Exception:
                dead.append(connection)
        for d in dead:
            self.disconnect(d)

    async def send_event(self, event_type: str, payload: Any):
        await self.broadcast({"type": event_type, "payload": payload})


ws_manager = ConnectionManager()
