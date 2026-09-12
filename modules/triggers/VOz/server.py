import tempfile
import os
import asyncio
import requests
from fastapi import FastAPI, UploadFile, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import FileResponse
from faster_whisper import WhisperModel

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:3000")

app = FastAPI()
model = WhisperModel("base", device="cpu", compute_type="int8")

clients: set[WebSocket] = set()
loop: asyncio.AbstractEventLoop = None


async def broadcast(msg):
    for ws in list(clients):
        try:
            await ws.send_text(msg)
        except Exception:
            clients.discard(ws)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        clients.discard(ws)


@app.post("/hotkey")
async def hotkey(request: Request):
    body = await request.json()
    event = body.get("event")
    if event in ("start", "stop"):
        await broadcast(event)
    return {"ok": True}


@app.post("/transcribe")
async def transcribe(file: UploadFile):
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    try:
        segments, _ = model.transcribe(tmp_path, beam_size=5, vad_filter=True)
        text = " ".join(s.text.strip() for s in segments)
    finally:
        os.unlink(tmp_path)
    return {"text": text}


@app.post("/ask")
async def ask(file: UploadFile):
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    try:
        segments, _ = model.transcribe(tmp_path, beam_size=5, vad_filter=True)
        text = " ".join(s.text.strip() for s in segments)
    finally:
        os.unlink(tmp_path)

    if not text.strip():
        return {"text": "", "reply": ""}

    try:
        r = requests.post(
            f"{BACKEND_URL}/api/voice-chat/ask",
            json={"text": text},
            timeout=30,
        )
        data = r.json()
        return {"text": text, "reply": data.get("text", "")}
    except Exception as e:
        return {"text": text, "reply": "", "error": str(e)}


@app.get("/")
async def index():
    return FileResponse("index.html")


@app.on_event("startup")
async def startup():
    global loop
    loop = asyncio.get_running_loop()
    print("[VOZ] Servidor listo — hotkey '+' controlado por Node.js")


@app.on_event("shutdown")
async def shutdown():
    pass
