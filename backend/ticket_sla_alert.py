#!/usr/bin/env python3
"""Ticket SLA Alert — kirim Telegram saat tiket expiring/expired (fix #3).
Cron: */5 * * * * (aaron). Dedupe via data/notify_state.json (pola sla_alert.py).
"""
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, "/opt/myoffice")
from office_token import auth_headers  # noqa

BACKEND = "http://127.0.0.1:3121/office/tickets"
STATE = "/opt/myoffice/data/notify_state.json"

def get_tickets():
    req = urllib.request.Request(BACKEND, headers=auth_headers("myoffice-ticket-sla"))
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r).get("items", [])

def send_tg(text):
    import subprocess
    subprocess.run(["/usr/bin/python3", "/opt/myoffice/telegram_notify.py", text],
                   capture_output=True, text=True, timeout=30)

def main():
    try:
        items = get_tickets()
    except Exception as e:
        print("err:", e)
        return
    st = {}
    if os.path.exists(STATE):
        try:
            st = json.load(open(STATE))
        except Exception:
            st = {}
    now = time.time()
    alert = []
    for t in items:
        if t.get("status") not in ("open", "in_progress"):
            continue
        sla = t.get("sla_status")
        if sla not in ("expiring", "expired"):
            continue
        key = "ticket_sla_" + t["id"] + "_" + sla
        last = st.get(key, 0)
        if now - last < 1800:  # alert ulang maks 30 menit
            continue
        st[key] = now
        emoji = "🔴" if sla == "expired" else "🟡"
        agent = f" (👤 {t['agent']})" if t.get("agent") else " (antrian)"
        alert.append(f"{emoji} <b>{t['title'][:60]}</b> {sla} — deadline {t.get('deadline','?')[:16]}{agent}")
    if alert:
        send_tg("⏰ <b>SLA TIKET</b>\n" + "\n".join(alert))
    try:
        json.dump(st, open(STATE, "w"))
    except Exception:
        pass
    print(f"checked {len(items)} tiket, alert {len(alert)}")

if __name__ == "__main__":
    main()
