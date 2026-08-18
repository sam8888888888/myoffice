#!/usr/bin/env python3
"""MyOffice Fase 5 — Watchdog Agent Macet.
Deteksi: agent online tapi (a) tidak ada aktivitas di activity_log > 6 jam,
atau (b) currentTask sama > 6 jam (stuck). Push Telegram (dedup per agent per hari).
Cron: */30 * * * * (aaron).
"""
import json
import os
import subprocess
import urllib.request
import sys
sys.path.insert(0, "/opt/myoffice")
from office_token import auth_headers

import time
from datetime import datetime, timezone

BACKEND = "http://127.0.0.1:3121/office"
NOTIFY = ["/usr/bin/python3", "/opt/myoffice/telegram_notify.py"]
STATE_FILE = "/opt/myoffice/data/watchdog_state.json"
STUCK_HOURS = 6


def fetch(path):
    req = urllib.request.Request(BACKEND + path, headers=auth_headers("myoffice-watchdog"))
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
    fleet = fetch("/../fleet.json") if False else None
    # fleet.json dari agregator 3120
    try:
        req = urllib.request.Request("http://127.0.0.1:3120/fleet.json", headers=auth_headers("myoffice-watchdog"))
        with urllib.request.urlopen(req, timeout=10) as r:
            fleet = json.load(r).get("agents", [])
    except Exception:
        fleet = []
    if not fleet:
        print("OK fleet-unavailable")
        return

    # riwayat aktivitas dari activity log (backend timeline)
    tl = fetch("/timeline?hours=24").get("events", [])
    state = load_state()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    alerts = []

    for agent in fleet:
        aid = agent["id"]
        if agent.get("status") != "online":
            continue
        last_ts = None
        task_seen = set()
        task_first = None
        for e in tl:
            if e.get("agent") != aid:
                continue
            if last_ts is None or e["ts"] > last_ts:
                last_ts = e["ts"]
            task = e.get("task")
            if task:
                task_seen.add(task)
                if task_first is None:
                    task_first = (task, e["ts"])
        now = time.time()
        if last_ts is None:
            continue  # belum ada history
        idle_hours = (now - last_ts) / 3600
        if idle_hours > STUCK_HOURS:
            key = f"{aid}|{today}|idle"
            if state.get(key) != "1":
                state[key] = "1"
                alerts.append(f"🧊 <b>{agent.get('name', aid)}</b> idle {idle_hours:.0f} jam tanpa aktivitas")
        # stuck: task pertama masih sama & sudah lama
        if task_first and len(task_seen) == 1:
            stuck_hours = (now - task_first[1]) / 3600
            if stuck_hours > STUCK_HOURS:
                key = f"{aid}|{today}|stuck"
                if state.get(key) != "1":
                    state[key] = "1"
                    alerts.append(f"🔁 <b>{agent.get('name', aid)}</b> task stuck {stuck_hours:.0f} jam: {task_first[0][:60]}")

    save_state(state)
    if alerts:
        notify("🧠 <b>MyOffice Agent Watchdog</b>\n" + "\n".join(alerts))
        print("ALERT:", len(alerts))
        for a in alerts:
            print(" ", a)
    else:
        print("OK no-stuck-agent")


if __name__ == "__main__":
    main()
