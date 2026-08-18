#!/usr/bin/env python3
"""MyOffice Telegram Notifier — kirim pesan alert ke Papi via Bot API.
Token: TELEGRAM_BOT_TOKEN dari /root/.hermes/.env (Hostinger gateway Rena).
Pemakaian: python3 telegram_notify.py "teks pesan"
"""
import json
import os
import subprocess
import sys
import urllib.request

CHAT_ID = "857988821"  # Home channel Telegram Papi


def get_token():
    # baca dari env gateway Rena
    try:
        out = subprocess.run(
            ["sudo", "-n", "grep", "^TELEGRAM_BOT_TOKEN=", "/root/.hermes/.env"],
            capture_output=True, text=True, timeout=10,
        ).stdout.strip()
        if out:
            return out.split("=", 1)[1]
    except Exception:
        pass
    return os.environ.get("TELEGRAM_BOT_TOKEN", "")


def send(text: str) -> bool:
    token = get_token()
    if not token:
        print("NO_TOKEN")
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = json.dumps({
        "chat_id": CHAT_ID,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }).encode()
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode())
        ok = bool(data.get("ok"))
        print("SENT" if ok else "FAIL:" + str(data))
        return ok
    except Exception as e:
        print("ERR:" + str(e))
        return False


if __name__ == "__main__":
    text = " ".join(sys.argv[1:])
    if not text:
        print("usage: telegram_notify.py <text>")
        sys.exit(1)
    send(text)
