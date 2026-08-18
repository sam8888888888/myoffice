#!/usr/bin/env python3
"""MyOffice #4 — Shift alert: deteksi lembur & bolos → log.
Cron: */30 * * * * (aaron). Dedup by agent+date.
"""
import json
import os
import subprocess
import urllib.request
import sys
sys.path.insert(0, "/opt/myoffice")
from office_token import auth_headers

from datetime import datetime, timezone

BACKEND = "http://127.0.0.1:3121/office/shift"
ALERT_LOG = "/opt/myoffice/logs/shift_alerts.log"


def fetch():
    req = urllib.request.Request(BACKEND, headers=auth_headers("myoffice-shift-alert"))
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


def main():
    os.makedirs(os.path.dirname(ALERT_LOG), exist_ok=True)
    data = fetch()
    today = data.get("today", "")
    seen = set()
    if os.path.exists(ALERT_LOG):
        with open(ALERT_LOG, "r", encoding="utf-8") as f:
            for line in f:
                parts = line.strip().split("|")
                # fix dedup: simpan id|date|type (bukan cuma id)
                if len(parts) >= 3:
                    seen.add(f"{parts[0]}|{parts[1]}|{parts[2]}")

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    new_alerts = []
    for r in data.get("rows", []):
        if r.get("absent"):
            key = f"{r['id']}|{today}|bolos"
            if key not in seen:
                new_alerts.append(f"{key}|{now}|Tidak ada aktivitas jam kerja")
        if r.get("overtime_alert"):
            key = f"{r['id']}|{today}|lembur"
            if key not in seen:
                new_alerts.append(f"{key}|{now}|Lembur {r.get('overtime_hours')}h")

    if new_alerts:
        with open(ALERT_LOG, "a", encoding="utf-8") as f:
            for line in new_alerts:
                f.write(line + "\n")
        print("ALERT:", len(new_alerts))
        for line in new_alerts:
            print(" ", line)
        # push Telegram
        try:
            subprocess.run(
                ["/usr/bin/python3", "/opt/myoffice/telegram_notify.py",
                 "🕐 <b>MyOffice Shift Alert</b>\n" + "\n".join(
                     f"• {l.split('|')[0]} {l.split('|')[2]} — {l.split('|')[4]}" for l in new_alerts
                 )],
                capture_output=True, text=True, timeout=30,
            )
        except Exception as e:
            print("tg-err:", e)
    else:
        print("OK no-new-alerts")


if __name__ == "__main__":
    main()
