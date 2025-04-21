import asyncio
import websockets
import json
import random
import time
import socket
import dns.resolver
import traceback


DOCUMENT = ""
VERSION = 0
OPERATIONS = []  # History of operations
CLIENTS = set()
CURSORS = {}
CLIENT_IDS = {}
CLIENT_COLORS = {}
CLIENT_PINGS = {}  # {client_id: ping_in_ms}

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

def transform_operation(op1, op2):
    """Transform op1 against op2."""
    if op1["action"] == "insert" and op2["action"] == "insert":
        if op1["pos"] <= op2["pos"]:
            return op1  # No change needed
        else:
            return {
                "action": "insert",
                "pos": op1["pos"] + len(op2["char"]),
                "char": op1["char"],
                "author": op1["author"]
            }
    
    elif op1["action"] == "insert" and op2["action"] == "delete":
        delete_count = op2.get("count", 1)
        if op1["pos"] <= op2["pos"]:
            return op1  # No change needed
        elif op1["pos"] > op2["pos"] + delete_count:
            # Insert is after the deleted section
            return {
                "action": "insert",
                "pos": op1["pos"] - delete_count,
                "char": op1["char"],
                "author": op1["author"]
            }
        else:
            # Insert is within the deleted section, move to deletion point
            return {
                "action": "insert",
                "pos": op2["pos"],
                "char": op1["char"],
                "author": op1["author"]
            }
    
    elif op1["action"] == "delete" and op2["action"] == "insert":
        if op1["pos"] < op2["pos"]:
            return op1  # No change needed
        else:
            return {
                "action": "delete",
                "pos": op1["pos"] + len(op2["char"]),
                "count": op1.get("count", 1),
                "author": op1["author"]
            }
    
    elif op1["action"] == "delete" and op2["action"] == "delete":
        delete_count1 = op1.get("count", 1)
        delete_count2 = op2.get("count", 1)
        
        if op1["pos"] < op2["pos"]:
            # Delete1 is before Delete2
            return op1  # No change needed
        elif op1["pos"] >= op2["pos"] + delete_count2:
            # Delete1 is after Delete2
            return {
                "action": "delete",
                "pos": op1["pos"] - delete_count2,
                "count": delete_count1,
                "author": op1["author"]
            }
        else:
            # Delete1 overlaps with Delete2
            overlap_start = max(op1["pos"], op2["pos"])
            overlap_end = min(op1["pos"] + delete_count1, op2["pos"] + delete_count2)
            overlap_size = overlap_end - overlap_start
            
            if op1["pos"] < op2["pos"]:
                # Delete1 starts before Delete2
                return {
                    "action": "delete",
                    "pos": op1["pos"],
                    "count": delete_count1 - overlap_size,
                    "author": op1["author"]
                }
            else:
                # Delete1 starts within or after Delete2
                remaining_count = delete_count1 - overlap_size
                if remaining_count <= 0:
                    return None  # Operation is nullified
                else:
                    return {
                        "action": "delete",
                        "pos": op2["pos"],
                        "count": remaining_count,
                        "author": op1["author"]
                    }

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
        "pings": CLIENT_PINGS,
        "colors": CLIENT_COLORS 
    }))

async def handle_message(ws, msg):
    global DOCUMENT, VERSION
    data = json.loads(msg)
    msg_type = data.get("type")

    if msg_type == "init":
        client_id = data["author"]
        while client_id in CLIENT_IDS.values():
            client_id = client_id + str(random.randint(1,1000))
        
        CLIENT_IDS[ws] = client_id
        CLIENT_COLORS[client_id] = generate_color()
        
        print(f"New connection: {client_id}")
        
        # Send initial state with version information
        await ws.send(json.dumps({
            "type": "init",
            "doc": DOCUMENT,
            "version": VERSION,
            "cursors": CURSORS,
            "colors": CLIENT_COLORS,
            "pings": CLIENT_PINGS,
            # Only send recent operations (last 50 or fewer)
            "operations": OPERATIONS[-50:] if len(OPERATIONS) > 50 else OPERATIONS
        }))
        
        await broadcast_user_update()
    elif msg_type == "edit":
        op = data["op"]
        author = data["author"]
        base_version = data.get("baseVersion", VERSION)
        
        # Store operation in history with metadata
        operation = {
            "action": op["action"],
            "pos": op["pos"],
            "char": op.get("char", ""),  # For insert operations
            "count": op.get("count", 1),  # For delete operations, default to 1
            "author": author,
            "version": VERSION,
            "baseVersion": base_version
        }
        OPERATIONS.append(operation)
        
        # Apply operation to document
        if op["action"] == "insert":
            DOCUMENT = DOCUMENT[:op["pos"]] + op["char"] + DOCUMENT[op["pos"]:]
        elif op["action"] == "delete":
            delete_count = op.get("count", 1)  # Get count or default to 1
            if 0 <= op["pos"] < len(DOCUMENT):
                DOCUMENT = DOCUMENT[:op["pos"]] + DOCUMENT[op["pos"] + delete_count:]
        
        VERSION += 1
        
        # Broadcast operation with version information
        await broadcast(json.dumps({
            "type": "edit",
            "op": op,
            "version": VERSION,
            "baseVersion": base_version,
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
    
    elif msg_type == "dns_resolve":
        domain = data.get("domain")
        author = data.get("author")
        
        try:
            # Create a resolver instance
            resolver = dns.resolver.Resolver()
            
            # Get A records (IPv4 addresses)
            a_records = []
            try:
                answers = resolver.resolve(domain, 'A')
                for rdata in answers:
                    a_records.append(rdata.to_text())
            except Exception as e:
                a_records = [f"Error retrieving A records: {str(e)}"]
            
            # Get AAAA records (IPv6 addresses)
            aaaa_records = []
            try:
                answers = resolver.resolve(domain, 'AAAA')
                for rdata in answers:
                    aaaa_records.append(rdata.to_text())
            except Exception:
                aaaa_records = []
            
            # Get MX records (mail servers)
            mx_records = []
            try:
                answers = resolver.resolve(domain, 'MX')
                for rdata in answers:
                    mx_records.append(f"{rdata.preference} {rdata.exchange}")
            except Exception:
                mx_records = []
            
            # Get NS records (name servers)
            ns_records = []
            try:
                answers = resolver.resolve(domain, 'NS')
                for rdata in answers:
                    ns_records.append(rdata.to_text())
            except Exception:
                ns_records = []
            
            # Get TXT records
            txt_records = []
            try:
                answers = resolver.resolve(domain, 'TXT')
                for rdata in answers:
                    txt_records.append(rdata.to_text())
            except Exception:
                txt_records = []
            
            # Send results back to client
            await ws.send(json.dumps({
                "type": "dns_result",
                "domain": domain,
                "a_records": a_records,
                "aaaa_records": aaaa_records,
                "mx_records": mx_records,
                "ns_records": ns_records,
                "txt_records": txt_records
            }))
            
        except Exception as e:
            error_message = str(e)
            traceback_str = traceback.format_exc()
            print(f"DNS resolution error: {error_message}")
            print(traceback_str)
            
            await ws.send(json.dumps({
                "type": "dns_result",
                "domain": domain,
                "error": error_message
            }))

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