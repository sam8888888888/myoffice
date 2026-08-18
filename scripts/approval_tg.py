#!/usr/bin/env python3
"""Approval 2-arah via Telegram (F2-6).
1) Kirim notif approval baru + inline keyboard ✅/❌
2) Polling getUpdates → handle callback approve/reject → panggil backend
Cron: * * * * *  (guard anti-konflik: kalau 409, mati sendiri + alert)
"""
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, "/opt/myoffice")
from office_token import auth_headers

TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
CHAT_ID = os.environ.get("MYOFFICE_TG_CHAT_ID", "")
BASE = os.environ.get("MYOFFICE_BASE", "http://127.0.0.1:3121")
STATE_FILE = "/opt/myoffice/data/approval_tg_state.json"

if not TOKEN or not CHAT_ID:
    # fallback baca dari /opt/myoffice/.env (tanpa sudo)
    try:
        with open("/opt/myoffice/.env") as f:
            for line in f:
                line = line.strip()
                if line.startswith("MYOFFICE_TG_BOT_TOKEN="):
                    TOKEN = line.split("=", 1)[1].strip()
                elif line.startswith("MYOFFICE_TG_CHAT_ID="):
                    CHAT_ID = line.split("=", 1)[1].strip()
    except Exception:
        pass
if not TOKEN or not CHAT_ID:
    # fallback terakhir: env root hermes (via sudo — butuh NOPASSWD)
    try:
        import subprocess
        out = subprocess.run(["sudo", "-n", "grep", "-E", "^(TELEGRAM_BOT_TOKEN|MYOFFICE_TG_CHAT_ID)=", "/root/.hermes/.env"],
                             capture_output=True, text=True, timeout=5).stdout
        for line in out.splitlines():
            if line.startswith("TELEGRAM_BOT_TOKEN=") and not TOKEN:
                TOKEN = line.split("=", 1)[1].strip()
            elif line.startswith("MYOFFICE_TG_CHAT_ID=") and not CHAT_ID:
                CHAT_ID = line.split("=", 1)[1].strip()
    except Exception:
        pass
if not TOKEN or not CHAT_ID:
    print("token/chat_id tidak tersedia")
    sys.exit(0)


def tg(method, payload):
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{TOKEN}/{method}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}")


def office(method, path, body=None):
    try:
        req = urllib.request.Request(BASE + path, headers=auth_headers("approval-tg"))
        if body is not None:
            req = urllib.request.Request(
                BASE + path, data=json.dumps(body).encode(),
                headers={**auth_headers("approval-tg"), "Content-Type": "application/json"}, method="POST",
            )
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"ok": False, "error": str(e)}


def load_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {"notified": [], "offset": 0}


def save_state(st):
    try:
        with open(STATE_FILE, "w") as f:
            json.dump(st, f)
    except Exception:
        pass


def notify_new_approvals(st):
    """Kirim notif approval pending yang belum pernah dikirim."""
    data = office("GET", "/office/approvals")
    items = data.get("items", []) if isinstance(data, dict) else []
    pending = [i for i in items if i.get("status") == "pending"]
    known = set(st.get("notified", []))
    for ap in pending:
        if ap["id"] in known:
            continue
        kb = {
            "inline_keyboard": [[
                {"text": "✅ Approve", "callback_data": f"ap_ok:{ap['id']}"},
                {"text": "❌ Reject", "callback_data": f"ap_no:{ap['id']}"},
            ]]
        }
        text = (
            f"🛂 <b>APPROVAL MENUNGGU</b>\n"
            f"• <b>{ap.get('title', '')}</b>\n"
            f"• {ap.get('agent', '?')} · risiko {ap.get('risk', '?')} · tipe {ap.get('type', '?')}\n"
            f"• {ap.get('detail', '')[:120]}"
        )
        r = tg("sendMessage", {"chat_id": CHAT_ID, "text": text, "parse_mode": "HTML", "reply_markup": kb})
        if r.get("ok"):
            known.add(ap["id"])
    st["notified"] = list(known)[-200:]


def poll_callbacks(st):
    """Polling getUpdates → handle callback approve/reject."""
    off = st.get("offset", 0)
    r = tg("getUpdates", {"offset": off, "timeout": 15, "allowed_updates": ["callback_query"]})
    if not r.get("ok"):
        desc = str(r.get("description", ""))
        if "409" in desc or "Conflict" in desc:
            # log saja (jangan spam alert Telegram)
            print("conflict — skip run")
            return
        return
    processed = set(st.get("processed", []))
    for u in r.get("result", []):
        st["offset"] = u["update_id"] + 1
        cq = u.get("callback_query") or {}
        data = cq.get("data", "")
        cqid = cq.get("id", "")
        if data.startswith("ap_"):
            action, aid = data.split(":", 1)
            if cqid in processed:
                continue  # sudah diproses — jangan kirim konfirmasi ulang
            processed.add(cqid)
            processed = set(list(processed)[-200:])
            st["processed"] = list(processed)
            decision = "approved" if action == "ap_ok" else "rejected"
            res = office("POST", f"/office/approvals/{aid}/decision",
                         {"decision": decision, "note": "via Telegram", "decided_by": "telegram"})
            ok = res.get("ok", False)
            tg("answerCallbackQuery", {"callback_query_id": cqid, "text": f"{'✅' if ok else '⚠️'} {decision}"})
            # hapus tombol dari pesan (anti klik ulang) + edit teks
            try:
                tg("editMessageReplyMarkup", {
                    "chat_id": CHAT_ID,
                    "message_id": cq.get("message", {}).get("message_id"),
                    "reply_markup": {"inline_keyboard": []},
                })
            except Exception:
                pass
            try:
                tg("sendMessage", {"chat_id": CHAT_ID, "text": f"{'✅' if ok else '⚠️'} Approval <b>{aid}</b> → <b>{decision}</b> (via Telegram)", "parse_mode": "HTML"})
            except Exception:
                pass
        else:
            st["offset"] = u["update_id"] + 1
    save_state(st)


def main():
    if os.environ.get("MYOFFICE_TG_POLLING", "1") == "0":
        return
    st = load_state()
    try:
        notify_new_approvals(st)
    except Exception as e:
        print("notify err:", e)
    try:
        poll_callbacks(st)
    except Exception as e:
        print("poll err:", e)


if __name__ == "__main__":
    main()
