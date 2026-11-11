import json, math, sqlite3, time
from collections import Counter
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Shinchan-MUSE RAG & Behavioral ML Brain")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DB_PATH = "shinchan_memory.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("CREATE TABLE IF NOT EXISTS rag_memories (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT, tags TEXT, ts REAL)")
    c.execute("CREATE TABLE IF NOT EXISTS ui_traces (id INTEGER PRIMARY KEY AUTOINCREMENT, pkg TEXT, action TEXT, label TEXT, x INT, y INT, ts REAL)")
    c.execute("CREATE TABLE IF NOT EXISTS bandit_weights (action_key TEXT PRIMARY KEY, successes INT, trials INT)")
    conn.commit()
    conn.close()

init_db()

def tokenize(text: str):
    return [w.lower() for w in text.replace(",", " ").replace(".", " ").split() if len(w) > 1]

def save_rag_memory(text: str, tags: str = "chat"):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("INSERT INTO rag_memories (text, tags, ts) VALUES (?, ?, ?)", (text, tags, time.time()))
    conn.commit()
    conn.close()

def retrieve_rag_context(query: str, top_k: int = 3):
    q_tokens = Counter(tokenize(query))
    if not q_tokens:
        return []
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT text, ts FROM rag_memories ORDER BY id DESC LIMIT 200").fetchall()
    conn.close()
    scored = []
    for text, ts in rows:
        d_tokens = Counter(tokenize(text))
        dot = sum(q_tokens[k] * d_tokens[k] for k in q_tokens if k in d_tokens)
        norm = (math.sqrt(sum(v*v for v in q_tokens.values())) * math.sqrt(sum(v*v for v in d_tokens.values()))) or 1.0
        sim = dot / norm
        if sim > 0.05:
            scored.append((sim, text))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [t for _, t in scored[:top_k]]

def mine_frequent_habit():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT pkg, label, x, y, COUNT(*) as cnt FROM ui_traces GROUP BY pkg, label ORDER BY cnt DESC LIMIT 1").fetchall()
    conn.close()
    if rows and rows[0][4] >= 3:
        return {"pkg": rows[0][0], "label": rows[0][1], "x": rows[0][2], "y": rows[0][3], "count": rows[0][4]}
    return None

@app.get("/health")
def health():
    return {"status": "alive", "engine": "RAG + HabitMiner + LinUCB"}

@app.websocket("/ws/companion")
async def companion_ws(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            raw = await ws.receive_text()
            data = json.loads(raw)
            mtype = data.get("type", "")

            if mtype == "VOICE_COMMAND":
                user_text = data.get("text", "")
                memories = retrieve_rag_context(user_text)
                save_rag_memory(f"User said: {user_text}", "voice")
                lower = user_text.lower()

                if any(k in lower for k in ["click", "tap", "open", "send", "whatsapp"]):
                    habit = mine_frequent_habit()
                    tx, ty = (habit["x"], habit["y"]) if habit else (540, 1200)
                    await ws.send_text(json.dumps({
                        "type": "PROPOSE_SKILL",
                        "reply": f"Yo! Want me to run your '{user_text}' workflow and tap ({tx}, {ty})? Tap 👍 ALLOW!",
                        "emotion": "ASK_PERMISSION",
                        "ask_permission": True,
                        "target_coords": {"x": tx, "y": ty}
                    }))
                elif "dance" in lower or "buri" in lower:
                    await ws.send_text(json.dumps({
                        "reply": "Buri Buri!! Watch my legendary wiggle dance!",
                        "emotion": "PROUD"
                    }))
                else:
                    mem_hint = f" (I also remember: {memories[0]})" if memories else ""
                    await ws.send_text(json.dumps({
                        "reply": f"Haan bro! Got it: '{user_text}'.{mem_hint}",
                        "emotion": "PROUD"
                    }))

            elif mtype == "UI_TRACE":
                conn = sqlite3.connect(DB_PATH)
                conn.execute(
                    "INSERT INTO ui_traces (pkg, action, label, x, y, ts) VALUES (?, ?, ?, ?, ?, ?)",
                    (data.get("pkg", ""), data.get("action", "TAP"), data.get("label", ""), int(data.get("x", 540)), int(data.get("y", 960)), time.time())
                )
                conn.commit()
                conn.close()
                habit = mine_frequent_habit()
                if habit and habit["count"] % 5 == 0:
                    await ws.send_text(json.dumps({
                        "type": "PROPOSE_SKILL",
                        "reply": f"I learned your habit on {habit['label']}! Want me to automate it now?",
                        "emotion": "ASK_PERMISSION",
                        "ask_permission": True,
                        "target_coords": {"x": habit["x"], "y": habit["y"]}
                    }))
    except WebSocketDisconnect:
        pass
