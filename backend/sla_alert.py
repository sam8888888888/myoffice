#!/usr/bin/env python3
"""MyOffice #2 — SLA alert untuk Approval Queue.
Scan approval pending yang expired/expiring → tulis alert ke log.
Cron: */5 * * * * (aaron).
"""
import json
import os
import subprocess
import urllib.request
import sys
sys.path.insert(0, "/opt/myoffice")
from office_token import auth_headers

from datetime import datetime, timezone

BACKEND = "http://127.0.0.1:3121/office/approvals"
ALERT_LOG = "/opt/myoffice/logs/sla_alerts.log"


def fetch():
    req = urllib.request.Request(BACKEND, headers=auth_headers("myoffice-sla-alert"))
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


def main():
    os.makedirs(os.path.dirname(ALERT_LOG), exist_ok=True)
    data = fetch()
    now = datetime.now(timezone.utc)
    seen = set()
    if os.path.exists(ALERT_LOG):
        with open(ALERT_LOG, "r", encoding="utf-8") as f:
            for line in f:
                if "|" in line:
                    seen.add(line.split("|")[0])

    new_alerts = []
    for item in data.get("items", []):
        if item.get("status") != "pending":
            continue
        sla = item.get("sla_status")
        if sla in ("expired", "expiring"):
            line = f"{item['id']}|{now.isoformat(timespec='seconds')}|{item.get('agent')}|{sla}|{item.get('title','')[:60]}"
            if item["id"] not in seen:
                new_alerts.append(line)

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
                 "⏰ <b>MyOffice SLA Alert</b>\n" + "\n".join(
                     f"• {l.split('|')[2]} — {l.split('|')[3]}: {l.split('|')[4]}" for l in new_alerts
                 )],
                capture_output=True, text=True, timeout=30,
            )
        except Exception as e:
            print("tg-err:", e)
    else:
        print("OK no-new-alerts")


if __name__ == "__main__":
    main()
