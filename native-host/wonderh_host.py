#!/usr/bin/env python3
import sys, json, struct, os

DB_FILE = os.path.expanduser("~/wonderh_ai_data.json")

def send_message(message):
    content = json.dumps(message).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('@I', len(content)))
    sys.stdout.buffer.write(content)
    sys.stdout.buffer.flush()

def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length: return None
    message_length = struct.unpack('@I', raw_length)[0]
    return json.loads(sys.stdin.buffer.read(message_length).decode('utf-8'))

if not os.path.exists(DB_FILE):
    with open(DB_FILE, 'w') as f:
        json.dump({"folders": [], "chats": []}, f)

while True:
    req = read_message()
    if req is None: break
    if req.get("action") == "save":
        with open(DB_FILE, 'w') as f:
            json.dump(req["data"], f, indent=2, ensure_ascii=False)
        send_message({"status": "ok"})
    elif req.get("action") == "load":
        with open(DB_FILE, 'r') as f:
            send_message({"status": "ok", "data": json.load(f)})
