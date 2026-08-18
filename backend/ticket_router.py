#!/usr/bin/env python3
"""Ticket Router — otomatis assign tiket antrian yang sudah menunggu (fix #1 agentic).
- Tiket open > 30 menit → assign ke agent dengan beban in_progress paling kecil (rotasi).
- Tiket high > 10 menit → prioritas assign cepat.
- Kirim notif Telegram + tulis inbox agent.
Cron: */15 * * * * (aaron).
"""
import json
import sys
import urllib.request

sys.path.insert(0, "/opt/myoffice")
from office_token import auth_headers  # noqa

BACKEND = "http://127.0.0.1:3121/office"
AGENT_ORDER = ["rena", "farrah", "nadine", "aaron", "dinda"]

def api(path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BACKEND + path, data=data, method=method,
                                 headers={**auth_headers("myoffice-ticket-router"), "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)

def main():
    try:
        queue = api("/tickets/queue").get("items", [])
        stats = api("/tickets/stats").get("rows", [])
    except Exception as e:
        print("err:", e)
        return
    if not queue:
        print("antrian kosong")
        return
    # beban per agent: in_progress aktif
    load = {r["agent"]: r["in_progress"] for r in stats}
    import datetime
    now = datetime.datetime.now(datetime.timezone.utc)
    assigned = []
    for t in queue:
        try:
            created = datetime.datetime.fromisoformat(t["created_at"].replace("Z", "+00:00"))
            age_min = (now - created).total_seconds() / 60
        except Exception:
            age_min = 999
        threshold = 10 if t.get("priority") == "high" else 30
        if age_min < threshold:
            continue
        # pilih agent beban terkecil (rotasi)
        agent = min(AGENT_ORDER, key=lambda a: load.get(a, 0))
        try:
            api(f"/tickets/{t['id']}/action", "POST",
                {"action": "assign", "agent": agent, "by": "router", "note": "auto-router"})
            load[agent] = load.get(agent, 0) + 1
            assigned.append(f"• {t['title'][:50]} → {agent}")
        except Exception as e:
            print("assign gagal:", t["id"], e)
    if assigned:
        import subprocess
        subprocess.run(["/usr/bin/python3", "/opt/myoffice/telegram_notify.py",
                        "🔁 <b>Router Tiket</b> — auto-assign:\n" + "\n".join(assigned)],
                       capture_output=True, text=True, timeout=30)
    print(f"queue {len(queue)}, assigned {len(assigned)}")

if __name__ == "__main__":
    main()
