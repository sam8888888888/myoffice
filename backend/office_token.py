#!/usr/bin/env python3
"""Helper token untuk MyOffice office backend (127.0.0.1:3121).

Semua consumer (watchdog, cap-alert, shift/sla/standup/weekly) memakai
auth_headers() supaya request membawa X-Office-Token. Token dibaca dari
env MYOFFICE_API_TOKEN atau fallback /opt/myoffice/.env.
"""

import os

ENV_FILE = "/opt/myoffice/.env"


def office_token():
    t = os.environ.get("MYOFFICE_API_TOKEN")
    if t:
        return t
    try:
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("MYOFFICE_API_TOKEN="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return ""


def auth_headers(user_agent):
    h = {"User-Agent": user_agent}
    tok = office_token()
    if tok:
        h["X-Office-Token"] = tok
    return h
