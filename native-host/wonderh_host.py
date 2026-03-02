#!/usr/bin/env python3
import sys, json, struct, os

DB_FILE = os.path.expanduser("~/wonderh_ai_data.json")

# 用最簡單的方式寫 log，確保不會有任何問題
LOG_FILE = os.path.expanduser("~/wonderh_host.log")

def log(msg):
    with open(LOG_FILE, 'a') as f:
        f.write(msg + "\n")
        f.flush()

def send_message(message):
    content = json.dumps(message).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('@I', len(content)))
    sys.stdout.buffer.write(content)
    sys.stdout.buffer.flush()

def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    message_length = struct.unpack('@I', raw_length)[0]
    return json.loads(sys.stdin.buffer.read(message_length).decode('utf-8'))

log("=== host started ===")

if not os.path.exists(DB_FILE):
    with open(DB_FILE, 'w') as f:
        json.dump({"folders": [], "chats": []}, f)
    log("created new DB")

while True:
    req = read_message()
    if req is None:
        log("EOF, exiting")
        break

    action = req.get("action")
    log(f"action: {action}")

    if action == "save":
        data = req.get("data", {})
        log(f"saving folders={len(data.get('folders',[]))} chats={len(data.get('chats',[]))}")
        with open(DB_FILE, 'w') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        log("save ok")
        send_message({"status": "ok"})

    elif action == "load":
        with open(DB_FILE, 'r') as f:
            data = json.load(f)
        log(f"load ok folders={len(data.get('folders',[]))} chats={len(data.get('chats',[]))}")
        send_message({"status": "ok", "data": data})
