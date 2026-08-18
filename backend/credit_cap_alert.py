#!/usr/bin/env python3
"""MyOffice Fase 5 — Credit Cap + Spend Alert.
Cek payroll vs caps: over & auto_pause → pause agent otomatis.
Spend warning (>=80%) & over (>=100%) → push Telegram (dedup per agent per hari).
Cron: */15 * * * * (aaron).
"""
import json
import os
import subprocess
import urllib.request
import sys
sys.path.insert(0, "/opt/myoffice")
from office_token import auth_headers

from datetime import datetime, timezone

BACKEND = "http://127.0.0.1:3121/office"
NOTIFY = ["/usr/bin/python3", "/opt/myoffice/telegram_notify.py"]
STATE_FILE = "/opt/myoffice/data/spend_alert_state.json"


def fetch(path):
    req = urllib.request.Request(BACKEND + path, headers=auth_headers("myoffice-cap-alert"))
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


def load_state():
    try:
        return json.load(open(STATE_FILE))
    except Exception:
        return {}


def save_state(st):
    json.dump(st, open(STATE_FILE, "w"), indent=2)


def notify(text):
    try:
        subprocess.run(NOTIFY + [text], capture_output=True, text=True, timeout=30)
    except Exception:
        pass


def main():
    payroll = fetch("/payroll").get("rows", [])
    caps = fetch("/caps")
    auto_pause = caps.get("auto_pause", True)
    agent_caps = caps.get("agent_caps", {})
    state = load_state()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    alerts = []
    pauses = []

    for r in payroll:
        aid = r["id"]
        pct = r.get("pct", 0)
        status = r.get("status", "ok")
        cap = agent_caps.get(aid, 0)
        if status == "over":
            key = f"{aid}|{today}|over"
            if state.get(key) != "1":
                state[key] = "1"
                alerts.append(f"🔴 <b>{r['name']}</b> OVER budget ({pct}%) — spent ${r['spent_usd']:.2f} vs cap ${cap}")
            if auto_pause:
                # pastikan agent di-pause (idempoten) — cek status dulu, jangan pause ulang
                try:
                    ctrl_req = urllib.request.Request(
                        BACKEND + "/controls", headers=auth_headers("myoffice-cap-alert"))
                    with urllib.request.urlopen(ctrl_req, timeout=10) as cr:
                        ctrl_data = json.load(cr)
                    already_paused = any(
                        c.get("agent") == aid and c.get("paused")
                        for c in ctrl_data.get("items", [])
                    )
                except Exception:
                    already_paused = False
                if not already_paused:
                    try:
                        post = urllib.request.Request(
                            BACKEND + "/controls/agent",
                            data=json.dumps({"agent": aid, "paused": True, "reason": f"Credit cap exceeded ({pct}%)"}).encode(),
                            headers={**auth_headers("myoffice-cap-alert"), "Content-Type": "application/json"}, method="POST")
                        with urllib.request.urlopen(post, timeout=10):
                            pauses.append(aid)
                    except Exception:
                        pass
        elif status == "warning":
            key = f"{aid}|{today}|warning"
            if state.get(key) != "1":
                state[key] = "1"
                alerts.append(f"🟡 <b>{r['name']}</b> mendekati cap ({pct}%) — ${r['spent_usd']:.2f} / ${cap}")

    save_state(state)
    if alerts:
        notify("💰 <b>MyOffice Spend Alert</b>\n" + "\n".join(alerts))
        print("ALERT:", len(alerts))
        for a in alerts:
            print(" ", a)
    if pauses:
        print("AUTO-PAUSE:", ",".join(pauses))
    else:
        print("OK no-spend-alert")


if __name__ == "__main__":
    main()
