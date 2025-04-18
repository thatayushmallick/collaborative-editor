import asyncio
import websockets
import json
import random
import time
import socket

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        local_ip = s.getsockname()[0]
    except Exception:
        local_ip = '127.0.0.1'
    finally:
        s.close()
    return local_ip

DOCUMENT = ""
VERSION = 0
CLIENTS = set()
CURSORS = {}
CLIENT_IDS = {}
CLIENT_COLORS = {}
CLIENT_PINGS = {}  # {client_id: ping_in_ms}

def generate_color():
    r = random.randint(50, 255)
    g = random.randint(50, 255)
    b = random.randint(50, 255)
    return f"#{r:02x}{g:02x}{b:02x}"

async def broadcast(message, exclude=None):
    for client in CLIENTS:
        if client != exclude:
            await client.send(message)

async def broadcast_user_update():
    await broadcast(json.dumps({
        "type": "user_update",
        "users": list(CLIENT_IDS.values()),
        "pings": CLIENT_PINGS
    }))

async def handle_message(ws, msg):
    global DOCUMENT, VERSION
    data = json.loads(msg)
    msg_type = data.get("type")

    if msg_type == "init":
        client_id = data["author"]
        CLIENT_IDS[ws] = client_id
        CLIENT_COLORS[client_id] = generate_color()
        print(f"New connection: {client_id}")
        await ws.send(json.dumps({
            "type": "init",
            "doc": DOCUMENT,
            "version": VERSION,
            "cursors": CURSORS,
            "colors": CLIENT_COLORS,
            "pings": CLIENT_PINGS
        }))
        await broadcast_user_update()

    elif msg_type == "edit":
        op = data["op"]
        author = data["author"]

        if op["action"] == "insert":
            DOCUMENT = DOCUMENT[:op["pos"]] + op["char"] + DOCUMENT[op["pos"]:]
        elif op["action"] == "delete":
            if 0 <= op["pos"] < len(DOCUMENT):
                DOCUMENT = DOCUMENT[:op["pos"]] + DOCUMENT[op["pos"] + 1:]

        VERSION += 1
        await broadcast(json.dumps({
            "type": "edit",
            "op": op,
            "version": VERSION,
            "author": author
        }), exclude=ws)

    elif msg_type == "cursor":
        author = data["author"]
        CURSORS[author] = data["pos"]
        await broadcast(json.dumps({
            "type": "cursor",
            "author": author,
            "pos": data["pos"],
            "color": CLIENT_COLORS.get(author, "#000000")
        }), exclude=ws)

    elif msg_type == "pong":
        latency_ms = int((time.time() - data["timestamp"]) * 1000)
        CLIENT_PINGS[data["author"]] = latency_ms
        await broadcast_user_update()

async def handler(ws):
    CLIENTS.add(ws)
    try:
        async def ping_loop():
            while True:
                await asyncio.sleep(3)
                if ws in CLIENTS:
                    await ws.send(json.dumps({
                        "type": "ping",
                        "timestamp": time.time()
                    }))

        asyncio.create_task(ping_loop())

        async for msg in ws:
            await handle_message(ws, msg)

    except websockets.exceptions.ConnectionClosed:
        print(f"User disconnected: {CLIENT_IDS.get(ws, 'Unknown')}")
    finally:
        CLIENTS.remove(ws)
        author = CLIENT_IDS.pop(ws, None)
        print(author)
        if author:
            CURSORS.pop(author, None)
            CLIENT_PINGS.pop(author, None)
            
            # Broadcast updated cursor information to all clients
            await broadcast(json.dumps({
                "type": "cursor_update",
                "cursors": CURSORS,
                "colors": CLIENT_COLORS
            }))
            
        await broadcast_user_update()

async def main():
    HOST = get_local_ip()
    PORT = 8765
    print(f"\nServer running on ws://{HOST}:{PORT}")
    async with websockets.serve(handler, HOST, PORT):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
