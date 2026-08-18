#!/usr/bin/env python3
"""Morning Brief MyOffice — ringkasan harian via Telegram tiap 07.00 WIB.
Data: fleet status, budget, task selesai kemarin, approvals pending, perlu perhatian.
Cron: 0 0 * * * (UTC) = 07:00 WIB.
"""
import json
import os
import sys
import urllib.request

sys.path.insert(0, "/opt/myoffice")
from office_token import auth_headers
from telegram_notify import send as tg_send


def get_json(url):
    try:
        req = urllib.request.Request(url, headers=auth_headers("morning-brief"))
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.loads(r.read())
    except Exception:
        return {}


def main():
    base = os.environ.get("MYOFFICE_BASE", "http://127.0.0.1:3121")
    fleet = get_json(base + "/office/fleet")
    approvals = get_json(base + "/office/approvals")
    kpi = get_json(base + "/office/kpi")
    payroll = get_json(base + "/office/payroll")
    incidents = get_json(base + "/office/incidents")

    agents = fleet.get("agents", []) if isinstance(fleet, dict) else []
    pending = approvals.get("pending_count", 0) if isinstance(approvals, dict) else 0
    open_inc = incidents.get("open", 0) if isinstance(incidents, dict) else 0
    rows = kpi.get("rows", []) if isinstance(kpi, dict) else []
    pay_rows = payroll.get("rows", []) if isinstance(payroll, dict) else []

    lines = ["🌅 <b>Morning Brief — Status Tim Hari Ini</b>", ""]
    if agents:
        lines.append("📊 <b>STATUS FLEET:</b>")
        for a in agents[:6]:
            st = a.get("status", "?")
            emoji = {"online": "🟢", "offline": "🔴", "degraded": "🟡"}.get(st, "⚪")
            task = a.get("currentTask") or ""
            lines.append(f"• {emoji} {a.get('name', a.get('id'))}: {st}" + (f" | {task[:40]}" if task else ""))
        lines.append("")
    if pay_rows:
        lines.append("💰 <b>BUDGET:</b>")
        for r in pay_rows[:5]:
            lines.append(f"• {r.get('id')}: {r.get('pct', 0)}% terpakai")
        lines.append("")
    done_today = sum(1 for r in rows if r.get("tasks_completed", 0))
    lines.append(f"📋 <b>TASK SELESAI:</b> {done_today} task")
    lines.append(f"🛂 <b>APPROVAL MENUNGGU:</b> {pending}")
    if open_inc:
        lines.append(f"🚨 <b>PERLU PERHATIAN:</b> {open_inc} incident open")
    else:
        lines.append("✅ Semua agent sehat, tidak ada incident")
    lines.append("")
    lines.append("_Dibuat otomatis oleh MyOffice · Ketuk untuk buka dashboard_")

    msg = "\n".join(lines)
    try:
        tg_send(msg)
        print("morning brief terkirim")
    except Exception as e:
        print(f"gagal kirim: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
