"""Local-first FastAPI hub for Shinchan MUSE."""

import asyncio
import json
import logging
import os
import time
from collections import defaultdict, deque
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, ValidationError

from contextual_bandit import LinUCB
from habit_miner import mine_sequences, synthesize_skill
from memory_and_style import MemoryStore

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("shinchan-muse")

app = FastAPI(title="Shinchan MUSE Brain", version="1.1.0")
memory = MemoryStore()
bandit = LinUCB()
traces: defaultdict[str, deque[dict[str, Any]]] = defaultdict(lambda: deque(maxlen=5000))
connections: set[WebSocket] = set()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
if not GEMINI_API_KEY and not GROQ_API_KEY:
    logger.info("No Gemini/Groq API key configured; offline friend replies are enabled.")
else:
    logger.info("Optional conversation provider key detected; chat requests will use the configured provider.")

BANKING_BLACKLIST = {
    "com.google.android.apps.walletnfcrel", "com.android.bank", "com.paytm.bank",
    "com.phonepe.app", "com.google.android.apps.nbu.paisa.user",
}


class TraceEvent(BaseModel):
    packageName: str = ""
    viewIdResourceName: str = ""
    className: str = ""
    text: str = ""
    contentDescription: str = ""
    boundsInScreen: dict[str, int] = Field(default_factory=dict)
    timestamp: float = 0
    eventType: str = ""
    isPassword: bool = False


class TraceRequest(BaseModel):
    userId: str = "local"
    events: list[TraceEvent] = Field(default_factory=list)


class Feedback(BaseModel):
    context: dict[str, Any] = Field(default_factory=dict)
    arm: str = "propose"
    reward: float = 0
    contact: str = ""
    text: str = ""


def offline_reply(user_text: str) -> str:
    text = user_text.strip()
    if not text:
        return "I'm here! Tell me what's on your mind."
    if any(word in text.lower() for word in ("hello", "hi", "hey")):
        return "Hey! It's nice to see you. What shall we do today?"
    if "help" in text.lower():
        return "I'm here with you. Tell me what you want to do and we can take it one step at a time."
    return "Got it! I'm listening. Tell me a little more?"


def _provider_reply_sync(user_text: str, contact: str) -> str:
    style = memory.style(contact) if contact else ""
    system_text = "You are Shinchan MUSE, a warm, playful, concise companion. Be friendly and respectful; never claim to have performed actions. Ask before an external action."
    if style:
        system_text += f" Adapt gently to this learned style preference: {style}."
    if GEMINI_API_KEY:
        model = os.getenv("MUSE_GEMINI_MODEL", "gemini-2.5-flash")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}"
        payload = {"systemInstruction": {"parts": [{"text": system_text}]}, "contents": [{"role": "user", "parts": [{"text": user_text[:4000]}]}], "generationConfig": {"maxOutputTokens": 160, "temperature": 0.8}}
        request = Request(url, data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
        with urlopen(request, timeout=18) as response:
            result = json.loads(response.read().decode("utf-8"))
        return result["candidates"][0]["content"]["parts"][0]["text"].strip()
    model = os.getenv("MUSE_GROQ_MODEL", "llama-3.3-70b-versatile")
    payload = {"model": model, "messages": [{"role": "system", "content": system_text}, {"role": "user", "content": user_text[:4000]}], "max_tokens": 160, "temperature": 0.8}
    request = Request("https://api.groq.com/openai/v1/chat/completions", data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json", "Authorization": f"Bearer {GROQ_API_KEY}"}, method="POST")
    with urlopen(request, timeout=18) as response:
        result = json.loads(response.read().decode("utf-8"))
    return result["choices"][0]["message"]["content"].strip()


async def chat_reply(user_text: str, contact: str = "") -> tuple[str, bool]:
    if not GEMINI_API_KEY and not GROQ_API_KEY:
        return offline_reply(user_text), True
    try:
        reply = await asyncio.to_thread(_provider_reply_sync, user_text, contact)
        return reply or offline_reply(user_text), False
    except (HTTPError, URLError, TimeoutError, KeyError, IndexError, ValueError) as error:
        logger.warning("Conversation provider failed; using offline reply: %s", error)
        return offline_reply(user_text), True
    except Exception:
        logger.exception("Unexpected conversation provider error; using offline reply")
        return offline_reply(user_text), True


@app.get("/health")
def health():
    return {"status": "ok", "service": "shinchan-muse-brain", "connections": len(connections)}


@app.post("/api/trace")
async def ingest_trace(req: TraceRequest):
    accepted = 0
    for event in req.events:
        item = event.model_dump()
        if item["isPassword"] or item["packageName"] in BANKING_BLACKLIST:
            continue
        traces[req.userId].append(item)
        accepted += 1
    return {"accepted": accepted, "filtered": len(req.events) - accepted}


@app.get("/api/skills")
def skills(userId: str = "local", minSupport: int = 2):
    raw = list(traces[userId])
    chunks: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    last = None
    for event in raw:
        if last is not None and event.get("timestamp", 0) - last > 180 and current:
            chunks.append(current)
            current = []
        current.append(event)
        last = event.get("timestamp", 0)
    if current:
        chunks.append(current)
    mined = mine_sequences(chunks, min_support=max(2, minSupport))
    return {"skills": [synthesize_skill(item["sequence"]) | {"support": item["support"]} for item in mined]}


@app.post("/api/feedback")
def feedback(item: Feedback):
    arm = item.arm if item.arm in ("propose", "quiet") else "propose"
    bandit.update(item.context, arm, item.reward)
    if item.text and item.contact:
        memory.learn_style(item.contact, item.text)
        memory.remember(item.contact, item.text)
    return {"ok": True, "style": memory.style(item.contact) if item.contact else None}


@app.post("/api/decision")
def decision(context: dict[str, Any]):
    arm = bandit.choose(context)
    return {"decision": arm, "prompt": arm == "propose"}


@app.websocket("/ws/companion")
async def companion_socket(ws: WebSocket):
    await ws.accept()
    connections.add(ws)
    client = f"{ws.client.host}:{ws.client.port}" if ws.client else "unknown"
    logger.info("WebSocket connected: %s (%s open)", client, len(connections))
    try:
        while True:
            raw = await ws.receive_text()
            try:
                message = json.loads(raw)
                if not isinstance(message, dict):
                    raise ValueError("message must be a JSON object")
            except (json.JSONDecodeError, ValueError) as error:
                logger.warning("Bad WebSocket JSON from %s: %s", client, error)
                await ws.send_json({"type": "ERROR", "message": "Send one JSON object per message."})
                continue

            msg_type = str(message.get("type", "")).upper()
            logger.info("WebSocket message from %s: %s", client, msg_type or "<missing type>")
            if msg_type == "CONTEXT":
                context = message.get("context", {})
                arm = bandit.choose(context if isinstance(context, dict) else {})
                await ws.send_json({"type": "DECISION", "decision": arm})
            elif msg_type == "TRACE":
                try:
                    request = TraceRequest(userId=str(message.get("userId", "local")), events=message.get("events", []))
                    result = await ingest_trace(request)
                    await ws.send_json({"type": "TRACE_ACK", **result})
                except (ValidationError, TypeError, ValueError) as error:
                    await ws.send_json({"type": "ERROR", "message": f"Invalid trace payload: {error}"})
            elif msg_type in {"PERMISSION_RESULT", "CORRECTION"}:
                approved = message.get("approved") is True
                try:
                    reward = float(message.get("reward", 1.0 if approved else -1.0))
                except (TypeError, ValueError):
                    await ws.send_json({"type": "ERROR", "message": "Feedback reward must be a number."})
                    continue
                context = message.get("context", {})
                bandit.update(context if isinstance(context, dict) else {}, "propose", reward)
                await ws.send_json({"type": "FEEDBACK_ACK", "approved": approved, "reward": reward})
            elif msg_type == "TAP_RESULT":
                success = message.get("success") is True
                try:
                    reward = float(message.get("reward", 1.0 if success else -1.0))
                except (TypeError, ValueError):
                    await ws.send_json({"type": "ERROR", "message": "Tap result reward must be a number."})
                    continue
                context = message.get("context", {})
                bandit.update(context if isinstance(context, dict) else {}, "propose", reward)
                await ws.send_json({"type": "TAP_ACK", "success": success, "reward": reward})
            elif msg_type == "CHAT":
                text = str(message.get("text", "")).strip()[:4000]
                contact = str(message.get("contact", "local"))[:100]
                if text:
                    memory.remember(contact, text)
                    reply, offline = await chat_reply(text, contact)
                    await ws.send_json({"type": "CHAT_REPLY", "text": reply, "offline": offline})
                else:
                    await ws.send_json({"type": "ERROR", "message": "Chat text is empty."})
            elif msg_type == "PING":
                await ws.send_json({"type": "PONG", "timestamp": time.time()})
            else:
                await ws.send_json({"type": "ERROR", "message": f"Unsupported message type: {msg_type or '(missing)'}"})
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected: %s", client)
    except Exception:
        logger.exception("WebSocket handler failed for %s", client)
        try:
            await ws.close(code=1011, reason="server error")
        except Exception:
            pass
    finally:
        connections.discard(ws)
        logger.info("WebSocket closed: %s (%s open)", client, len(connections))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.getenv("MUSE_HOST", "0.0.0.0"), port=int(os.getenv("MUSE_PORT", "8000")))
