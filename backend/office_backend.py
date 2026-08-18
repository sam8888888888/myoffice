#!/usr/bin/env python3
"""
MyOffice Office Backend — Fase 3 MVP
Endpoint API untuk Approval Queue, Org Chart, KPI Scorecard, Payroll Token.
Data tersimpan sebagai JSON di /opt/myoffice/data/ (human-readable, git-able).
Listen HTTP port 3121, dipanggil oleh Hermes Studio route proxy /api/office/*.
"""
import hashlib
import hmac
import json
import math
import os
import re
import threading
import time
import urllib.request
import urllib.parse
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DATA_DIR = os.environ.get("MYOFFICE_DATA_DIR", "/opt/myoffice/data")
# CORS dibatasi: default localhost (frontend proxy same-origin tidak butuh CORS).
# Set MYOFFICE_CORS_ORIGIN kalau ada frontend lain yang butuh akses langsung.
CORS_ORIGIN = os.environ.get("MYOFFICE_CORS_ORIGIN", "http://127.0.0.1")
FLEET_URL = os.environ.get("MYOFFICE_FLEET_URL", "http://127.0.0.1:3120/fleet.json")
PORT = int(os.environ.get("MYOFFICE_PORT", "3121"))

LOCK = threading.Lock()

# ---------- auth ----------

def _office_token():
    """Token akses office backend: env MYOFFICE_API_TOKEN, fallback .env."""
    t = os.environ.get("MYOFFICE_API_TOKEN")
    if t:
        return t
    try:
        env_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), ".env"
        )
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("MYOFFICE_API_TOKEN="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return ""

# ---------- helpers ----------

def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def load_json(path, default):
    with LOCK:
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except FileNotFoundError:
            return default
        except Exception:
            return default


def save_json(path, data):
    with LOCK:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        try:
            os.chmod(tmp, 0o600)  # anti bocor ke user lokal lain (defense-in-depth)
        except Exception:
            pass
        os.replace(tmp, path)


VERSIONS_DIR = os.path.join(DATA_DIR, "versions")
VERSIONS_KEEP = 10


def save_versioned(resource, data):
    """Simpan store + backup versi lama ke data/versions/ (draft→publish + rollback point)."""
    path = os.path.join(DATA_DIR, resource + ".json")
    old = load_json(path, {})
    if old and old != data:
        try:
            os.makedirs(VERSIONS_DIR, exist_ok=True)
            ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
            vpath = os.path.join(VERSIONS_DIR, f"{resource}_{ts}.json")
            with open(vpath, "w", encoding="utf-8") as f:
                json.dump(old, f, indent=2, ensure_ascii=False)
            files = sorted(f for f in os.listdir(VERSIONS_DIR) if f.startswith(resource + "_"))
            for stale in files[:-VERSIONS_KEEP]:
                try:
                    os.remove(os.path.join(VERSIONS_DIR, stale))
                except Exception:
                    pass
        except Exception:
            pass
    save_json(path, data)


def list_versions(resource):
    """Daftar versi lama sebuah resource (untuk rollback)."""
    try:
        os.makedirs(VERSIONS_DIR, exist_ok=True)
        files = sorted(f for f in os.listdir(VERSIONS_DIR) if f.startswith(resource + "_"))
        out = []
        for f in files:
            ts = f.replace(resource + "_", "").replace(".json", "")
            try:
                with open(os.path.join(VERSIONS_DIR, f), encoding="utf-8") as fh:
                    size = len(fh.read())
            except Exception:
                size = 0
            out.append({"version": f, "ts": ts, "size": size})
        return out
    except Exception:
        return []


def rollback_resource(resource, version):
    """Kembalikan resource ke versi lama. Return (data, error)."""
    if not re.match(r"^[a-z0-9_]+$", resource):
        return None, "resource tidak valid"
    # anti path traversal: basename + realpath + startswith
    vpath = os.path.realpath(os.path.join(VERSIONS_DIR, os.path.basename(version)))
    if not vpath.startswith(os.path.realpath(VERSIONS_DIR) + os.sep) or not os.path.exists(vpath):
        return None, "versi tidak ditemukan"
    try:
        with open(vpath, encoding="utf-8") as f:
            data = json.load(f)
        save_versioned(resource, data)  # simpan state saat ini sebagai versi baru (anti kehilangan)
        return data, None
    except Exception as e:
        return None, str(e)


# ---------- vault + artifacts versioning (Tahap 5) ----------

VAULT_ROOT = os.environ.get("MYOFFICE_VAULT_ROOT", "/opt/myoffice/workspace")
VAULT_MAX_READ = 200 * 1024
VAULT_VERSIONS_DIR = os.path.join(VAULT_ROOT, ".versions")
VAULT_KEEP = 5


def _vault_safe(rel):
    """Anti path traversal: pastikan path final di dalam VAULT_ROOT.
    Pakai abspath (BUKAN realpath) — vault/data adalah symlink bind-mount ke luar,
    realpath akan membawa path keluar base dan memblokir file sah."""
    base = os.path.abspath(VAULT_ROOT)
    p = os.path.abspath(os.path.join(base, rel))
    if p != base and not p.startswith(base + os.sep):
        return None
    return p


def vault_list():
    files = []
    for dirname in ("vault", "data"):
        base = os.path.join(VAULT_ROOT, dirname)
        if not os.path.isdir(base):
            continue
        for root, _, fnames in os.walk(base):
            for fn in fnames:
                if fn.startswith("."):
                    continue
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, VAULT_ROOT)
                try:
                    st = os.stat(full)
                    files.append({
                        "dir": dirname, "name": fn, "path": rel.replace(os.sep, "/"),
                        "size": st.st_size, "modified": st.st_mtime,
                    })
                except Exception:
                    pass
    files.sort(key=lambda f: f["path"])
    return files


def vault_read(rel):
    p = _vault_safe(rel)
    if not p or not os.path.isfile(p):
        return {"ok": False, "error": "file tidak ditemukan"}
    try:
        if os.path.getsize(p) > VAULT_MAX_READ:
            return {"ok": False, "error": "file terlalu besar (>200KB)"}
        with open(p, encoding="utf-8", errors="replace") as f:
            return {"ok": True, "name": os.path.basename(rel), "content": f.read()}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def vault_save(rel, content):
    p = _vault_safe(rel)
    if not p:
        return {"ok": False, "error": "path tidak valid"}
    if len(content or "") > VAULT_MAX_READ:  # reuse limit 200KB — anti disk fill
        return {"ok": False, "error": f"konten terlalu besar (maks {VAULT_MAX_READ // 1024}KB)"}
    try:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        if os.path.exists(p):
            os.makedirs(VAULT_VERSIONS_DIR, exist_ok=True)
            vrel = rel.replace("/", "__")
            ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
            vpath = os.path.join(VAULT_VERSIONS_DIR, f"{vrel}.{ts}.bak")
            try:
                with open(p, "rb") as src, open(vpath, "wb") as dst:
                    dst.write(src.read())
            except Exception:
                pass
            try:
                import glob
                vers = sorted(glob.glob(os.path.join(VAULT_VERSIONS_DIR, vrel + ".*.bak")))
                for stale in vers[:-VAULT_KEEP]:
                    os.remove(stale)
            except Exception:
                pass
        with open(p, "w", encoding="utf-8") as f:
            f.write(content)
        return {"ok": True, "path": rel}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def vault_versions(rel):
    vrel = rel.replace("/", "__")
    try:
        import glob
        pat = os.path.join(VAULT_VERSIONS_DIR, vrel + ".*.bak")
        out = []
        for v in sorted(glob.glob(pat)):
            ts = os.path.basename(v).replace(vrel + ".", "").replace(".bak", "")
            out.append({"version": os.path.basename(v), "ts": ts, "size": os.path.getsize(v)})
        return out
    except Exception:
        return []


def vault_restore(rel, version):
    vdir_real = os.path.realpath(VAULT_VERSIONS_DIR)
    vpath = os.path.realpath(os.path.join(VAULT_VERSIONS_DIR, os.path.basename(version)))
    if not vpath.startswith(vdir_real + os.sep) or not os.path.exists(vpath):
        return {"ok": False, "error": "versi tidak ditemukan"}
    try:
        with open(vpath, encoding="utf-8", errors="replace") as f:
            content = f.read()
        return vault_save(rel, content)
    except Exception as e:
        return {"ok": False, "error": str(e)}


def fetch_fleet():
    """Ambil fleet.json dari agregator (3120) — gagal → None."""
    try:
        req = urllib.request.Request(FLEET_URL, headers={"User-Agent": "myoffice-office-backend"})
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.load(r)
    except Exception:
        return None


JOBS_URL = os.environ.get("MYOFFICE_JOBS_URL", "http://127.0.0.1:3122/jobs.json")


def fetch_jobs():
    """Ambil jobs.json dari jobs aggregator (3122) — gagal → None."""
    try:
        req = urllib.request.Request(JOBS_URL, headers={"User-Agent": "myoffice-office-backend"})
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.load(r)
    except Exception:
        return None


def _esc_html(s):
    """Escape HTML utk konten user di notifikasi Telegram (anti HTML injection)."""
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# ---------- multi-user & roles (fitur jualan #1) ----------

USERS_FILE = os.path.join(DATA_DIR, "users.json")
# Admin utama di-bootstrap dari env MYOFFICE_ADMIN_PASSWORD saat pertama start.
# TIDAK ada default password/token di source (aman untuk repo public).
USERS_DEFAULT = {"users": []}
USER_ROLES = ("admin", "manager", "viewer")


def _bootstrap_admin():
    """Buat user admin pertama dari env MYOFFICE_ADMIN_PASSWORD (sekali, idempoten)."""
    env_pw = os.environ.get("MYOFFICE_ADMIN_PASSWORD", "")
    if not env_pw:
        return
    data = load_json(USERS_FILE, USERS_DEFAULT)
    if any(u.get("username") == "admin" for u in data.get("users", [])):
        return
    import secrets
    data["users"].append({"username": "admin", "name": "Administrator",
                          "password_hash": _hash_pw(env_pw), "role": "admin",
                          "token": "ut_" + secrets.token_hex(12), "created_at": now_iso()})
    save_json(USERS_FILE, data)


def _hash_pw(pw):
    """Password hash: scrypt salted (stdlib) — tahan rainbow table.
    Format: scrypt$<salt_hex>$<hash_hex>. Legacy SHA-256 diterima utk migrasi (lihat _verify_pw)."""
    salt = os.urandom(16)
    h = hashlib.scrypt(str(pw).encode("utf-8"), salt=salt, n=2 ** 14, r=8, p=1)
    return "scrypt$" + salt.hex() + "$" + h.hex()


def _verify_pw(pw, stored):
    """Verifikasi password — support scrypt (baru) + legacy sha256 (migrasi)."""
    if not stored:
        return False
    if stored.startswith("scrypt$"):
        try:
            _, salt_hex, hash_hex = stored.split("$")
            h = hashlib.scrypt(str(pw).encode("utf-8"), salt=bytes.fromhex(salt_hex), n=2 ** 14, r=8, p=1)
            return h.hex() == hash_hex
        except Exception:
            return False
    return hashlib.sha256(str(pw).encode("utf-8")).hexdigest() == stored


def auth_login(payload):
    """Login user → token + role."""
    u = str(payload.get("username") or "").strip().lower()
    p = str(payload.get("password") or "")
    if not u or not p:
        return None, "username/password wajib diisi"
    users = load_json(USERS_FILE, USERS_DEFAULT).get("users", [])
    for usr in users:
        if usr.get("username") == u and _verify_pw(p, usr.get("password_hash")):
            return {"username": u, "name": usr.get("name", u), "role": usr.get("role", "viewer"),
                    "token": usr.get("token", "")}, None
    return None, "username atau password salah"


def auth_user_role(username):
    """Role dari username (tanpa token) — dipakai saat create/verify."""
    users = load_json(USERS_FILE, USERS_DEFAULT).get("users", [])
    for usr in users:
        if usr.get("username") == username:
            return usr.get("role", "viewer")
    return None


def auth_list_users(actor_role):
    if actor_role != "admin":
        return None, "hanya admin yang bisa melihat daftar user"
    users = load_json(USERS_FILE, USERS_DEFAULT).get("users", [])
    return [{"username": u.get("username"), "name": u.get("name"), "role": u.get("role"),
             "created_at": u.get("created_at")} for u in users], None


def auth_create_user(payload, actor_role):
    if actor_role != "admin":
        return None, "hanya admin yang bisa menambah user"
    u = str(payload.get("username") or "").strip().lower()
    p = str(payload.get("password") or "")
    name = str(payload.get("name") or u).strip()[:60]
    role = payload.get("role", "viewer")
    if not u or not p:
        return None, "username dan password wajib diisi"
    if len(p) < 6:
        return None, "password minimal 6 karakter"
    if role not in USER_ROLES:
        return None, "role tidak valid (admin/manager/viewer)"
    data = load_json(USERS_FILE, USERS_DEFAULT)
    for usr in data["users"]:
        if usr["username"] == u:
            return None, "username sudah ada"
    import secrets
    data["users"].append({"username": u, "name": name, "password_hash": _hash_pw(p),
                          "role": role, "token": "ut_" + secrets.token_hex(12),
                          "created_at": now_iso()})
    save_json(USERS_FILE, data)
    return {"username": u, "name": name, "role": role}, None


def auth_delete_user(payload, actor_role):
    if actor_role != "admin":
        return None, "hanya admin"
    u = str(payload.get("username") or "").strip().lower()
    if u == "admin":
        return None, "admin utama tidak bisa dihapus"
    data = load_json(USERS_FILE, USERS_DEFAULT)
    before = len(data["users"])
    data["users"] = [x for x in data["users"] if x["username"] != u]
    if len(data["users"]) == before:
        return None, "user tidak ditemukan"
    save_json(USERS_FILE, data)
    return {"deleted": u}, None


def auth_change_password(payload, username):
    old = str(payload.get("old_password") or "")
    new = str(payload.get("new_password") or "")
    if not old or len(new) < 6:
        return None, "password baru minimal 6 karakter"
    data = load_json(USERS_FILE, USERS_DEFAULT)
    for usr in data["users"]:
        if usr["username"] == username:
            if not _verify_pw(old, usr.get("password_hash")):
                return None, "password lama salah"
            usr["password_hash"] = _hash_pw(new)
            save_json(USERS_FILE, data)
            return {"ok": True}, None
    return None, "user tidak ditemukan"


def _auth_role_from_headers(headers, sock_addr=None):
    """Role dari user token.
    TANPA user-token: HANYA localhost (internal scripts/cron) yang dianggap admin —
    remote tanpa token DITOLAK (None), bukan admin. Celah akses admin ditutup."""
    utok = headers.get("X-Office-User-Token", "") or headers.get("x-office-user-token", "")
    if not utok:
        ip = (sock_addr[0] if sock_addr else "") or ""
        if ip in ("127.0.0.1", "::1", "localhost"):
            return "admin"
        return None
    users = load_json(USERS_FILE, USERS_DEFAULT).get("users", [])
    for usr in users:
        if usr.get("token") == utok:
            return usr.get("role", "viewer")
    return None


def _role_ok(role, allowed):
    return role in allowed


def push_telegram(text):
    """Kirim notifikasi Telegram ke Papi (via telegram_notify.py). Gagal tidak merusak request."""
    try:
        import subprocess
        subprocess.run(
            ["/usr/bin/python3", "/opt/myoffice/telegram_notify.py", text],
            capture_output=True, text=True, timeout=30,
        )
    except Exception:
        pass


# ---------- approvals ----------

APPROVAL_FILE = os.path.join(DATA_DIR, "approvals.json")
APPROVAL_DEFAULT = {"items": []}

RISK_ORDER = {"low": 1, "medium": 2, "high": 3, "critical": 4}


def list_approvals(status=None):
    data = load_json(APPROVAL_FILE, APPROVAL_DEFAULT)
    items = data.get("items", [])
    if status:
        items = [i for i in items if i.get("status") == status]
    # hitung SLA per item pending
    now = datetime.now(timezone.utc)
    for item in items:
        if item.get("status") == "pending":
            try:
                req = datetime.fromisoformat(item.get("requested_at", "").replace("Z", "+00:00"))
                deadline = req + timedelta(minutes=item.get("sla_minutes", 30))
                remaining = (deadline - now).total_seconds() / 60.0
                item["sla_deadline"] = deadline.isoformat(timespec="seconds").replace("+00:00", "Z")
                item["sla_remaining_min"] = round(remaining, 1)
                if remaining <= 0:
                    item["sla_status"] = "expired"
                elif remaining <= item.get("sla_minutes", 30) * 0.5:
                    item["sla_status"] = "expiring"
                else:
                    item["sla_status"] = "ok"
            except Exception:
                item["sla_status"] = "ok"
                item["sla_remaining_min"] = None
        else:
            item["sla_status"] = None
            item["sla_remaining_min"] = None
    # pending di atas, lalu by risk desc, lalu by requested_at desc
    items.sort(key=lambda i: (
        0 if i.get("status") == "pending" else 1,
        -RISK_ORDER.get(i.get("risk", "low"), 0),
        i.get("requested_at", ""),
    ), reverse=True)
    return {"items": items}


def submit_approval(payload, client_ip=None):
    data = load_json(APPROVAL_FILE, APPROVAL_DEFAULT)
    agent_id = payload.get("agent", "unknown")
    paused, pause_reason = is_agent_paused(agent_id)
    # terapkan policy (Fase 5): auto-approve / pending
    policy_status, policy_note = evaluate_approval(payload)
    status = "rejected" if paused else policy_status
    note = f"Auto-tolak: agent dalam status pause ({pause_reason})" if paused else policy_note
    # geofence aksi berisiko (Tahap 3): kalau melanggar → tidak auto-approve
    if status == "approved":
        gf_block = evaluate_geofence(payload, client_ip)
        if gf_block:
            status = "pending"
            note = (note + " | " if note else "") + gf_block
    item = {
        "id": "ap_" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S") + "_" + str(len(data["items"]) + 1),
        "agent": agent_id,
        "type": payload.get("type", "other"),
        "title": payload.get("title", ""),
        "detail": payload.get("detail", ""),
        "risk": payload.get("risk", "medium"),
        "requested_at": now_iso(),
        "sla_minutes": int(payload.get("sla_minutes", 30)),
        "status": status,
        "decided_by": "system" if status != "pending" else None,
        "decided_at": now_iso() if status != "pending" else None,
        "note": note,
        "source": payload.get("source", "manual"),
        "task_id": payload.get("task_id"),
    }
    data["items"].append(item)
    save_json(APPROVAL_FILE, data)
    return item


def decide_approval(approval_id, decision, note=None, decided_by="samian"):
    data = load_json(APPROVAL_FILE, APPROVAL_DEFAULT)
    for item in data.get("items", []):
        if item["id"] == approval_id:
            if item.get("status") != "pending":
                return None, "already decided"
            item["status"] = decision
            item["decided_by"] = decided_by
            item["decided_at"] = now_iso()
            item["note"] = note
            save_json(APPROVAL_FILE, data)
            # Kanban B: hook board task kalau approval berasal dari board
            task_id = item.get("task_id")
            if task_id and item.get("source") == "board":
                bd = load_json(BOARD_FILE, BOARD_DEFAULT)
                for bi in bd.get("items", []):
                    if bi["id"] == task_id:
                        if decision == "approved":
                            bi["status"] = "in_progress"
                            bi["blocked_reason"] = None
                        else:
                            bi["status"] = "todo"
                            bi["blocked_reason"] = ("Approval ditolak: " + (note or "")).strip()[:300]
                        bi["updated_at"] = now_iso()
                        bi.setdefault("history", []).append({
                            "at": now_iso(), "by": "system", "from": "waiting_approval",
                            "to": bi["status"], "note": f"Approval {decision} oleh {decided_by}",
                        })
                        save_json(BOARD_FILE, bd)
                        push_telegram(
                            f"{'✅' if decision == 'approved' else '❌'} *Task {decision.upper()}* — {bi.get('agent') or 'pool'}\n"
                            f"• {bi['title']}\n"
                            f"• Approval oleh: {decided_by}",
                        )
                        break
            return item, None
    return None, "not found"


# ---------- org chart ----------

ORG_FILE = os.path.join(DATA_DIR, "org.json")
ORG_DEFAULT = {
    "updated_at": None,
    "company": "SAM Group",
    "human": [
        {"id": "samian", "name": "Boss Samian", "role": "CEO & Founder", "level": 0}
    ],
    "departments": [
        {"id": "ops", "name": "Koordinasi & Operasional", "lead": "rena", "members": ["rena"]},
        {"id": "bisnis", "name": "Ops & Bisnis", "lead": "farrah", "members": ["farrah"]},
        {"id": "proyek", "name": "Proyek FindBuyer", "lead": "nadine", "members": ["nadine"]},
        {"id": "dev", "name": "Development & Automation", "lead": "dinda", "members": ["dinda"]},
        {"id": "sec", "name": "Audit & Security", "lead": "aaron", "members": ["aaron"]},
    ],
    "agents": [
        {"id": "rena", "name": "Rena", "role": "Koordinasi & Operasional", "dept": "ops"},
        {"id": "farrah", "name": "Farrah", "role": "Ops & Bisnis", "dept": "bisnis"},
        {"id": "nadine", "name": "Nadine", "role": "Proyek FindBuyer", "dept": "proyek"},
        {"id": "dinda", "name": "Dinda", "role": "Development & Automation (SAMCODER)", "dept": "dev"},
        {"id": "aaron", "name": "Aaron", "role": "Audit & Security", "dept": "sec"},
    ],
}


def get_org():
    org = load_json(ORG_FILE, ORG_DEFAULT)
    fleet = fetch_fleet()
    if fleet:
        by_id = {a["id"]: a for a in fleet.get("agents", [])}
        for agent in org.get("agents", []):
            f = by_id.get(agent["id"])
            agent["status"] = f.get("status", "offline") if f else "offline"
            agent["server"] = f.get("server", "-") if f else "-"
            agent["currentTask"] = f.get("currentTask") if f else None
    org["updated_at"] = now_iso()
    return org


def update_org(payload):
    org = load_json(ORG_FILE, ORG_DEFAULT)
    if "departments" in payload:
        org["departments"] = payload["departments"]
    if "agents" in payload:
        # merge: update role/dept, pertahankan id
        by_id = {a["id"]: a for a in org["agents"]}
        for a in payload["agents"]:
            if a["id"] in by_id:
                by_id[a["id"]].update({k: v for k, v in a.items() if k not in ("status", "server", "currentTask")})
            else:
                by_id[a["id"]] = a
        org["agents"] = list(by_id.values())
    save_versioned("org", org)
    return org


# ---------- KPI ----------

KPI_MANUAL_FILE = os.path.join(DATA_DIR, "kpi_manual.json")
KPI_MANUAL_DEFAULT = {
    "best_work": [
        {"agent": "farrah", "title": "Pemeriksaan AI Agent Blueprint", "desc": "Audit menyeluruh blueprint agent AI & perbaikan arsitektur", "date": "2026-08-17"},
        {"agent": "rena", "title": "Robot Trading Crypto Startup", "desc": "Pembangunan prototipe robot trading CCV2", "date": "2026-08-18"},
        {"agent": "dinda", "title": "Analisa Harga Emas", "desc": "Analisa pergerakan harga emas 7 hari", "date": "2026-08-18"},
    ],
    "scores": {},  # agent -> {quality: 0-5, autonomy: 0-1, tasks_completed: int}
}

KPI_META = {
    "rena": {"role": "Koordinasi & Operasional", "dept": "Koordinasi & Operasional"},
    "farrah": {"role": "Ops & Bisnis", "dept": "Ops & Bisnis"},
    "nadine": {"role": "Proyek FindBuyer", "dept": "Proyek FindBuyer"},
    "dinda": {"role": "Development & Automation", "dept": "Development & Automation"},
    "aaron": {"role": "Audit & Security", "dept": "Audit & Security"},
}


def get_kpi():
    fleet = fetch_fleet() or {"agents": []}
    manual = load_json(KPI_MANUAL_FILE, KPI_MANUAL_DEFAULT)
    # Kanban C: tasks_completed & SLA dari board (data nyata)
    board_stats = get_board_stats()
    per_agent_board = board_stats.get("per_agent", {})
    rows = []
    for agent in fleet.get("agents", []):
        aid = agent["id"]
        meta = KPI_META.get(aid, {})
        sessions = agent.get("sessions", 0)
        messages = agent.get("messages", 0)
        tools = agent.get("tools", 0)
        tokens = agent.get("tokens", 0)
        cost = agent.get("cost", 0)
        score = manual.get("scores", {}).get(aid, {})
        bd = per_agent_board.get(aid, {})
        tasks_completed = int(bd.get("done", score.get("tasks_completed", 0)))
        board_sla_hit_rate = board_stats.get("totals", {}).get("sla_hit_rate")
        # KPI turunan
        msgs_per_session = round(messages / sessions, 1) if sessions else 0
        cost_per_task = round(cost / max(tasks_completed, 1), 2)
        quality = score.get("quality", 0)
        autonomy = score.get("autonomy", 0)
        kpi_score = round(
            (quality * 40) + (autonomy * 30) + min(msgs_per_session / 200, 1) * 15 + min(tools / 50, 1) * 15,
            1,
        ) if sessions else 0
        rows.append({
            "id": aid,
            "name": agent.get("name", aid),
            "role": meta.get("role", "-"),
            "status": agent.get("status", "offline"),
            "sessions": sessions,
            "messages": messages,
            "tools": tools,
            "tokens": tokens,
            "cost": round(cost, 2),
            "msgs_per_session": msgs_per_session,
            "tasks_completed": tasks_completed,
            "board_open": bd.get("open", 0),
            "board_avg_cycle_min": bd.get("avg_cycle_min"),
            "board_sla_hit_rate": board_sla_hit_rate,
            "quality": quality,
            "autonomy": autonomy,
            "cost_per_task": cost_per_task,
            "kpi_score": kpi_score,
            "currentTask": agent.get("currentTask"),
        })
    rows.sort(key=lambda r: -r["kpi_score"])
    return {
        "period": "minggu berjalan",
        "generated_at": now_iso(),
        "rows": rows,
        "best_work": manual.get("best_work", []),
        "totals": {
            "agents": len(rows),
            "sessions": sum(r["sessions"] for r in rows),
            "messages": sum(r["messages"] for r in rows),
            "tokens": sum(r["tokens"] for r in rows),
            "cost": round(sum(r["cost"] for r in rows), 2),
        },
    }


# ---------- payroll ----------

PAYROLL_FILE = os.path.join(DATA_DIR, "payroll.json")
PAYROLL_DEFAULT = {
    "period": "2026-08",
    "currency": "USD",
    "warning_threshold_pct": 80,
    "agents": [
        {"id": "rena", "name": "Rena", "salary_usd": 90},
        {"id": "farrah", "name": "Farrah", "salary_usd": 110},
        {"id": "nadine", "name": "Nadine", "salary_usd": 70},
        {"id": "dinda", "name": "Dinda", "salary_usd": 100},
        {"id": "aaron", "name": "Aaron", "salary_usd": 80},
    ],
}


def get_payroll():
    data = load_json(PAYROLL_FILE, PAYROLL_DEFAULT)
    fleet = fetch_fleet() or {"agents": []}
    by_id = {a["id"]: a for a in fleet.get("agents", [])}
    threshold = data.get("warning_threshold_pct", 80)
    rows = []
    total_budget = 0
    total_spent = 0
    for row in data.get("agents", []):
        f = by_id.get(row["id"], {})
        spent = round(f.get("cost", 0), 2)
        budget = float(row.get("salary_usd", 0))
        pct = round(spent / budget * 100, 1) if budget else 0
        if pct == 0:
            status = "belum-ada-aktivitas"
        elif pct >= 100:
            status = "over"
        elif pct >= threshold:
            status = "warning"
        else:
            status = "ok"
        total_budget += budget
        total_spent += spent
        rows.append({
            "id": row["id"],
            "name": row.get("name", row["id"]),
            "salary_usd": budget,
            "spent_usd": spent,
            "pct": pct,
            "status": status,
            "threshold_pct": threshold,
            "currentTask": f.get("currentTask") if f else None,
            "status_live": f.get("status", "offline") if f else "offline",
        })
    return {
        "period": data.get("period"),
        "currency": data.get("currency"),
        "warning_threshold_pct": threshold,
        "generated_at": now_iso(),
        "rows": rows,
        "totals": {
            "budget_usd": round(total_budget, 2),
            "spent_usd": round(total_spent, 2),
            "pct": round(total_spent / total_budget * 100, 1) if total_budget else 0,
        },
    }


# ---------- handoffs ----------

HANDOFF_FILE = os.path.join(DATA_DIR, "handoffs.json")
HANDOFF_DEFAULT = {"items": []}


def list_handoffs(status=None):
    data = load_json(HANDOFF_FILE, HANDOFF_DEFAULT)
    items = data.get("items", [])
    if status:
        items = [i for i in items if i.get("status") == status]
    items.sort(key=lambda i: i.get("created_at", ""), reverse=True)
    return {"items": items}


def submit_handoff(payload):
    data = load_json(HANDOFF_FILE, HANDOFF_DEFAULT)
    item = {
        "id": "ho_" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S") + "_" + str(len(data["items"]) + 1),
        "from_agent": payload.get("from_agent", ""),
        "to_agent": payload.get("to_agent", ""),
        "task": payload.get("task", ""),
        "note": payload.get("note", ""),
        "status": "open",
        "created_at": now_iso(),
        "completed_at": None,
    }
    data["items"].append(item)
    save_json(HANDOFF_FILE, data)
    return item


def complete_handoff(handoff_id):
    data = load_json(HANDOFF_FILE, HANDOFF_DEFAULT)
    for item in data.get("items", []):
        if item["id"] == handoff_id:
            if item.get("status") != "open":
                return None, "already completed"
            item["status"] = "done"
            item["completed_at"] = now_iso()
            save_json(HANDOFF_FILE, data)
            return item, None
    return None, "not found"


# ---------- health monitor ----------

HEALTH_RULES = {
    "online": 40,
    "activity": 25,
    "volume": 20,
    "busy": 15,
}


def get_health():
    fleet = fetch_fleet() or {"agents": []}
    jobs_data = fetch_jobs() or {"agents": []}
    # error nyata dari gateway: job dengan last_error (cron jobs agent)
    job_errors = {}
    for ja in jobs_data.get("agents", []):
        errs = [j.get("name") for j in ja.get("jobs", []) if j.get("last_error")]
        job_errors[ja.get("id")] = errs
    rows = []
    for agent in fleet.get("agents", []):
        aid = agent["id"]
        status = agent.get("status", "offline")
        sessions = agent.get("sessions", 0)
        messages = agent.get("messages", 0)
        tools = agent.get("tools", 0)
        cost = agent.get("cost", 0)
        current_task = agent.get("currentTask")

        score = 0
        reasons = []
        paused, pause_reason = is_agent_paused(aid)
        if paused:
            score += 5
            reasons.append("PAUSED: " + (pause_reason or ""))
        if status == "online":
            score += HEALTH_RULES["online"]
            reasons.append("online")
        else:
            reasons.append("offline")
        if sessions > 0 and messages > 0:
            score += HEALTH_RULES["activity"]
            reasons.append("aktif")
        if messages >= 100:
            score += HEALTH_RULES["volume"]
            reasons.append("volume normal")
        elif messages > 0:
            score += 10
            reasons.append("volume rendah")
        if current_task:
            score += HEALTH_RULES["busy"]
            reasons.append("sedang ada tugas")

        # sinyal tambahan: context pressure (tokens per pesan) & idle proxy
        pressure = round(agent.get("tokens", 0) / messages, 0) if messages else 0
        if pressure > 4000:
            score -= 10
            reasons.append("context pressure tinggi")
        if current_task and paused:
            score -= 15
            reasons.append("tugas ditahan (pause)")
        # error nyata dari gateway (jobs aggregator)
        errs = job_errors.get(aid, [])
        if errs:
            score -= min(20, 5 * len(errs))
            reasons.append(f"{len(errs)} job error: {', '.join(str(e)[:24] for e in errs[:3])}")

        if score >= 80:
            level = "healthy"
            rec = "Semua normal, pertahankan."
        elif score >= 50:
            level = "watch"
            rec = "Aktivitas menurun, cek riwayat sesi terakhir."
        else:
            level = "critical"
            rec = "Agent tidak sehat — cek status server & gateway."

        rows.append({
            "id": aid,
            "name": agent.get("name", aid),
            "status": status,
            "server": agent.get("server", "-"),
            "score": score,
            "level": level,
            "reasons": reasons,
            "recommendation": rec,
            "sessions": sessions,
            "messages": messages,
            "cost": round(cost, 2),
            "currentTask": current_task,
        })
    rows.sort(key=lambda r: r["score"])
    return {
        "generated_at": now_iso(),
        "rules": HEALTH_RULES,
        "rows": rows,
        "summary": {
            "healthy": sum(1 for r in rows if r["level"] == "healthy"),
            "watch": sum(1 for r in rows if r["level"] == "watch"),
            "critical": sum(1 for r in rows if r["level"] == "critical"),
        },
    }


# ---------- daily standup ----------

def get_standup():
    fleet = fetch_fleet() or {"agents": []}
    kpi = get_kpi()
    kpi_by_id = {r["id"]: r for r in kpi.get("rows", [])}
    best = {b["agent"]: b for b in kpi.get("best_work", [])}
    entries = []
    for agent in fleet.get("agents", []):
        k = kpi_by_id.get(agent["id"], {})
        b = best.get(agent["id"])
        entries.append({
            "id": agent["id"],
            "name": agent.get("name", agent["id"]),
            "role": k.get("role", "-"),
            "status": agent.get("status", "offline"),
            "server": agent.get("server", "-"),
            "currentTask": agent.get("currentTask"),
            "sessions": agent.get("sessions", 0),
            "messages": agent.get("messages", 0),
            "tools": agent.get("tools", 0),
            "cost": round(agent.get("cost", 0), 2),
            "kpi_score": k.get("kpi_score", 0),
            "best_work": b,
        })
    return {
        "generated_at": now_iso(),
        "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "entries": entries,
        "totals": {
            "agents": len(entries),
            "online": sum(1 for e in entries if e["status"] == "online"),
            "messages": sum(e["messages"] for e in entries),
            "cost": round(sum(e["cost"] for e in entries), 2),
        },
    }


# ---------- employees (kartu karyawan) ----------

def get_employees():
    org = get_org()
    kpi = get_kpi()
    payroll = get_payroll()
    health = get_health()
    handoffs = list_handoffs()
    kpi_by_id = {r["id"]: r for r in kpi.get("rows", [])}
    pay_by_id = {r["id"]: r for r in payroll.get("rows", [])}
    health_by_id = {r["id"]: r for r in health.get("rows", [])}
    best_by_id = {b["agent"]: b for b in kpi.get("best_work", [])}

    rows = []
    for agent in org.get("agents", []):
        aid = agent["id"]
        dept = org.get("departments", [])
        dept_name = next((d["name"] for d in dept if d["id"] == agent.get("dept")), "-")
        k = kpi_by_id.get(aid, {})
        p = pay_by_id.get(aid, {})
        h = health_by_id.get(aid, {})
        rows.append({
            "id": aid,
            "name": agent.get("name", aid),
            "role": agent.get("role", "-"),
            "dept": dept_name,
            "status": agent.get("status", "offline"),
            "server": agent.get("server", "-"),
            "avatar": agent.get("avatar"),
            "currentTask": agent.get("currentTask"),
            "paused": is_agent_paused(aid)[0],
            "kpi_score": k.get("kpi_score", 0),
            "messages": k.get("messages", 0),
            "sessions": k.get("sessions", 0),
            "cost": k.get("cost", 0),
            "salary_usd": p.get("salary_usd", 0),
            "spent_usd": p.get("spent_usd", 0),
            "payroll_pct": p.get("pct", 0),
            "payroll_status": p.get("status", "ok"),
            "health_score": h.get("score", 0),
            "health_level": h.get("level", "critical"),
            "health_rec": h.get("recommendation", "-"),
            "best_work": best_by_id.get(aid),
            "last_handoff": next((ho for ho in handoffs.get("items", []) if ho["to_agent"] == aid or ho["from_agent"] == aid), None),
        })
    rows.sort(key=lambda r: -r["kpi_score"])
    return {
        "generated_at": now_iso(),
        "company": org.get("company", "SAM Group"),
        "rows": rows,
        "totals": {
            "agents": len(rows),
            "online": sum(1 for r in rows if r["status"] == "online"),
            "budget_usd": payroll.get("totals", {}).get("budget_usd", 0),
            "spent_usd": payroll.get("totals", {}).get("spent_usd", 0),
        },
    }


# ---------- controls (kill-switch / pause) ----------

CONTROL_FILE = os.path.join(DATA_DIR, "controls.json")
CONTROL_DEFAULT = {
    "global_paused": False,
    "global_reason": None,
    "agents": {},  # agent_id -> {paused, reason, by, at, action}
}


def get_controls():
    return load_json(CONTROL_FILE, CONTROL_DEFAULT)


def set_agent_pause(agent_id, paused, reason, by="samian"):
    data = load_json(CONTROL_FILE, CONTROL_DEFAULT)
    agents = data.setdefault("agents", {})
    if paused:
        agents[agent_id] = {
            "paused": True,
            "reason": reason or "Tidak ada alasan",
            "by": by,
            "at": now_iso(),
            "action": "pause_request",
        }
    else:
        agents.pop(agent_id, None)
    save_json(CONTROL_FILE, data)
    return data


def set_global_pause(paused, reason, by="samian"):
    data = load_json(CONTROL_FILE, CONTROL_DEFAULT)
    data["global_paused"] = bool(paused)
    data["global_reason"] = reason if paused else None
    save_json(CONTROL_FILE, data)
    return data


def is_agent_paused(agent_id):
    data = load_json(CONTROL_FILE, CONTROL_DEFAULT)
    if data.get("global_paused"):
        return True, "global"
    entry = data.get("agents", {}).get(agent_id)
    return (True, entry["reason"]) if entry and entry.get("paused") else (False, None)


# ---------- reviews (1:1) ----------

REVIEW_FILE = os.path.join(DATA_DIR, "reviews.json")
REVIEW_DEFAULT = {"items": []}


def list_reviews(agent=None):
    data = load_json(REVIEW_FILE, REVIEW_DEFAULT)
    items = data.get("items", [])
    if agent:
        items = [i for i in items if i.get("agent") == agent]
    items.sort(key=lambda i: i.get("created_at", ""), reverse=True)
    return {"items": items}


def submit_review(payload):
    data = load_json(REVIEW_FILE, REVIEW_DEFAULT)
    # ringkasan otomatis dari fleet/kpi
    fleet = fetch_fleet() or {"agents": []}
    agent_info = next((a for a in fleet.get("agents", []) if a["id"] == payload.get("agent")), {})
    item = {
        "id": "rv_" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S") + "_" + str(len(data["items"]) + 1),
        "agent": payload.get("agent", ""),
        "summary_auto": {
            "currentTask": agent_info.get("currentTask"),
            "sessions": agent_info.get("sessions", 0),
            "messages": agent_info.get("messages", 0),
            "cost": round(agent_info.get("cost", 0), 2),
        },
        "kendala": payload.get("kendala", ""),
        "saran": payload.get("saran", ""),
        "follow_up": payload.get("follow_up", ""),
        "rating": int(payload.get("rating", 0) or 0),
        "created_at": now_iso(),
    }
    data["items"].append(item)
    save_json(REVIEW_FILE, data)
    # push notifikasi Telegram (review baru → Papi langsung tahu)
    try:
        rating = int(item.get("rating", 0) or 0)
        push_telegram(
            f"📋 <b>Review 1:1 — {item.get('agent')}</b>\n"
            f"⭐ Rating: {'★' * rating}{'☆' * (5 - rating)}\n"
            f"Kendala: {(item.get('kendala') or '-')[:200]}\n"
            f"Saran: {(item.get('saran') or '-')[:200]}\n"
            f"Follow-up: {(item.get('follow_up') or '-')[:200]}"
        )
    except Exception:
        pass
    return item


# ---------- onboarding (draft -> hire) ----------

ONBOARD_FILE = os.path.join(DATA_DIR, "onboarding.json")
ONBOARD_DEFAULT = {
    "draft_agents": [],  # {id, name, role, dept, notes, created_at}
    "hired": [],         # {id, name, role, dept, hired_at}
}


def get_onboarding():
    return load_json(ONBOARD_FILE, ONBOARD_DEFAULT)


def add_draft_agent(payload):
    data = load_json(ONBOARD_FILE, ONBOARD_DEFAULT)
    aid = payload.get("id") or ("draft_" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"))
    draft = {
        "id": aid,
        "name": payload.get("name", aid),
        "role": payload.get("role", "Agent"),
        "dept": payload.get("dept", "Umum"),
        "notes": payload.get("notes", ""),
        "created_at": now_iso(),
    }
    # replace jika id sama
    data["draft_agents"] = [d for d in data.get("draft_agents", []) if d["id"] != aid]
    data["draft_agents"].append(draft)
    save_json(ONBOARD_FILE, data)
    return draft


def hire_agent(draft_id, by="samian"):
    data = load_json(ONBOARD_FILE, ONBOARD_DEFAULT)
    drafts = data.get("draft_agents", [])
    idx = next((i for i, d in enumerate(drafts) if d["id"] == draft_id), None)
    if idx is None:
        return None, "not found"
    draft = drafts.pop(idx)
    draft["hired_at"] = now_iso()
    draft["hired_by"] = by
    data.setdefault("hired", []).append(draft)
    save_json(ONBOARD_FILE, data)
    # kalau agent id sudah ada di org, otomatis aktif
    return draft, None


def remove_draft(draft_id):
    data = load_json(ONBOARD_FILE, ONBOARD_DEFAULT)
    before = len(data.get("draft_agents", []))
    data["draft_agents"] = [d for d in data.get("draft_agents", []) if d["id"] != draft_id]
    if len(data["draft_agents"]) == before:
        return None, "not found"
    save_json(ONBOARD_FILE, data)
    return {}, None


# ---------- vacation / cuti ----------

VACATION_FILE = os.path.join(DATA_DIR, "vacation.json")
VACATION_DEFAULT = {"items": []}


def list_vacation(status=None):
    data = load_json(VACATION_FILE, VACATION_DEFAULT)
    items = data.get("items", [])
    if status:
        items = [i for i in items if i.get("status") == status]
    items.sort(key=lambda i: i.get("created_at", ""), reverse=True)
    return {"items": items}


def submit_vacation(payload):
    reason = payload.get("reason", "").strip()
    if not reason:
        return None, "alasan wajib diisi"
    data = load_json(VACATION_FILE, VACATION_DEFAULT)
    item = {
        "id": "vc_" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S") + "_" + str(len(data["items"]) + 1),
        "agent": payload.get("agent", ""),
        "type": payload.get("type", "cuti"),
        "reason": reason,
        "start": payload.get("start", ""),
        "end": payload.get("end", ""),
        "status": "active",
        "created_at": now_iso(),
    }
    data["items"].append(item)
    save_json(VACATION_FILE, data)
    return item, None


def end_vacation(vacation_id):
    data = load_json(VACATION_FILE, VACATION_DEFAULT)
    for item in data.get("items", []):
        if item["id"] == vacation_id:
            if item.get("status") != "active":
                return None, "already ended"
            item["status"] = "ended"
            item["ended_at"] = now_iso()
            save_json(VACATION_FILE, data)
            return item, None
    return None, "not found"


# ---------- shift & jam kerja (#4) ----------

SHIFT_FILE = os.path.join(DATA_DIR, "shift.json")
SHIFT_DEFAULT = {
    "work_start": "08:00",
    "work_end": "17:00",
    "tz_offset_hours": 7,  # WIB (preferensi Papi)
    "overtime_alert_hours": 2,
}
ACTIVITY_LOG = os.path.join(DATA_DIR, "activity_log.jsonl")


def get_shift_config():
    return load_json(SHIFT_FILE, SHIFT_DEFAULT)


def get_shift():
    cfg = get_shift_config()
    tz_off = float(cfg.get("tz_offset_hours", 7))
    work_start_h = int(cfg.get("work_start", "08:00").split(":")[0])
    work_end_h = int(cfg.get("work_end", "17:00").split(":")[0])

    now = datetime.now(timezone.utc)
    now_local_h = int((now.hour + tz_off) % 24)

    # baca activity log (last 48 jam) — abaikan backfill (sessions historis) utk deteksi lembur live
    events = []
    if os.path.exists(ACTIVITY_LOG):
        cutoff = now.timestamp() - 48 * 3600
        with open(ACTIVITY_LOG, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                    if rec.get("source") == "backfill":
                        continue
                    if rec.get("ts", 0) >= cutoff:
                        events.append(rec)
                except Exception:
                    continue

    # fleet untuk status live
    fleet = fetch_fleet() or {"agents": []}
    by_id = {a["id"]: a for a in fleet.get("agents", [])}
    today = now.strftime("%Y-%m-%d")

    rows = []
    for aid, agent in by_id.items():
        evs = [e for e in events if e.get("agent") == aid]
        # konversi ts -> jam lokal
        hourly = [0] * 24
        events_today = 0
        events_in_work = 0
        events_overtime = 0
        last_ts = None
        for e in evs:
            lt = datetime.fromtimestamp(e["ts"], tz=timezone.utc)
            local_h = int((lt.hour + tz_off) % 24)
            local_day = (lt + timedelta(hours=tz_off)).strftime("%Y-%m-%d")
            hourly[local_h] += 1
            if local_day == today:
                events_today += 1
                if work_start_h <= local_h < work_end_h:
                    events_in_work += 1
                else:
                    events_overtime += 1
            if last_ts is None or e["ts"] > last_ts:
                last_ts = e["ts"]

        hours_active_today = sum(1 for h in range(24) if hourly[h] > 0 and h < 24)
        # status — lembur = aktivitas malam DOMINAN (lebih banyak dr jam kerja) + signifikan
        live_status = agent.get("status", "offline")
        overtime_hours = round(events_overtime / 6, 1)  # ~6 event/jam saat aktif
        if events_today > 0:
            if events_overtime > events_in_work and overtime_hours >= cfg.get("overtime_alert_hours", 2):
                status = "lembur"
            elif events_in_work > 0:
                status = "aktif"
            elif events_overtime > 0:
                status = "aktif"  # aktivitas malam wajar (agent 24/7), bukan lembur
            else:
                status = "idle"
        else:
            status = "idle"
        absent = events_today == 0 and now_local_h >= work_start_h and live_status == "online"

        rows.append({
            "id": aid,
            "name": agent.get("name", aid),
            "status": status,
            "live": live_status,
            "absent": absent,
            "hours_active": hours_active_today,
            "overtime_hours": overtime_hours,
            "overtime_alert": overtime_hours >= cfg.get("overtime_alert_hours", 2),
            "last_activity": datetime.fromtimestamp(last_ts, tz=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z") if last_ts else None,
            "hourly": hourly,
            "currentTask": agent.get("currentTask"),
        })

    rows.sort(key=lambda r: -sum(r["hourly"]))
    return {
        "generated_at": now_iso(),
        "config": cfg,
        "today": today,
        "now_local_h": now_local_h,
        "rows": rows,
        "summary": {
            "aktif": sum(1 for r in rows if r["status"] == "aktif"),
            "lembur": sum(1 for r in rows if r["status"] == "lembur"),
            "idle": sum(1 for r in rows if r["status"] == "idle"),
            "absent": sum(1 for r in rows if r["absent"]),
        },
    }


# ---------- timesheet token per agent (Tahap 6) ----------

TIMESHEET_DAYS = 7


def get_timesheet():
    """Timesheet 7 hari per agent: jam aktif, events, tokens, cost (dari fleet + activity log)."""
    fleet = fetch_fleet() or {"agents": []}
    by_id = {a["id"]: a for a in fleet.get("agents", [])}
    cfg = get_shift_config()
    tz_off = float(cfg.get("tz_offset_hours", 7))
    work_start_h = int(cfg.get("work_start", "08:00").split(":")[0])
    work_end_h = int(cfg.get("work_end", "17:00").split(":")[0])

    now = datetime.now(timezone.utc)
    events = []
    if os.path.exists(ACTIVITY_LOG):
        cutoff = now.timestamp() - TIMESHEET_DAYS * 24 * 3600
        with open(ACTIVITY_LOG, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                    if rec.get("ts", 0) >= cutoff:
                        events.append(rec)
                except Exception:
                    continue

    rows = []
    for aid, agent in by_id.items():
        evs = [e for e in events if e.get("agent") == aid]
        per_day = {}
        for e in evs:
            lt = datetime.fromtimestamp(e["ts"], tz=timezone.utc) + timedelta(hours=tz_off)
            day = lt.strftime("%Y-%m-%d")
            d = per_day.setdefault(day, {"events": 0, "hours": set(), "overtime": 0, "work": 0})
            d["events"] += 1
            d["hours"].add(lt.hour)
            if work_start_h <= lt.hour < work_end_h:
                d["work"] += 1
            else:
                d["overtime"] += 1
        days = []
        for i in range(TIMESHEET_DAYS - 1, -1, -1):
            day = (now + timedelta(hours=tz_off) - timedelta(days=i)).strftime("%Y-%m-%d")
            d = per_day.get(day, {"events": 0, "hours": set(), "overtime": 0, "work": 0})
            days.append({
                "date": day,
                "events": d["events"],
                "active_hours": len(d["hours"]),
                "in_work": d["work"],
                "overtime": d["overtime"],
            })
        rows.append({
            "id": aid,
            "name": agent.get("name", aid),
            "status": agent.get("status"),
            "messages": agent.get("messages", 0),
            "tokens": agent.get("tokens", 0),
            "cost": round(agent.get("cost", 0), 2),
            "days": days,
        })
    rows.sort(key=lambda r: r["id"])
    return {
        "generated_at": now_iso(),
        "tz_offset": tz_off,
        "days_back": TIMESHEET_DAYS,
        "rows": rows,
    }


# ---------- Fase 5: approval policy, caps, status machine, timeline, quality ----------

POLICY_FILE = os.path.join(DATA_DIR, "policy.json")
POLICY_DEFAULT = {
    "auto_approve_types": ["tool_execution", "read"],
    "auto_approve_risks": ["low"],
    "require_approval_risks": ["high", "critical"],
    "require_approval_types": ["deploy", "install", "secret_access", "spending", "external_contact"],
    "spend_threshold_usd": 50,
    "note": "Read-only & risiko low = auto-approve. Write/deploy/secret/spending & high+ = wajib approval. Spending > threshold = wajib.",
}

CAPS_FILE = os.path.join(DATA_DIR, "caps.json")
CAPS_DEFAULT = {
    "auto_pause": True,
    "global_budget_usd": 500,
    "agent_caps": {"rena": 90, "farrah": 110, "nadine": 70, "dinda": 100, "aaron": 80},
}


def get_policy():
    return load_json(POLICY_FILE, POLICY_DEFAULT)


def get_caps():
    return load_json(CAPS_FILE, CAPS_DEFAULT)


# ---------- geofence aksi berisiko (Tahap 3) ----------

GEOFENCE_FILE = os.path.join(DATA_DIR, "geofence.json")
GEOFENCE_DEFAULT = {
    "enabled": False,
    "allowed_ips": [],          # IP publik yang diizinkan (kosong = semua dari internal/proxy boleh)
    "allowed_hours": "00-23",   # jam WIB diizinkan, format "08-17"
    "note": "Aksi berisiko (deploy/install/secret/spending/high+) di luar IP/jam izin → tidak auto-approve, wajib manual.",
}


def get_geofence():
    return load_json(GEOFENCE_FILE, GEOFENCE_DEFAULT)


def save_geofence(payload):
    data = get_geofence()
    if "enabled" in payload:
        data["enabled"] = bool(payload["enabled"])
    if "allowed_ips" in payload:
        ips = [str(x).strip() for x in payload["allowed_ips"] if str(x).strip()]
        data["allowed_ips"] = ips
    if "allowed_hours" in payload:
        data["allowed_hours"] = str(payload["allowed_hours"]).strip()[:5]
    if "note" in payload:
        data["note"] = str(payload["note"]).strip()[:300]
    save_json(GEOFENCE_FILE, data)
    return data


# ---------- branding / whitelabel (W1) ----------

BRANDING_FILE = os.path.join(DATA_DIR, "branding.json")
BRANDING_DEFAULT = {
    "name": "MyOffice",
    "logo": "/myoffice-avatar.webp",
    "primary_color": "#6366F1",
    "description": "AI agent operating system",
    "footer": "Powered by SAM Group",
    "contact": "",
}


def get_branding():
    return load_json(BRANDING_FILE, BRANDING_DEFAULT)


def save_branding(payload):
    data = get_branding()
    for key in ("name", "logo", "primary_color", "description", "footer", "contact"):
        if key in payload and payload[key] is not None:
            data[key] = str(payload[key]).strip()[:120]
    save_versioned("branding", data)
    return data


# ---------- kanban board (fitur jualan — lebih baik dari AgentOS) ----------

BOARD_FILE = os.path.join(DATA_DIR, "board.json")
BOARD_DEFAULT = {
    "columns": ["backlog", "todo", "waiting_approval", "in_progress", "in_review", "done", "blocked"],
    "items": [],
}
BOARD_STATUS_LABEL = {
    "backlog": "Backlog",
    "todo": "To Do",
    "waiting_approval": "Waiting Approval",
    "in_progress": "In Progress",
    "in_review": "In Review",
    "done": "Done",
    "blocked": "Blocked",
}
BOARD_PRIORITY_ORDER = {"low": 1, "medium": 2, "high": 3, "critical": 4}
BOARD_RISKY_TYPES = ("deploy", "install", "secret_access", "spending", "external_contact")
# Auto-assign by tipe (Kanban C): task tanpa agent & tipe dikenali → agent default
BOARD_TYPE_AGENT = {
    "deploy": "dinda", "install": "dinda", "secret_access": "aaron",
    "spending": "farrah", "external_contact": "farrah",
    "content": "farrah", "riset": "nadine",
}
# Auto-assign config — bisa diedit dari UI (F1-9): data/board_config.json
BOARD_CONFIG_FILE = os.path.join(DATA_DIR, "board_config.json")


def _board_type_agent_map():
    """Mapping type/tag → agent, dari config file (fallback BOARD_TYPE_AGENT)."""
    try:
        cfg = load_json(BOARD_CONFIG_FILE, {})
        m = cfg.get("type_agent")
        if m:
            return m
    except Exception:
        pass
    return dict(BOARD_TYPE_AGENT)


def board_item_sla(item):
    """Hitung SLA deadline/status (pola approvals)."""
    if item.get("status") == "done":
        item["sla_status"] = None
        item["sla_remaining_min"] = None
        return item
    try:
        req = datetime.fromisoformat(item.get("created_at", "").replace("Z", "+00:00"))
        deadline = req + timedelta(minutes=int(item.get("sla_minutes", 1440)))
        remaining = (deadline - datetime.now(timezone.utc)).total_seconds() / 60.0
        item["sla_deadline"] = deadline.isoformat(timespec="seconds").replace("+00:00", "Z")
        item["sla_remaining_min"] = round(remaining, 1)
        if remaining <= 0:
            item["sla_status"] = "expired"
        elif remaining <= int(item.get("sla_minutes", 1440)) * 0.25:
            item["sla_status"] = "expiring"
        else:
            item["sla_status"] = "ok"
    except Exception:
        item["sla_status"] = "ok"
        item["sla_remaining_min"] = None
    return item


def list_board(status=None, agent=None, priority=None):
    data = load_json(BOARD_FILE, BOARD_DEFAULT)
    cols = data.get("columns", BOARD_DEFAULT["columns"])
    # migrasi otomatis: pastikan semua kolom default ada (mis. waiting_approval)
    migrated = False
    for c in BOARD_DEFAULT["columns"]:
        if c not in cols:
            cols.append(c)
            migrated = True
    if migrated:
        # urutkan sesuai BOARD_DEFAULT, kolom custom ekstra di belakang
        data["columns"] = [c for c in BOARD_DEFAULT["columns"] if c in cols] + [c for c in cols if c not in BOARD_DEFAULT["columns"]]
        save_json(BOARD_FILE, data)
    items = data.get("items", [])
    if status:
        items = [i for i in items if i.get("status") == status]
    if agent:
        items = [i for i in items if i.get("agent") == agent or not i.get("agent")]
    if priority:
        items = [i for i in items if i.get("priority") == priority]
    for item in items:
        board_item_sla(item)
    items.sort(key=lambda i: (
        BOARD_PRIORITY_ORDER.get(i.get("priority", "medium"), 2),
        i.get("created_at", ""),
    ), reverse=True)
    return {"columns": data.get("columns", BOARD_DEFAULT["columns"]), "items": items}


def create_board_item(payload):
    data = load_json(BOARD_FILE, BOARD_DEFAULT)
    agent_id = payload.get("agent") or None
    # Kanban C: auto-assign by type kalau agent kosong
    auto_note = None
    if not agent_id:
        t = str(payload.get("type", "task"))
        if t in _board_type_agent_map():
            agent_id = _board_type_agent_map()[t]
            auto_note = f"auto-assign by type ({t}) → {agent_id}"
        else:
            # auto-assign by tag agent (tags mengandung id agent)
            for tag in (payload.get("tags") or []):
                if str(tag).strip().lower() in ("rena", "farrah", "nadine", "aaron", "dinda"):
                    agent_id = str(tag).strip().lower()
                    auto_note = f"auto-assign by tag → {agent_id}"
                    break
    item = {
        "id": "bk_" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S") + "_" + str(len(data["items"]) + 1),
        "title": str(payload.get("title", "")).strip()[:200],
        "desc": str(payload.get("desc", "")).strip()[:2000],
        "agent": agent_id,          # None = pool (bisa diambil agent mana pun)
        "priority": payload.get("priority", "medium"),
        "risk": payload.get("risk", "medium"),           # low|medium|high|critical
        "type": payload.get("type", "task"),             # task|deploy|install|secret_access|spending|external_contact|...
        "status": "backlog",
        "sla_minutes": int(payload.get("sla_minutes", 1440)),
        "tags": [str(t).strip()[:30] for t in (payload.get("tags") or [])][:8],
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "blocked_reason": None,
        "summary": None,
        "approval_id": None,
        "history": [{"at": now_iso(), "by": "system", "from": None, "to": "backlog", "note": auto_note or "Task dibuat"}],
    }
    if not item["title"]:
        return None, "judul wajib diisi"
    data["items"].append(item)
    save_json(BOARD_FILE, data)
    push_telegram(
        f"📋 *Task Baru* [{item['priority'].upper()}] — {item.get('agent') or 'pool'}\n"
        f"• {item['title']}\n"
        f"• SLA: {item['sla_minutes']} menit · Buka MyOffice → /board",
    )
    return item, None


def get_board_item(item_id):
    data = load_json(BOARD_FILE, BOARD_DEFAULT)
    for item in data.get("items", []):
        if item["id"] == item_id:
            board_item_sla(item)
            return item, None
    return None, "not found"


def board_requires_approval(item):
    """Task berisiko (Kanban B): risk high/critical atau tipe berisiko → wajib approval."""
    if item.get("status") == "waiting_approval":
        return True
    risk = item.get("risk", "medium")
    atype = item.get("type", "task")
    return risk in ("high", "critical") or atype in BOARD_RISKY_TYPES


def move_board_item(item_id, to_status, note=None, by="samian", client_ip=None, delegator=None):
    data = load_json(BOARD_FILE, BOARD_DEFAULT)
    if to_status not in data.get("columns", BOARD_DEFAULT["columns"]):
        return None, f"status tidak dikenal: {to_status}"
    for item in data.get("items", []):
        if item["id"] == item_id:
            frm = item.get("status")
            # Kanban B: gate approval saat mau mulai dikerjakan
            if to_status == "in_progress" and board_requires_approval(item):
                # cek approval existing
                if item.get("approval_id"):
                    ap_data = load_json(APPROVAL_FILE, APPROVAL_DEFAULT)
                    ap = next((a for a in ap_data.get("items", []) if a["id"] == item["approval_id"]), None)
                    if ap and ap.get("status") == "approved":
                        pass  # sudah disetujui → lanjut in_progress
                    elif ap and ap.get("status") == "pending":
                        to_status = "waiting_approval"
                    elif ap and ap.get("status") == "rejected":
                        to_status = "blocked"
                        note = (note or "") + " | Approval task ditolak"
                    else:
                        to_status = "waiting_approval"
                else:
                    # buat approval baru via queue
                    ap = submit_approval({
                        "agent": item.get("agent") or "samian",
                        "type": item.get("type", "task"),
                        "title": f"[Board] {item['title']}",
                        "detail": item.get("desc", ""),
                        "risk": item.get("risk", "medium"),
                        "sla_minutes": 30,
                        "source": "board",
                        "task_id": item_id,
                    }, client_ip)
                    item["approval_id"] = ap.get("id")
                    to_status = "waiting_approval"
                    push_telegram(
                        f"🛂 *Task Butuh Approval* — {item.get('agent') or 'pool'}\n"
                        f"• {item['title']}\n"
                        f"• Risiko: {item.get('risk')} · Tipe: {item.get('type')}\n"
                        f"• Putuskan di MyOffice → /approvals",
                    )
            item["status"] = to_status
            item["updated_at"] = now_iso()
            # F2-3: delegation chain — kalau delegator di-set (agent mendelegasi ke agent lain)
            if delegator and delegator != item.get("agent"):
                prev_agent = item.get("agent")
                item["delegator"] = delegator
                try:
                    push_telegram(f"🤝 <b>Delegasi task:</b> {item['title']}\n• {prev_agent or 'pool'} → {item.get('agent')} (oleh {delegator})")
                except Exception:
                    pass
            if to_status == "blocked":
                item["blocked_reason"] = (note or "").strip()[:300]
            elif to_status in ("done", "backlog", "todo", "in_progress", "in_review", "waiting_approval"):
                item["blocked_reason"] = None
            if to_status == "done":
                item["summary"] = (note or "").strip()[:1000]
            item.setdefault("history", []).append({
                "at": now_iso(), "by": by, "from": frm, "to": to_status,
                "note": (note or "").strip()[:300],
            })
            save_json(BOARD_FILE, data)
            # notifikasi
            if to_status == "done":
                push_telegram(
                    f"✅ *Task Selesai* — {item.get('agent') or 'pool'}\n• {item['title']}\n"
                    + (f"• Ringkasan: {item['summary'][:150]}" if item.get("summary") else ""),
                )
            elif to_status == "in_progress":
                push_telegram(
                    f"▶️ *Task Dikerjakan* — {item.get('agent') or 'pool'}\n• {item['title']}",
                )
            elif to_status == "blocked":
                push_telegram(
                    f"⛔ *Task Blocked* — {item.get('agent') or 'pool'}\n• {item['title']}\n• Alasan: {item.get('blocked_reason')}",
                )
            return item, None
    return None, "not found"


def delete_board_item(item_id):
    data = load_json(BOARD_FILE, BOARD_DEFAULT)
    for i, item in enumerate(data.get("items", [])):
        if item["id"] == item_id:
            data["items"].pop(i)
            save_json(BOARD_FILE, data)
            return True, None
    return False, "not found"


def _parse_ts(iso_str):
    try:
        return datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    except Exception:
        return None


def get_board_stats():
    """Analytics board (Kanban C): throughput, cycle time, SLA hit rate, per agent."""
    data = load_json(BOARD_FILE, BOARD_DEFAULT)
    items = data.get("items", [])
    now = datetime.now(timezone.utc)
    done_items = [i for i in items if i.get("status") == "done"]
    done_7d = 0
    cycle_min_list = []
    sla_hit = 0
    for i in done_items:
        created = _parse_ts(i.get("created_at", ""))
        done_ts = _parse_ts(i.get("updated_at", ""))
        if not created or not done_ts:
            continue
        if (now - done_ts).total_seconds() <= 7 * 86400:
            done_7d += 1
        cycle_min = (done_ts - created).total_seconds() / 60.0
        cycle_min_list.append(cycle_min)
        if cycle_min <= int(i.get("sla_minutes", 1440)):
            sla_hit += 1
    avg_cycle_min = round(sum(cycle_min_list) / len(cycle_min_list), 1) if cycle_min_list else None
    sla_hit_rate = round(sla_hit / len(done_items) * 100, 1) if done_items else None
    # per agent
    per_agent = {}
    for i in items:
        aid = i.get("agent") or "pool"
        d = per_agent.setdefault(aid, {"open": 0, "done": 0, "cycle_min": []})
        if i.get("status") == "done":
            d["done"] += 1
            created = _parse_ts(i.get("created_at", ""))
            done_ts = _parse_ts(i.get("updated_at", ""))
            if created and done_ts:
                d["cycle_min"].append((done_ts - created).total_seconds() / 60.0)
        else:
            d["open"] += 1
    for aid, d in per_agent.items():
        d["avg_cycle_min"] = round(sum(d["cycle_min"]) / len(d["cycle_min"]), 1) if d["cycle_min"] else None
        d.pop("cycle_min", None)
    return {
        "generated_at": now_iso(),
        "totals": {
            "open": sum(1 for i in items if i.get("status") != "done"),
            "done": len(done_items),
            "done_7d": done_7d,
            "avg_cycle_min": avg_cycle_min,
            "sla_hit_rate": sla_hit_rate,
        },
        "per_agent": per_agent,
    }


# ---------- kanban D: automation rules & templates ----------

BOARD_RULES_FILE = os.path.join(DATA_DIR, "board_rules.json")
BOARD_RULES_DEFAULT = {"items": []}
BOARD_TEMPLATES_FILE = os.path.join(DATA_DIR, "board_templates.json")
BOARD_TEMPLATES_DEFAULT = {"items": []}


def list_board_rules():
    return load_json(BOARD_RULES_FILE, BOARD_RULES_DEFAULT).get("items", [])


def save_board_rule(payload):
    data = load_json(BOARD_RULES_FILE, BOARD_RULES_DEFAULT)
    rule_id = str(payload.get("id", "")).strip()
    if not rule_id:
        rule_id = "rule_" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    rule = {
        "id": rule_id,
        "name": str(payload.get("name", "")).strip()[:120],
        "schedule": payload.get("schedule") or {"type": "interval", "minutes": 1440},
        "task": payload.get("task") or {},
        "enabled": bool(payload.get("enabled", True)),
        "last_run": None,
    }
    if not rule["name"] or not rule["task"].get("title"):
        return None, "nama rule & judul task wajib diisi"
    found = False
    for i, r in enumerate(data["items"]):
        if r["id"] == rule_id:
            rule["last_run"] = r.get("last_run")
            data["items"][i] = rule
            found = True
            break
    if not found:
        data["items"].append(rule)
    save_json(BOARD_RULES_FILE, data)
    return rule, None


def delete_board_rule(rule_id):
    data = load_json(BOARD_RULES_FILE, BOARD_RULES_DEFAULT)
    before = len(data["items"])
    data["items"] = [r for r in data["items"] if r["id"] != rule_id]
    if len(data["items"]) == before:
        return False, "not found"
    save_json(BOARD_RULES_FILE, data)
    return True, None


def _rule_due(rule, now):
    """Cek apakah rule sudah waktunya jalan (interval menit / weekly time+days)."""
    sched = rule.get("schedule") or {}
    stype = sched.get("type", "interval")
    last = rule.get("last_run")
    if stype == "interval":
        minutes = int(sched.get("minutes", 1440))
        if last:
            try:
                last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
                return (now - last_dt).total_seconds() / 60.0 >= minutes
            except Exception:
                return True
        return True
    if stype == "weekly":
        time_str = str(sched.get("time", "08:00"))
        days = sched.get("days") or []
        try:
            hh, mm = time_str.split(":")
            now_local = now + timedelta(hours=7)  # WIB
            if now_local.weekday() not in days:
                return False
            if now_local.hour != int(hh) or now_local.minute != int(mm):
                return False
            # sudah jalan hari ini?
            if last and last[:10] == now_local.strftime("%Y-%m-%d"):
                return False
            return True
        except Exception:
            return False
    return False


def check_board_rules(now=None):
    """Scheduler: jalankan rules yang due → buat task otomatis. Return list task dibuat."""
    now = now or datetime.now(timezone.utc)
    data = load_json(BOARD_RULES_FILE, BOARD_RULES_DEFAULT)
    created = []
    for rule in data.get("items", []):
        if not rule.get("enabled"):
            continue
        if not _rule_due(rule, now):
            continue
        try:
            task_payload = dict(rule.get("task", {}))
            task_payload["by"] = "rule:" + rule.get("id", "")
            item, err = create_board_item(task_payload)
            if not err:
                rule["last_run"] = now.isoformat(timespec="seconds").replace("+00:00", "Z")
                created.append({"rule": rule.get("id"), "task": item.get("id")})
                push_telegram(
                    f"🔁 *Task Otomatis (rule: {rule.get('name')})*\n• {task_payload.get('title')}",
                )
        except Exception:
            pass
    if created:
        save_json(BOARD_RULES_FILE, data)
    return created


def run_board_rules_scheduler():
    """Loop tiap 60 detik cek rules (Kanban D)."""
    while True:
        try:
            check_board_rules()
        except Exception:
            pass
        time.sleep(60)


def list_board_templates():
    return load_json(BOARD_TEMPLATES_FILE, BOARD_TEMPLATES_DEFAULT).get("items", [])


def save_board_template(payload):
    data = load_json(BOARD_TEMPLATES_FILE, BOARD_TEMPLATES_DEFAULT)
    tpl_id = str(payload.get("id", "")).strip()
    if not tpl_id:
        tpl_id = "tpl_" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    tpl = {
        "id": tpl_id,
        "name": str(payload.get("name", "")).strip()[:120],
        "task": payload.get("task") or {},
    }
    if not tpl["name"] or not tpl["task"].get("title"):
        return None, "nama template & judul task wajib diisi"
    found = False
    for i, t in enumerate(data["items"]):
        if t["id"] == tpl_id:
            data["items"][i] = tpl
            found = True
            break
    if not found:
        data["items"].append(tpl)
    save_json(BOARD_TEMPLATES_FILE, data)
    return tpl, None


def delete_board_template(tpl_id):
    data = load_json(BOARD_TEMPLATES_FILE, BOARD_TEMPLATES_DEFAULT)
    before = len(data["items"])
    data["items"] = [t for t in data["items"] if t["id"] != tpl_id]
    if len(data["items"]) == before:
        return False, "not found"
    save_json(BOARD_TEMPLATES_FILE, data)
    return True, None


def apply_board_template(tpl_id):
    data = load_json(BOARD_TEMPLATES_FILE, BOARD_TEMPLATES_DEFAULT)
    for t in data["items"]:
        if t["id"] == tpl_id:
            task_payload = dict(t.get("task", {}))
            task_payload["by"] = "template:" + tpl_id
            item, err = create_board_item(task_payload)
            if err:
                return None, err
            return item, None
    return None, "not found"


TICKET_FILE = os.path.join(DATA_DIR, "tickets.json")
TICKET_ARCHIVE_FILE = os.path.join(DATA_DIR, "tickets_archive.json")
TICKET_INBOX_DIR = os.path.join(DATA_DIR, "agent_inbox")
TICKET_DEFAULT = {"items": []}
TICKET_STATUS = {"open", "in_progress", "done", "cancelled", "archived"}
TICKET_PRIORITY = {"high", "normal", "low"}
# Daftar agent valid untuk ticketing — dari config file (bisa diedit tanpa ubah source).
TICKET_CONFIG_FILE = os.path.join(DATA_DIR, "ticket_config.json")


def _ticket_agents():
    try:
        cfg = load_json(TICKET_CONFIG_FILE, {})
        agents = cfg.get("agents")
        if agents:
            return set(agents)
    except Exception:
        pass
    return {"samian", "rena", "farrah", "nadine", "aaron", "dinda"}
TICKET_EDIT_FIELDS = {"title", "description", "priority", "deadline"}
TICKET_PAGE = 50
_TICKET_RATE = {}  # rate limit per aksi: key -> [count, window_start]


def _ticket_id():
    """ID acak (tidak predictable) — fix kelemahan #11."""
    import secrets
    return "t_" + secrets.token_hex(6)


def _ticket_sla(deadline_iso):
    """deadline ISO → sla_status (ok/expiring/expired)."""
    if not deadline_iso:
        return None
    try:
        dl = datetime.fromisoformat(deadline_iso.replace("Z", "+00:00"))
    except Exception:
        return None
    now = datetime.now(timezone.utc)
    if dl <= now:
        return "expired"
    if dl - now <= timedelta(hours=6):
        return "expiring"
    return "ok"


def _ticket_public(t):
    return {**t, "sla_status": _ticket_sla(t.get("deadline"))}


def _rate_limit(key, limit=10, window=60):
    """Rate limit in-memory per key (fix kelemahan #10: spam create/action)."""
    now = time.time()
    cur, start = _TICKET_RATE.get(key, (0, now))
    if now - start > window:
        cur, start = 0, now
    if cur >= limit:
        return False
    _TICKET_RATE[key] = (cur + 1, start)
    return True


def _clean_by(by):
    """Sanitasi identitas pelaku — hanya agent/owner yang diizinkan (fix #9: by anti-palsu)."""
    by = (by or "samian").strip().lower()
    return by if by in _ticket_agents() else "samian"


def _ticket_notify(text, dedupe_key=None, dedupe_secs=60):
    """Kirim notif Telegram + dedupe (fix #8: anti-spam notif)."""
    if dedupe_key:
        st = load_json(os.path.join(DATA_DIR, "notify_state.json"), {})
        last = st.get("ticket_" + dedupe_key, 0)
        now = time.time()
        if now - last < dedupe_secs:
            return
        st["ticket_" + dedupe_key] = now
        save_json(os.path.join(DATA_DIR, "notify_state.json"), st)
    push_telegram(text)


def _agent_inbox_write(agent, payload):
    """Tulis ke inbox agent (fix #2: agent tahu ada tugas, bisa dibaca via endpoint)."""
    try:
        os.makedirs(TICKET_INBOX_DIR, exist_ok=True)
        path = os.path.join(TICKET_INBOX_DIR, _clean_by(agent) + ".json")
        items = load_json(path, {"items": []}).get("items", [])
        items.append(payload)
        items = items[-50:]  # simpan 50 terbaru
        save_json(path, {"items": items})
    except Exception:
        pass


def list_tickets(status=None, agent=None, priority=None, limit=None, offset=0):
    """List tiket + pagination (fix #7). Archived tidak muncul kecuali diminta."""
    data = load_json(TICKET_FILE, TICKET_DEFAULT)
    items = data.get("items", [])
    if status:
        if status != "archived":
            items = [i for i in items if i.get("status") == status]
    else:
        items = [i for i in items if i.get("status") != "archived"]
    if agent:
        items = [i for i in items if i.get("agent") == agent]
    if priority:
        items = [i for i in items if i.get("priority") == priority]
    items = [_ticket_public(i) for i in items]
    status_order = {"in_progress": 0, "open": 1, "done": 2, "cancelled": 3, "archived": 4}
    priority_order = {"high": 0, "normal": 1, "low": 2}
    items.sort(key=lambda i: (status_order.get(i.get("status"), 9), priority_order.get(i.get("priority"), 9), i.get("created_at", "")))
    total = len(items)
    limit = limit or TICKET_PAGE
    page = items[offset:offset + limit]
    return {"items": page, "total": total, "offset": offset, "limit": limit}


def ticket_stats():
    """KPI tiket per agent (fix #4: ukur kinerja dari tiket)."""
    data = load_json(TICKET_FILE, TICKET_DEFAULT)
    items = data.get("items", [])
    rows = []
    for aid in sorted(_ticket_agents()):
        own = [i for i in items if i.get("agent") == aid]
        done = [i for i in own if i.get("status") == "done"]
        cancelled = [i for i in own if i.get("status") == "cancelled"]
        durations = []
        for i in done:
            try:
                s = datetime.fromisoformat(i["created_at"].replace("Z", "+00:00"))
                e = datetime.fromisoformat(i["completed_at"].replace("Z", "+00:00"))
                durations.append((e - s).total_seconds() / 3600)
            except Exception:
                pass
        avg_h = round(sum(durations) / len(durations), 1) if durations else None
        rows.append({
            "agent": aid,
            "assigned": len(own),
            "done": len(done),
            "cancelled": len(cancelled),
            "open": sum(1 for i in own if i.get("status") == "open"),
            "in_progress": sum(1 for i in own if i.get("status") == "in_progress"),
            "avg_hours": avg_h,
        })
    rows.sort(key=lambda r: -r["done"])
    return {"rows": rows}


def create_ticket(payload):
    data = load_json(TICKET_FILE, TICKET_DEFAULT)
    if not _rate_limit("create_ticket", limit=20, window=60):
        raise ValueError("terlalu banyak membuat tiket — coba lagi nanti")
    title = (payload.get("title") or "").strip()
    if not title:
        raise ValueError("judul wajib diisi")
    if len(title) > 200:
        raise ValueError("judul terlalu panjang (maks 200)")
    priority = payload.get("priority", "normal")
    if priority not in TICKET_PRIORITY:
        priority = "normal"
    agent = (payload.get("agent") or "").strip().lower()
    if agent and agent not in _ticket_agents():
        agent = None
    by = _clean_by(payload.get("created_by"))
    item = {
        "id": _ticket_id(),
        "title": title,
        "description": (payload.get("description") or "")[:2000],
        "priority": priority,
        "status": "open",
        "agent": agent or None,
        "deadline": payload.get("deadline") or None,
        "created_by": by,
        "created_at": now_iso(),
        "assigned_at": None,
        "completed_at": None,
        "timeline": [{"ts": now_iso(), "action": "created", "by": by, "note": title}],
    }
    if item["agent"]:
        item["status"] = "in_progress"
        item["assigned_at"] = now_iso()
        item["timeline"].append({"ts": now_iso(), "action": "assign", "by": by, "note": f"diambil {item['agent']}"})
        _agent_inbox_write(item["agent"], {"type": "ticket", "id": item["id"], "title": item["title"], "priority": item["priority"], "deadline": item["deadline"], "ts": now_iso()})
    data["items"].append(item)
    save_json(TICKET_FILE, data)
    _ticket_notify(
        f"🎫 Tiket baru: <b>{_esc_html(title[:80])}</b> (prioritas {priority})"
        + (f" → <b>{_esc_html(item['agent'])}</b>" if item['agent'] else " — masuk antrian"),
        dedupe_key="create_" + item["id"],
    )
    return item


def ticket_action(ticket_id, action, payload):
    data = load_json(TICKET_FILE, TICKET_DEFAULT)
    idx = next((i for i, t in enumerate(data["items"]) if t["id"] == ticket_id), None)
    if idx is None:
        return None, "tiket tidak ditemukan"
    t = data["items"][idx]
    by = _clean_by(payload.get("by"))
    note = (payload.get("note") or "")[:500]
    now = now_iso()
    if action == "assign":
        if not _rate_limit("assign", limit=30, window=60):
            return None, "terlalu banyak aksi — coba lagi nanti"
        agent = (payload.get("agent") or "").strip().lower()
        if not agent or agent not in _ticket_agents():
            return None, "agent tidak valid"
        if t.get("agent") and t.get("status") == "in_progress" and t.get("agent") != agent:
            return None, f"tiket sedang dipegang {t['agent']} — lepas dulu"
        t["agent"] = agent
        t["status"] = "in_progress"
        t["assigned_at"] = now
        t["timeline"].append({"ts": now, "action": "assign", "by": by, "note": f"diambil {agent}" + (f" — {note}" if note else "")})
        _agent_inbox_write(agent, {"type": "ticket", "id": t["id"], "title": t["title"], "priority": t["priority"], "deadline": t["deadline"], "ts": now})
        _ticket_notify(f"🎫 <b>{_esc_html(t['title'][:60])}</b> → diambil <b>{_esc_html(agent)}</b>", dedupe_key="assign_" + t["id"])
    elif action == "claim":
        # agent mengambil tiket dari antrian sendiri (fix #1: agentic) — by = agent yang claim
        agent = by
        if agent == "samian":
            agent = (payload.get("agent") or "").strip().lower()
        if not agent or agent not in _ticket_agents() or agent == "samian":
            return None, "agent tidak valid untuk claim"
        if t.get("agent") and t.get("status") == "in_progress" and t.get("agent") != agent:
            return None, f"tiket sedang dipegang {t['agent']}"
        t["agent"] = agent
        t["status"] = "in_progress"
        t["assigned_at"] = now
        t["timeline"].append({"ts": now, "action": "assign", "by": agent, "note": f"diambil {agent} (self-claim)"})
        _agent_inbox_write(agent, {"type": "ticket", "id": t["id"], "title": t["title"], "priority": t["priority"], "deadline": t["deadline"], "ts": now})
        _ticket_notify(f"🎫 <b>{_esc_html(t['title'][:60])}</b> → diambil <b>{_esc_html(agent)}</b> (self-claim)", dedupe_key="claim_" + t["id"])
    elif action == "edit":
        if not _rate_limit("edit", limit=30, window=60):
            return None, "terlalu banyak aksi — coba lagi nanti"
        changed = []
        for field in TICKET_EDIT_FIELDS:
            if field in payload:
                val = payload[field]
                if field == "title":
                    val = (val or "").strip()
                    if not val or len(val) > 200:
                        return None, "judul tidak valid"
                elif field == "description":
                    val = (val or "")[:2000]
                elif field == "priority":
                    if val not in TICKET_PRIORITY:
                        return None, "prioritas tidak valid"
                elif field == "deadline":
                    if val and _ticket_sla(val) is None:
                        # tetap simpan — SLA None berarti parse gagal, tolak format buruk
                        if not val.endswith("Z") and "T" not in val:
                            return None, "deadline tidak valid"
                t[field] = val
                changed.append(field)
        if changed:
            t["timeline"].append({"ts": now, "action": "edit", "by": by, "note": "diubah: " + ", ".join(changed) + (f" — {note}" if note else "")})
    elif action == "status":
        if not _rate_limit("status", limit=30, window=60):
            return None, "terlalu banyak aksi — coba lagi nanti"
        status = payload.get("status")
        if status not in TICKET_STATUS:
            return None, "status tidak valid"
        t["status"] = status
        if status == "done":
            t["completed_at"] = now
        if status == "open" and t.get("agent"):
            t["agent"] = None
            t["assigned_at"] = None
        t["timeline"].append({"ts": now, "action": "status", "by": by, "note": f"→ {status}" + (f" — {note}" if note else "")})
        if status in ("done", "cancelled"):
            _ticket_notify(f"🎫 <b>{_esc_html(t['title'][:60])}</b> {status} — {_esc_html(by)}", dedupe_key="status_" + t["id"] + "_" + status)
    elif action == "unassign":
        t["agent"] = None
        t["assigned_at"] = None
        if t.get("status") == "in_progress":
            t["status"] = "open"
        t["timeline"].append({"ts": now, "action": "unassign", "by": by, "note": note or "dilepas"})
    elif action == "note":
        t["timeline"].append({"ts": now, "action": "note", "by": by, "note": note or "-"})
    elif action == "archive":
        # pindah ke file arsip (fix #6 + #12: list aktif tetap kecil)
        if t.get("status") in ("done", "cancelled"):
            arch = load_json(TICKET_ARCHIVE_FILE, TICKET_DEFAULT)
            t["status"] = "archived"
            t["archived_at"] = now
            t["timeline"].append({"ts": now, "action": "archive", "by": by, "note": note or "diarsipkan"})
            arch["items"].append(t)
            save_json(TICKET_ARCHIVE_FILE, arch)
            data["items"].pop(idx)
            save_json(TICKET_FILE, data)
            return t, None
        t["status"] = "archived"
        t["archived_at"] = now
        t["timeline"].append({"ts": now, "action": "archive", "by": by, "note": note or "diarsipkan"})
        save_json(TICKET_FILE, data)
        return t, None
    else:
        return None, "aksi tidak dikenal"
    save_json(TICKET_FILE, data)
    return t, None


def ticket_queue():
    """Antrian tiket open yang bisa diambil agent (fix #1: agentic pull)."""
    data = load_json(TICKET_FILE, TICKET_DEFAULT)
    items = [i for i in data.get("items", []) if i.get("status") == "open"]
    items = [_ticket_public(i) for i in items]
    priority_order = {"high": 0, "normal": 1, "low": 2}
    items.sort(key=lambda i: (priority_order.get(i.get("priority"), 9), i.get("created_at", "")))
    return {"items": items}


def agent_inbox(agent):
    """Baca inbox agent (fix #2: agent bisa lihat tugas yang ditujukan padanya)."""
    path = os.path.join(TICKET_INBOX_DIR, _clean_by(agent) + ".json")
    return load_json(path, {"items": []})


# ---------- W4: license (jual putus) ----------

LICENSE_FILE = os.path.join(DATA_DIR, "license.json")
LICENSE_DEFAULT = {
    "key": None, "client_name": None, "issued_at": None,
    "expires_at": None, "activated_at": None, "status": "unlicensed",
}
LICENSE_SECRET_FALLBACK = "MYOFFICE-LICENSE-SAM-2026"  # kontrol ringan (bukan DRM)


def _license_secret():
    return os.environ.get("MYOFFICE_LICENSE_SECRET", "") or LICENSE_SECRET_FALLBACK


def get_license():
    data = load_json(LICENSE_FILE, LICENSE_DEFAULT)
    if not data.get("key"):
        data["status"] = "unlicensed"
        return data
    expires = data.get("expires_at")
    if expires:
        try:
            exp_dt = datetime.fromisoformat(expires.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) > exp_dt:
                data["status"] = "expired"
                return data
        except Exception:
            pass
    data["status"] = "active"
    return data


def activate_license(payload):
    """Aktivasi lisensi. Key format: <client_hex>.<expiry_hex>.<hmac_sha256>."""
    key = str(payload.get("key", "")).strip()
    client = str(payload.get("client_name", "")).strip()
    parts = key.split(".")
    if len(parts) != 3:
        return None, "format key tidak valid (client.expiry.signature)"
    try:
        client_dec = bytes.fromhex(parts[0]).decode("utf-8")
        expires_dec = bytes.fromhex(parts[1]).decode("utf-8")
    except Exception:
        return None, "key rusak (bagian hex tidak valid)"
    expected = hmac.new(
        _license_secret().encode(), f"{client_dec}:{expires_dec}".encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, parts[2]):
        return None, "signature tidak valid"
    if client and client_dec != client:
        return None, "client name tidak cocok dengan key"
    # cek expiry format ISO
    try:
        datetime.fromisoformat(expires_dec.replace("Z", "+00:00"))
    except Exception:
        return None, "tanggal kadaluarsa tidak valid"
    data = {
        "key": key,
        "client_name": client_dec,
        "issued_at": now_iso(),
        "expires_at": expires_dec,
        "activated_at": now_iso(),
        "status": "active",
    }
    save_json(LICENSE_FILE, data)
    return data, None


def get_system_logs(level="all", tail=500):
    """Baca log sistem (Fix Logs 404): journalctl service + docker studio."""
    import subprocess
    lines = []
    try:
        cmd = ["journalctl", "-u", "myoffice-office.service", "--no-pager", "-n", str(min(int(tail), 2000))]
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=10).stdout
        lines = out.splitlines()
    except Exception:
        pass
    try:
        cmd2 = ["docker", "logs", "myoffice-studio", "--tail", str(min(int(tail), 2000))]
        out2 = subprocess.run(cmd2, capture_output=True, text=True, timeout=10).stdout
        lines = lines + ["-- studio --"] + out2.splitlines()
    except Exception:
        pass
    return {"logs": lines[-int(tail):], "source": "journalctl+docker"}


def generate_report(kind="kpi", days=7):
    """Generate laporan PDF (kpi/payroll/health) → simpan ke vault/reports/ (bisa di-download via Files).
    Fitur nilai jual: laporan otomatis per periode untuk klien."""
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
        from reportlab.lib import colors
    except Exception as e:
        return None, f"reportlab tidak tersedia: {e}"
    try:
        days = min(int(days), 90)
    except Exception:
        days = 7
    os.makedirs(os.path.join(VAULT_ROOT, "reports"), exist_ok=True)
    fname = f"laporan_{kind}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')}.pdf"
    fpath = os.path.join(VAULT_ROOT, "reports", fname)
    brand = load_json(BRANDING_FILE, BRANDING_DEFAULT).get("name", "MyOffice")
    styles = getSampleStyleSheet()
    doc = SimpleDocTemplate(fpath, pagesize=A4, title=f"Laporan {kind} — {brand}")
    story = [Paragraph(f"<b>{brand}</b> — Laporan {kind.upper()}", styles["Title"]),
             Paragraph(f"Periode: 7 hari terakhir · Dibuat: {now_iso()}", styles["Normal"]),
             Spacer(1, 12)]
    rows = []
    if kind == "kpi":
        data = get_kpi()
        rows = [["Agent", "Score", "Tasks", "Cost USD"]]
        for r in data.get("rows", []):
            rows.append([r.get("id"), str(r.get("score", "-")), str(r.get("tasks_completed", 0)), str(r.get("cost", 0))])
    elif kind == "payroll":
        data = load_json(PAYROLL_FILE, PAYROLL_DEFAULT)
        cap_rows = load_json(CAPS_FILE, CAPS_DEFAULT).get("agent_caps", {})
        rows = [["Agent", "Spent USD", "Cap USD", "Pct"]]
        for r in data.get("agents", []):
            aid = r.get("id")
            spent = r.get("spent_usd", 0)
            cap = cap_rows.get(aid, 0)
            pct = round(spent / cap * 100, 1) if cap else 0
            rows.append([aid, str(spent), str(cap), f"{pct}%"])
    elif kind == "health":
        data = get_health()
        rows = [["Agent", "Status", "Uptime", "Sessions"]]
        for r in data.get("rows", []):
            rows.append([r.get("id"), str(r.get("status", "-")), str(r.get("uptime", "-")), str(r.get("sessions", 0))])
    else:
        return None, "kind tidak dikenal (kpi/payroll/health)"
    if len(rows) > 1:
        t = Table(rows, repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#6366F1")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F3F4F6")]),
        ]))
        story.append(t)
    story.append(Spacer(1, 20))
    story.append(Paragraph("Dokumen ini dihasilkan otomatis oleh MyOffice. Data akurat per waktu pembuatan.", styles["Normal"]))
    doc.build(story)
    return {"file": f"reports/{fname}", "size": os.path.getsize(fpath)}, None


def export_csv(kind="kpi"):
    """Export CSV: kpi / payroll / board — buat laporan klien (fitur #22)."""
    import csv
    import io
    buf = io.StringIO()
    w = csv.writer(buf)
    if kind == "kpi":
        data = get_kpi()
        w.writerow(["agent", "score", "sessions", "messages", "tokens", "cost", "tasks_completed"])
        for r in data.get("rows", []):
            w.writerow([r.get("id"), r.get("score"), r.get("sessions"), r.get("messages"),
                        r.get("tokens"), r.get("cost"), r.get("tasks_completed")])
    elif kind == "payroll":
        data = load_json(PAYROLL_FILE, PAYROLL_DEFAULT)
        caps = load_json(CAPS_FILE, CAPS_DEFAULT).get("agent_caps", {})
        w.writerow(["agent", "spent_usd", "cap_usd", "pct"])
        for r in data.get("agents", []):
            aid = r.get("id")
            spent = r.get("spent_usd", 0)
            cap = caps.get(aid, 0)
            w.writerow([aid, spent, cap, round(spent / cap * 100, 1) if cap else 0])
    elif kind == "board":
        data = load_json(BOARD_FILE, BOARD_DEFAULT)
        w.writerow(["id", "title", "status", "agent", "priority", "risk", "type", "sla_minutes", "created_at", "updated_at"])
        for i in data.get("items", []):
            w.writerow([i.get("id"), i.get("title"), i.get("status"), i.get("agent"),
                        i.get("priority"), i.get("risk"), i.get("type"), i.get("sla_minutes"),
                        i.get("created_at"), i.get("updated_at")])
    else:
        return None, "kind tidak dikenal (kpi/payroll/board)"
    return buf.getvalue(), None


# ---------- komunikasi agent (FASE 2: kantor hidup) ----------

MESSAGE_FILE = os.path.join(DATA_DIR, "messages.json")
MESSAGE_DEFAULT = {"items": []}
BROADCAST_FILE = os.path.join(DATA_DIR, "broadcasts.json")
BROADCAST_DEFAULT = {"items": []}


def _msg_public(m):
    return {k: m.get(k) for k in ("id", "from", "to", "subject", "body", "priority", "task_id", "created_at", "read_by")}


def send_message(payload):
    """Kirim pesan agent→agent. Simpan ke messages + tulis ke inbox penerima."""
    frm = str(payload.get("from", "")).strip()
    to = str(payload.get("to", "")).strip()
    subject = str(payload.get("subject", "")).strip()
    body = str(payload.get("body", "")).strip()
    if not frm or not to or not body:
        return None, "from/to/body wajib"
    msg = {
        "id": "msg_" + hashlib.md5((frm + to + body + str(time.time())).encode()).hexdigest()[:8],
        "from": frm, "to": to, "subject": subject or "(tanpa subjek)",
        "body": body, "priority": payload.get("priority", "normal"),
        "task_id": payload.get("task_id"), "created_at": now_iso(),
        "read_by": [],
    }
    data = load_json(MESSAGE_FILE, MESSAGE_DEFAULT)
    data["items"].append(msg)
    data["items"] = data["items"][-2000:]
    save_json(MESSAGE_FILE, data)
    # tulis ke inbox penerima (agent_inbox — file json per agent)
    _agent_inbox_write(to, {"kind": "message", "msg_id": msg["id"], "from": frm,
                            "title": subject or "(tanpa subjek)", "body": body, "priority": msg["priority"],
                            "task_id": msg.get("task_id"), "created_at": msg["created_at"]})
    # notif Telegram ke Dato' (CEO observer)
    try:
        push_telegram(f"💬 <b>[{frm} → {to}]</b> {_esc_html(subject or body[:40])}")
    except Exception:
        pass
    return msg, None


def list_messages(agent=None, limit=100):
    """List pesan — filter by agent (to atau from)."""
    data = load_json(MESSAGE_FILE, MESSAGE_DEFAULT).get("items", [])
    if agent:
        data = [m for m in data if m.get("to") == agent or m.get("from") == agent]
    data = data[-int(limit):]
    return [_msg_public(m) for m in reversed(data)]


def broadcast_message(payload):
    """Broadcast dari CEO (samian) → semua agent. Tulis ke inbox semua + simpan arsip."""
    frm = str(payload.get("from", "samian")).strip()
    subject = str(payload.get("subject", "")).strip()
    body = str(payload.get("body", "")).strip()
    if not body:
        return None, "body wajib"
    b = {
        "id": "bc_" + hashlib.md5((body + str(time.time())).encode()).hexdigest()[:8],
        "from": frm, "subject": subject or "(instruksi)", "body": body,
        "created_at": now_iso(), "read_by": [],
    }
    data = load_json(BROADCAST_FILE, BROADCAST_DEFAULT)
    data["items"].insert(0, b)
    data["items"] = data["items"][:500]
    save_json(BROADCAST_FILE, data)
    # tulis ke inbox semua agent resmi
    for aid in _ticket_agents():
        if aid != "samian":
            _agent_inbox_write(aid, {"kind": "broadcast", "bc_id": b["id"], "from": frm,
                                     "title": f"📢 {subject or 'Instruksi'}", "body": body,
                                     "priority": "high", "created_at": b["created_at"]})
    try:
        push_telegram(f"📢 <b>Broadcast:</b> {_esc_html(subject or body[:40])}")
    except Exception:
        pass
    return b, None


def list_broadcasts(limit=20):
    data = load_json(BROADCAST_FILE, BROADCAST_DEFAULT).get("items", [])
    return data[:int(limit)]


def get_notifications(limit=20):
    """Notification hub — gabungan: approvals pending, incidents open, messages unread, broadcasts."""
    notifs = []
    try:
        for i in list_approvals()[:5]:
            if i.get("status") == "pending":
                notifs.append({"kind": "approval", "id": i["id"], "title": f"🛂 Approval: {i.get('title', '')}",
                               "detail": f"{i.get('agent')} · risiko {i.get('risk', '?')}", "ts": i.get("requested_at")})
    except Exception:
        pass
    try:
        inc = load_json(INCIDENT_FILE, INCIDENT_DEFAULT).get("items", [])
        for i in inc[:3]:
            if i.get("status") in ("open", "escalated"):
                notifs.append({"kind": "incident", "id": i["id"], "title": f"🚨 {i.get('message', 'incident')}",
                               "detail": f"{i.get('severity', '?')} · {i.get('status')}", "ts": i.get("created_at")})
    except Exception:
        pass
    for m in list_messages(limit=5):
        notifs.append({"kind": "message", "id": m["id"], "title": f"💬 {m.get('from')} → {m.get('to')}",
                       "detail": m.get("subject", ""), "ts": m.get("created_at")})
    for b in list_broadcasts(5):
        notifs.append({"kind": "broadcast", "id": b["id"], "title": f"📢 Broadcast: {b.get('subject', '')}",
                       "detail": b.get("from", ""), "ts": b.get("created_at")})
    notifs.sort(key=lambda n: n.get("ts") or "", reverse=True)
    return notifs[:int(limit)]


# ---------- F3-1: AI Assistant "Tanya MyOffice" ----------

def ask_myoffice(q):
    """Jawab pertanyaan data live (rule-based — tanpa LLM eksternal)."""
    q = (q or "").lower()
    if not q.strip():
        return "Tanya apa saja: 'spend minggu ini?', 'task pending nadine?', 'siapa online?', 'approval menunggu?'"
    try:
        fleet = fetch_fleet() or {"agents": []}
        agents = fleet.get("agents", [])
    except Exception:
        agents = []
    # siapa online / status fleet
    if any(k in q for k in ("online", "status", "siapa", "aktif", "fleet")):
        online = [a.get("name", a.get("id")) for a in agents if a.get("status") == "online"]
        off = [a.get("name", a.get("id")) for a in agents if a.get("status") != "online"]
        return f"🟢 Online ({len(online)}): {', '.join(online) or '-'}\n🔴 Offline ({len(off)}): {', '.join(off) or '-'}"
    # spend / biaya / budget
    if any(k in q for k in ("spend", "biaya", "cost", "budget", "uang", "harga")):
        rows = []
        try:
            rows = get_kpi().get("rows", [])
        except Exception:
            pass
        total = sum(r.get("cost", 0) for r in rows)
        per = ", ".join(f"{r.get('id')} ${r.get('cost', 0):.2f}" for r in rows)
        return f"💰 Total spend: ${total:.2f}\n{per}"
    # task pending / task agent
    if any(k in q for k in ("task", "tugas", "pending", "kanban", "board")):
        try:
            bd = load_json(BOARD_FILE, BOARD_DEFAULT)
            items = bd.get("items", [])
            done = sum(1 for i in items if i.get("status") == "done")
            active = [i for i in items if i.get("status") in ("in_progress", "todo", "waiting_approval")]
            # filter agent jika disebut
            for ag in ("rena", "farrah", "nadine", "aaron", "dinda"):
                if ag in q:
                    active = [i for i in active if i.get("agent") == ag]
                    break
            s = "\n".join(f"• {i.get('status')} | {i.get('agent') or 'pool'} | {str(i.get('title'))[:50]}" for i in active[:8])
            return f"📋 Task aktif ({len(active)}):\n{s or 'kosong'}\n✅ Selesai total: {done}"
        except Exception:
            return "Data board tidak tersedia"
    # approval
    if any(k in q for k in ("approval", "izin", "menunggu", "approve")):
        try:
            ap = list_approvals().get("items", [])
            pend = [i for i in ap if i.get("status") == "pending"]
            return f"🛂 Approval menunggu: {len(pend)}\n" + "\n".join(f"• {i.get('agent')} | {str(i.get('title'))[:50]}" for i in pend[:5]) if pend else "🛂 Tidak ada approval menunggu ✅"
        except Exception:
            return "Data approval tidak tersedia"
    # incident
    if any(k in q for k in ("incident", "masalah", "error", "sehat", "health")):
        try:
            inc = load_json(INCIDENT_FILE, INCIDENT_DEFAULT).get("items", [])
            open_inc = [i for i in inc if i.get("status") in ("open", "escalated")]
            return f"🚨 Incident open: {len(open_inc)}\n" + "\n".join(f"• {i.get('message', '')[:60]}" for i in open_inc[:5]) if open_inc else "✅ Semua aman — tidak ada incident"
        except Exception:
            return "Data incident tidak tersedia"
    # message / pesan
    if any(k in q for k in ("pesan", "message", "inbox", "chat")):
        try:
            msgs = list_messages(limit=5)
            return "💬 Pesan terbaru:\n" + "\n".join(f"• {m.get('from')} → {m.get('to')}: {str(m.get('subject'))[:40]}" for m in msgs) if msgs else "💬 Belum ada pesan antar agent"
        except Exception:
            return "Data pesan tidak tersedia"
    return ("Coba tanya: 'siapa online?', 'spend minggu ini?', 'task pending nadine?', "
            "'approval menunggu?', 'ada incident?', 'pesan terbaru?'")


# ---------- F3-5: trace / decision log ----------

def get_trace(agent=None, hours=24):
    """Trace aktivitas agent dari activity_log + history board."""
    cutoff = time.time() - int(hours) * 3600
    events = []
    if os.path.exists(ACTIVITY_LOG):
        with open(ACTIVITY_LOG, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    rec = json.loads(line)
                    if rec.get("ts", 0) >= cutoff and (not agent or rec.get("agent") == agent):
                        events.append(rec)
                except Exception:
                    continue
    events.sort(key=lambda e: e.get("ts", 0))
    # history board utk agent
    try:
        bd = load_json(BOARD_FILE, BOARD_DEFAULT)
        for i in bd.get("items", []):
            if agent and i.get("agent") != agent:
                continue
            for h in i.get("history", [])[:20]:
                if h.get("at", "").replace("Z", "+00:00") >= (datetime.now(timezone.utc) - timedelta(hours=int(hours))).isoformat():
                    events.append({"ts": datetime.fromisoformat(h["at"].replace("Z", "+00:00")).timestamp(), "agent": i.get("agent"), "kind": "board", "detail": f"{h.get('from')} → {h.get('to')} | {h.get('note', '')}"})
    except Exception:
        pass
    events.sort(key=lambda e: e.get("ts", 0))
    return [{"ts": e.get("ts"), "agent": e.get("agent"), "kind": e.get("kind", e.get("action", "event")), "detail": e.get("detail", e.get("task", ""))} for e in events[-200:]]


# ---------- F3-2: token ledger per project ----------

LEDGER_FILE = os.path.join(DATA_DIR, "token_ledger.json")
LEDGER_DEFAULT = {"projects": {}, "assignments": {}}


def get_ledger():
    return load_json(LEDGER_FILE, LEDGER_DEFAULT)


def set_ledger_project(payload):
    data = get_ledger()
    name = str(payload.get("name", "")).strip()
    if not name:
        return None, "nama project wajib"
    projects = data.setdefault("projects", {})
    if name not in projects:
        projects[name] = {"created_at": now_iso(), "budget_usd": float(payload.get("budget_usd", 0) or 0), "spent_usd": 0.0}
    else:
        if "budget_usd" in payload:
            projects[name]["budget_usd"] = float(payload.get("budget_usd", 0) or 0)
    save_json(LEDGER_FILE, data)
    return projects[name], None


def assign_project(agent, project):
    data = get_ledger()
    if project and project not in data.get("projects", {}):
        return None, "project tidak dikenal"
    data.setdefault("assignments", {})[agent] = project or None
    save_json(LEDGER_FILE, data)
    return data["assignments"], None


# ---------- F3-11: review → KPI ----------

REVIEW_FILE = os.path.join(DATA_DIR, "reviews.json")
REVIEW_DEFAULT = {"items": []}


def submit_review(payload):
    agent = str(payload.get("agent", "")).strip()
    score = float(payload.get("score", 0))
    if not agent or not (0 <= score <= 100):
        return None, "agent + score (0-100) wajib"
    rev = {"id": "rv_" + hashlib.md5((agent + str(time.time())).encode()).hexdigest()[:8],
           "agent": agent, "score": score, "note": str(payload.get("note", "")).strip(),
           "by": str(payload.get("by", "samian")), "created_at": now_iso()}
    data = load_json(REVIEW_FILE, REVIEW_DEFAULT)
    data["items"].insert(0, rev)
    data["items"] = data["items"][:500]
    save_json(REVIEW_FILE, data)
    # update KPI quality_score (rata-rata review terakhir per agent)
    try:
        avg = sum(r["score"] for r in data["items"] if r["agent"] == agent) / max(1, sum(1 for r in data["items"] if r["agent"] == agent))
        kd = load_json(KPI_FILE, KPI_DEFAULT) if "KPI_FILE" in dir() else None
    except Exception:
        pass
    return rev, None


def list_reviews(agent=None):
    data = load_json(REVIEW_FILE, REVIEW_DEFAULT).get("items", [])
    if agent:
        data = [r for r in data if r.get("agent") == agent]
    return data[:50]


# ---------- F3-6: Agent Parliament (voting multi-agent — world-first) ----------

PARLIAMENT_FILE = os.path.join(DATA_DIR, "parliament.json")
PARLIAMENT_DEFAULT = {"items": []}
# Domain per agent (untuk voting rule-based, transparan & deterministik)
PARLIAMENT_DOMAIN = {
    "rena": {"ops", "koordinasi", "content", "external_contact"},
    "farrah": {"ops", "spending", "external_contact", "content", "bisnis"},
    "nadine": {"riset", "project", "findbuyer", "content"},
    "aaron": {"security", "secret_access", "audit", "deploy", "install"},
    "dinda": {"deploy", "install", "automation", "development", "secret_access"},
}


def _parliament_vote(atype, risk):
    """Vote rule-based: agent yang domainnya cocok → approve; terkait risiko → against;
    lainnya abstain. Transparan (bukan magic) — bisa diganti LLM nanti."""
    votes = []
    for agent, dom in PARLIAMENT_DOMAIN.items():
        if atype in dom:
            votes.append({"agent": agent, "vote": "approve", "reason": f"domain {atype}"})
        elif risk in ("high", "critical") and agent == "aaron":
            votes.append({"agent": agent, "vote": "against", "reason": "risiko tinggi — perlu review"})
        else:
            votes.append({"agent": agent, "vote": "abstain", "reason": "di luar domain"})
    return votes


def start_parliament(payload):
    """Mulai sidang: issue + tiap agent vote → hasil mayoritas → rekomendasi."""
    issue = str(payload.get("issue", "")).strip()
    title = str(payload.get("title", "Keputusan")).strip()
    atype = str(payload.get("type", "task")).strip() or "task"
    risk = str(payload.get("risk", "medium")).strip() or "medium"
    if not issue:
        return None, "issue wajib"
    votes = _parliament_vote(atype, risk)
    approves = sum(1 for v in votes if v["vote"] == "approve")
    againsts = sum(1 for v in votes if v["vote"] == "against")
    total_votes = approves + againsts
    decision = "approved" if approves > againsts else ("rejected" if againsts > approves else "undecided")
    sess = {
        "id": "par_" + hashlib.md5((issue + str(time.time())).encode()).hexdigest()[:8],
        "title": title, "issue": issue, "type": atype, "risk": risk,
        "votes": votes, "approves": approves, "againsts": againsts,
        "decision": decision, "status": "decided" if decision != "undecided" else "open",
        "created_at": now_iso(),
    }
    data = load_json(PARLIAMENT_FILE, PARLIAMENT_DEFAULT)
    data["items"].insert(0, sess)
    data["items"] = data["items"][:200]
    save_json(PARLIAMENT_FILE, data)
    try:
        push_telegram(f"🏛 <b>Agent Parliament</b> — {title}\n{issue[:80]}\n✅ {approves} setuju · ❌ {againsts} tolak → <b>{decision.upper()}</b>")
    except Exception:
        pass
    return sess, None


def list_parliament(limit=20):
    return load_json(PARLIAMENT_FILE, PARLIAMENT_DEFAULT).get("items", [])[:int(limit)]


# ---------- F3-9: fleet refresh & uptime ----------

def fleet_refresh():
    """Refresh fleet.json dari gateway (fetcher)."""
    try:
        import urllib.request
        req = urllib.request.Request(FLEET_URL, headers=auth_headers("fleet-refresh") if "auth_headers" in dir() else {})
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.loads(r.read())
    except Exception:
        return fetch_fleet() or {"agents": []}


def get_uptime(agent=None, days=7):
    """Uptime per hari: hitung event activity_log per agent per hari (7 hari terakhir)."""
    now = datetime.now(timezone.utc)
    result = {}
    if os.path.exists(ACTIVITY_LOG):
        with open(ACTIVITY_LOG, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    rec = json.loads(line)
                    if agent and rec.get("agent") != agent:
                        continue
                    ts = rec.get("ts", 0)
                    if ts < (now - timedelta(days=days)).timestamp():
                        continue
                    day = datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d")
                    result.setdefault(day, {}).setdefault(rec.get("agent", "?"), 0)
                    result[day][rec.get("agent", "?")] += 1
                except Exception:
                    continue
    return result


# ---------- F3-12: MCP gateway config ----------

MCP_FILE = os.path.join(DATA_DIR, "mcp_servers.json")
MCP_DEFAULT = {"servers": []}


def list_mcp():
    return load_json(MCP_FILE, MCP_DEFAULT).get("servers", [])


def save_mcp(payload):
    name = str(payload.get("name", "")).strip()
    url = str(payload.get("url", "")).strip()
    if not name or not url:
        return None, "name + url wajib"
    data = load_json(MCP_FILE, MCP_DEFAULT)
    servers = data.setdefault("servers", [])
    for s in servers:
        if s.get("name") == name:
            s["url"] = url
            s["enabled"] = bool(payload.get("enabled", True))
            s["tools"] = payload.get("tools", [])
            save_json(MCP_FILE, data)
            return s, None
    srv = {"name": name, "url": url, "enabled": bool(payload.get("enabled", True)),
           "tools": payload.get("tools", []), "created_at": now_iso()}
    servers.append(srv)
    save_json(MCP_FILE, data)
    return srv, None


def delete_mcp(name):
    data = load_json(MCP_FILE, MCP_DEFAULT)
    before = len(data.get("servers", []))
    data["servers"] = [s for s in data.get("servers", []) if s.get("name") != name]
    if len(data["servers"]) == before:
        return False
    save_json(MCP_FILE, data)
    return True


def export_xlsx(kind="kpi"):
    """Export Excel (.xlsx): kpi / payroll / board (F4-4) → simpan ke vault/reports/."""
    try:
        from openpyxl import Workbook
    except Exception as e:
        return None, f"openpyxl tidak tersedia: {e}"
    wb = Workbook()
    ws = wb.active
    if kind == "kpi":
        data = get_kpi()
        ws.title = "KPI"
        ws.append(["Agent", "Score", "Sessions", "Messages", "Tokens", "Cost", "Tasks Done"])
        for r in data.get("rows", []):
            ws.append([r.get("id"), r.get("score"), r.get("sessions"), r.get("messages"),
                       r.get("tokens"), r.get("cost"), r.get("tasks_completed")])
    elif kind == "payroll":
        data = load_json(PAYROLL_FILE, PAYROLL_DEFAULT)
        caps = load_json(CAPS_FILE, CAPS_DEFAULT).get("agent_caps", {})
        ws.title = "Budget"
        ws.append(["Agent", "Spent USD", "Cap USD", "Pct"])
        for r in data.get("agents", []):
            aid = r.get("id")
            spent = r.get("spent_usd", 0)
            cap = caps.get(aid, 0)
            ws.append([aid, spent, cap, round(spent / cap * 100, 1) if cap else 0])
    elif kind == "board":
        data = load_json(BOARD_FILE, BOARD_DEFAULT)
        ws.title = "Board"
        ws.append(["ID", "Title", "Status", "Agent", "Priority", "Risk", "Type", "SLA", "Created"])
        for i in data.get("items", []):
            ws.append([i.get("id"), i.get("title"), i.get("status"), i.get("agent"),
                       i.get("priority"), i.get("risk"), i.get("type"), i.get("sla_minutes"),
                       i.get("created_at")])
    else:
        return None, "kind tidak dikenal (kpi/payroll/board)"
    os.makedirs(os.path.join(VAULT_ROOT, "reports"), exist_ok=True)
    fname = f"export_{kind}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')}.xlsx"
    fpath = os.path.join(VAULT_ROOT, "reports", fname)
    wb.save(fpath)
    return {"file": f"reports/{fname}", "size": os.path.getsize(fpath)}, None


# ---------- memory / knowledge base (fitur jualan — MemFS-style) ----------

MEMORY_DIR = os.environ.get("MYOFFICE_MEMORY_DIR", "/opt/myoffice/memory")
MEMORY_INDEX_FILE = os.path.join(DATA_DIR, "memory_index.json")
MEMORY_CATEGORIES = ["system", "reference", "company", "learnings"]
MEMORY_DEFAULT_INDEX = {"items": []}


def _memory_path(mem_id):
    """path aman dari id memori (format: category/name atau name)."""
    parts = mem_id.split("/", 1)
    cat = parts[0] if parts[0] in MEMORY_CATEGORIES else "reference"
    name = parts[1] if len(parts) > 1 and parts[0] in MEMORY_CATEGORIES else mem_id
    safe = (re.sub(r"[^a-zA-Z0-9_.-]", "_", name)[:80] or "note")
    return os.path.join(MEMORY_DIR, cat, safe + ".md"), cat


def _memory_index():
    return load_json(MEMORY_INDEX_FILE, MEMORY_DEFAULT_INDEX)


def _save_memory_index(idx):
    save_json(MEMORY_INDEX_FILE, idx)


def _memory_version_backup(mem_id, content):
    """Snapshot versi lama ke data/versions/memory/<id>/<ts>.md."""
    try:
        vdir = os.path.join(DATA_DIR, "versions", "memory", re.sub(r"[^a-zA-Z0-9_.-]", "_", mem_id)[:60])
        os.makedirs(vdir, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        with open(os.path.join(vdir, ts + ".md"), "w", encoding="utf-8") as f:
            f.write(content)
    except Exception:
        pass


def list_memory(category=None, q=None, agent=None):
    idx = _memory_index()
    items = []
    for entry in idx.get("items", []):
        if category and entry.get("category") != category:
            continue
        if agent and entry.get("agent") and entry.get("agent") != agent:
            continue
        if q:
            hay = (entry.get("title", "") + " " + entry.get("content", "")).lower()
            if q.lower() not in hay:
                continue
        items.append({k: entry.get(k) for k in ("id", "title", "category", "agent", "tags", "updated_at", "created_at")})
    items.sort(key=lambda e: e.get("updated_at", ""), reverse=True)
    return {"items": items, "categories": MEMORY_CATEGORIES}


def get_memory(mem_id):
    path, cat = _memory_path(mem_id)
    if not os.path.isfile(path):
        return None, "not found"
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()
    # strip YAML frontmatter utk konten
    body = content
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            body = parts[2].lstrip("\n")
    idx = _memory_index()
    meta = next((e for e in idx.get("items", []) if e.get("id") == mem_id), {})
    return {"id": mem_id, "category": cat, "content": body, **{k: meta.get(k) for k in ("title", "agent", "tags", "updated_at", "created_at")}}, None


def save_memory(payload):
    mem_id = str(payload.get("id", "")).strip()
    title = str(payload.get("title", "")).strip()[:200]
    content = str(payload.get("content", "")).strip()
    category = str(payload.get("category", "reference")).strip()
    agent = str(payload.get("agent", "")).strip() or None
    tags = [str(t).strip()[:30] for t in (payload.get("tags") or [])][:8]
    if category not in MEMORY_CATEGORIES:
        return None, "kategori tidak dikenal: " + category
    if not title or not content:
        return None, "judul & isi wajib diisi"
    # id default = slug dari title
    if not mem_id:
        mem_id = re.sub(r"[^a-zA-Z0-9]+", "-", title.lower()).strip("-")[:60]
        if not mem_id:
            mem_id = "note-" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    safe_id = f"{category}/{mem_id}"
    path, _ = _memory_path(safe_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            _memory_version_backup(safe_id, f.read())
    front = "---\n"
    front += f"title: \"{title.replace(chr(34), chr(39))}\"\n"
    front += f"category: {category}\n"
    if agent:
        front += f"agent: {agent}\n"
    if tags:
        front += f"tags: [{', '.join(tags)}]\n"
    front += f"updated_at: \"{now_iso()}\"\n---\n\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(front + content)
    # index
    idx = _memory_index()
    found = False
    for entry in idx.get("items", []):
        if entry.get("id") == safe_id:
            entry.update({
                "title": title, "category": category, "agent": agent, "tags": tags,
                "content": content[:500], "updated_at": now_iso(),
                "created_at": entry.get("created_at") or now_iso(),
            })
            found = True
            break
    if not found:
        idx["items"].append({
            "id": safe_id, "title": title, "category": category, "agent": agent,
            "tags": tags, "content": content[:500],
            "created_at": now_iso(), "updated_at": now_iso(),
        })
    _save_memory_index(idx)
    return {"id": safe_id, "title": title, "category": category, "agent": agent, "tags": tags}, None


def delete_memory(mem_id):
    path, _ = _memory_path(mem_id)
    if not os.path.isfile(path):
        return False, "not found"
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        _memory_version_backup(mem_id, f.read())
    os.remove(path)
    idx = _memory_index()
    idx["items"] = [e for e in idx.get("items", []) if e.get("id") != mem_id]
    _save_memory_index(idx)
    return True, None


def get_memory_context(agent=None):
    """Auto-context untuk agent: system/<agent>.md + company/* + system/shared.md (Fase B)."""
    blocks = []
    for cat in ("system", "company"):
        catdir = os.path.join(MEMORY_DIR, cat)
        if not os.path.isdir(catdir):
            continue
        for fn in sorted(os.listdir(catdir)):
            if not fn.endswith(".md"):
                continue
            base = fn[:-3]
            if cat == "system" and agent and base not in (agent, "shared"):
                continue
            with open(os.path.join(catdir, fn), "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            body = content
            if content.startswith("---"):
                parts = content.split("---", 2)
                if len(parts) >= 3:
                    body = parts[2].lstrip("\n")
            blocks.append({"id": f"{cat}/{base}", "content": body[:2000]})
    return {"agent": agent, "blocks": blocks}


def refresh_agent_contexts():
    """Memory B: generate/update system/<agent>.md dari fleet + org (identitas fresh)."""
    fleet = fetch_fleet() or {"agents": []}
    org = load_json(ORG_FILE, ORG_DEFAULT)
    agents_org = {a["id"]: a for a in org.get("agents", [])}
    fleet_map = {a["id"]: a for a in fleet.get("agents", [])}
    updated = []
    for aid in ("rena", "farrah", "nadine", "dinda", "aaron"):
        ao = agents_org.get(aid, {})
        fa = fleet_map.get(aid, {})
        role = ao.get("role") or ao.get("dept") or KPI_META.get(aid, {}).get("role", "-")
        status = fa.get("status", "offline")
        current = fa.get("currentTask") or "-"
        content = (
            "---\n"
            f"type: system\n"
            f"agent: {aid}\n"
            f"updated_at: {now_iso()}\n"
            "---\n"
            f"# {aid}\n"
            f"- Role: {role}\n"
            f"- Status fleet: {status}\n"
            f"- Task aktif: {current}\n"
            "\n"
            "## Aturan kerja\n"
            f"- {aid} bekerja sesuai role di MyOffice SAM Group.\n"
            "- Laporkan hasil kerja ringkas ke vault/board.\n"
            "- Baca memory ini di awal sesi; tulis ringkasan kerja di akhir sesi.\n"
        )
        os.makedirs(os.path.join(MEMORY_DIR, "system"), exist_ok=True)
        with open(os.path.join(MEMORY_DIR, "system", aid + ".md"), "w", encoding="utf-8") as f:
            f.write(content)
        # index
        idx = _memory_index()
        found = False
        for entry in idx.get("items", []):
            if entry.get("id") == "system/" + aid:
                entry.update({
                    "title": f"Identitas {aid}", "category": "system", "agent": aid,
                    "tags": ["system", "identity"], "updated_at": now_iso(),
                })
                found = True
                break
        if not found:
            idx["items"].append({
                "id": "system/" + aid, "title": f"Identitas {aid}", "category": "system",
                "agent": aid, "tags": ["system", "identity"], "content": "",
                "created_at": now_iso(), "updated_at": now_iso(),
            })
        with open(MEMORY_INDEX_FILE, "w", encoding="utf-8") as f:
            json.dump(idx, f, indent=2, ensure_ascii=False)
        updated.append(aid)
    return updated


def generate_daily_memory():
    """Memory B: ringkas activity log hari ini → memory/learnings/auto-<date>.md (dedupe)."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    target = f"learnings/auto-{today}"
    existing = get_memory(target)
    if existing[1] is None:
        return {"created": False, "reason": "sudah ada", "id": target}
    log_path = os.path.join(DATA_DIR, "activity_log.jsonl")
    entries = []
    if os.path.exists(log_path):
        with open(log_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                    if (e.get("ts") or "")[:10] == today:
                        entries.append(e)
                except Exception:
                    pass
    fleet = fetch_fleet() or {"agents": []}
    stats = get_board_stats()
    per = stats.get("per_agent", {})
    lines = [
        f"# Ringkasan Harian — {today} (auto)",
        "",
        "Dihasilkan otomatis oleh sistem (Memory B).",
        "",
        "## Activity",
        f"- Total entri activity log: {len(entries)}",
    ]
    for aid in ("rena", "farrah", "nadine", "dinda", "aaron"):
        fa = next((a for a in fleet.get("agents", []) if a["id"] == aid), {})
        bd = per.get(aid, {})
        lines.append(
            f"- **{aid}**: {fa.get('sessions', 0)} sesi, {fa.get('messages', 0)} pesan, "
            f"task done {bd.get('done', 0)}, open {bd.get('open', 0)}"
        )
    if entries:
        lines.append("")
        lines.append("## Aktivitas tercatat")
        for e in entries[:30]:
            detail = e.get("detail") or e.get("event") or ""
            lines.append(f"- [{e.get('agent', '?')}] {e.get('action', e.get('event', '?'))} {detail}".strip()[:160])
    content = "\n".join(lines)
    saved, err = save_memory({
        "id": "auto-" + today,  # tanpa kategori — save_memory menambahkan kategori otomatis
        "title": f"Ringkasan {today}",
        "category": "learnings",
        "agent": None,
        "tags": ["auto", "daily"],
        "content": content,
    })
    if err:
        return {"created": False, "error": err}
    return {"created": True, "id": target, "entries": len(entries)}


def run_memory_scheduler():
    """Memory B/C scheduler: tiap 30 menit refresh context; tiap hari generate ringkasan + dreaming (kalau belum ada)."""
    last_ctx = 0
    while True:
        try:
            now = time.time()
            if now - last_ctx >= 1800:  # 30 menit
                refresh_agent_contexts()
                last_ctx = now
            generate_daily_memory()
            run_dreaming()
        except Exception:
            pass
        time.sleep(600)  # cek tiap 10 menit


def run_dreaming():
    """Memory C: review board done + activity + fleet → tulis lesson konsolidasi (dedupe per hari)."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    target = f"learnings/dreaming-{today}"
    existing = get_memory(target)
    if existing[1] is None:
        return {"created": False, "reason": "sudah ada", "id": target}
    log_path = os.path.join(DATA_DIR, "activity_log.jsonl")
    entries = []
    if os.path.exists(log_path):
        with open(log_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                    if (e.get("ts") or "")[:10] == today:
                        entries.append(e)
                except Exception:
                    pass
    board = load_json(BOARD_FILE, BOARD_DEFAULT)
    done_today = [i for i in board.get("items", []) if i.get("status") == "done" and (i.get("updated_at") or "")[:10] == today]
    fleet = fetch_fleet() or {"agents": []}
    lines = [
        f"# Dreaming — {today} (auto)",
        "",
        "Refleksi otomatis: konsolidasi pelajaran dari kerja hari ini.",
        "",
        "## Task selesai",
    ]
    if done_today:
        for i in done_today[:10]:
            summ = f" — {i.get('summary', '')[:100]}" if i.get("summary") else ""
            lines.append(f"- **{i.get('title')}** ({i.get('agent') or 'pool'}){summ}")
    else:
        lines.append("- (tidak ada task selesai hari ini)")
    lines.append("")
    lines.append("## Insight fleet")
    for a in fleet.get("agents", [])[:5]:
        lines.append(f"- {a.get('id')}: {a.get('sessions', 0)} sesi / {a.get('messages', 0)} pesan / cost ${round(a.get('cost', 0), 2)}")
    action_counts = {}
    for e in entries:
        k = str(e.get("action") or e.get("event") or "?")
        action_counts[k] = action_counts.get(k, 0) + 1
    if action_counts:
        lines.append("")
        lines.append("## Pola aktivitas")
        for k, v in sorted(action_counts.items(), key=lambda x: -x[1])[:8]:
            lines.append(f"- `{k}`: {v}x")
    content = "\n".join(lines)
    saved, err = save_memory({
        "id": "dreaming-" + today,  # tanpa kategori
        "title": f"Dreaming {today}",
        "category": "learnings",
        "agent": None,
        "tags": ["auto", "dreaming"],
        "content": content,
    })
    if err:
        return {"created": False, "error": err}
    return {"created": True, "id": target, "tasks_done": len(done_today), "activity": len(entries)}


def audit_memory():
    """Memory C: audit — deteksi duplikasi, catatan besar, statistik per kategori."""
    idx = _memory_index()
    notes = idx.get("items", [])
    norm = {}
    for n in notes:
        key = re.sub(r"[^a-z0-9]+", "", (n.get("title") or "").lower())[:40]
        norm.setdefault(key, []).append(n.get("id"))
    dups = {k: v for k, v in norm.items() if len(v) > 1}
    large = []
    for n in notes:
        p, _ = _memory_path(n.get("id", ""))
        if os.path.isfile(p):
            sz = os.path.getsize(p)
            if sz > 10000:
                large.append({"id": n.get("id"), "bytes": sz})
    total_files = 0
    for root, _dirs, files in os.walk(MEMORY_DIR):
        total_files += sum(1 for f in files if f.endswith(".md"))
    return {
        "generated_at": now_iso(),
        "total_notes": len(notes),
        "total_files": total_files,
        "by_category": {c: sum(1 for n in notes if n.get("category") == c) for c in MEMORY_CATEGORIES},
        "duplicates": dups,
        "large_notes": large,
        "suggestion": "Merge duplikat via /brain (edit + hapus yang lama).",
    }


# ---------- memory D: semantic search (embedding lokal, zero-dependency) ----------

EMBED_DIM = 512


def _embed_text(text):
    """Embedding lokal berbasis hashing n-gram (unigram+bigram) → vektor ternormalisasi.
    Zero-dependency, jalan di semua instance (cocok whitelabel). Menangkap kesamaan
    kata/topik jauh lebih baik daripada keyword exact, tanpa butuh API eksternal."""
    vec = [0.0] * EMBED_DIM
    norm_text = re.sub(r"[^a-z0-9\s]", " ", str(text).lower())
    words = [w for w in norm_text.split() if w]
    tokens = list(words)
    for i in range(len(words) - 1):
        tokens.append(words[i] + "_" + words[i + 1])
    for tok in tokens:
        h = int(hashlib.md5(tok.encode("utf-8")).hexdigest(), 16)
        idx = h % EMBED_DIM
        sign = 1.0 if ((h >> 8) % 2 == 0) else -1.0
        vec[idx] += sign
    norm = math.sqrt(sum(v * v for v in vec))
    if norm > 0:
        vec = [v / norm for v in vec]
    return vec


def _cosine(a, b):
    return sum(x * y for x, y in zip(a, b))


def semantic_search_memory(query, limit=8, category=None):
    """Semantic search: cari memory berdasarkan makna (cosine similarity embedding)."""
    if not query or not str(query).strip():
        return []
    qvec = _embed_text(query)
    idx = _memory_index()
    results = []
    for n in idx.get("items", []):
        if category and n.get("category") != category:
            continue
        text = (n.get("title") or "") + " " + (n.get("content") or "")[:2000]
        vec = _embed_text(text)
        sim = _cosine(qvec, vec)
        if sim <= 0:
            continue
        results.append({
            "id": n.get("id"),
            "title": n.get("title"),
            "category": n.get("category"),
            "score": round(sim, 4),
            "snippet": (n.get("content") or "")[:160],
        })
    results.sort(key=lambda r: -r["score"])
    return results[:limit]


# ---------- auto RAG context (fitur #6: suntik konteks otomatis) ----------

def build_agent_context(agent):
    """Bangun context RAG otomatis: system/<agent>.md + company/* + semantic top-k dari task aktif.
    Ditulis ke vault/contexts/<agent>.md — bisa dibaca agent & di-inject saat mulai kerja."""
    blocks = get_memory_context(agent)["blocks"]
    try:
        fleet = fetch_fleet() or {"agents": []}
        for a in fleet.get("agents", []):
            if a.get("id") == agent and a.get("currentTask"):
                for r in semantic_search_memory(str(a["currentTask"])[:200], limit=3):
                    blocks.append({"id": r["id"], "content": r["snippet"], "score": r["score"]})
    except Exception:
        pass
    try:
        ctx_dir = os.path.join(VAULT_ROOT, "contexts")
        os.makedirs(ctx_dir, exist_ok=True)
        txt = "\n\n".join(f"### {b.get('id')}\n{b.get('content', '')}" for b in blocks)
        with open(os.path.join(ctx_dir, agent + ".md"), "w", encoding="utf-8") as f:
            f.write(f"# Auto Context — {agent}\n\n{txt}\n")
    except Exception:
        pass
    return {"agent": agent, "blocks": len(blocks), "file": f"contexts/{agent}.md"}


def run_context_scheduler():
    while True:
        try:
            for ag in ("rena", "farrah", "nadine", "dinda", "aaron"):
                build_agent_context(ag)
        except Exception:
            pass
        time.sleep(600)  # tiap 10 menit


# ---------- playbook automation (fitur #7: rules umum) ----------

PLAYBOOK_FILE = os.path.join(DATA_DIR, "playbook.json")
PLAYBOOK_DEFAULT = {"rules": []}
PLAYBOOK_TRIGGERS = ("spend_pct", "agent_error_count", "schedule", "approval_pending", "incident_open")


def list_playbook():
    return load_json(PLAYBOOK_FILE, PLAYBOOK_DEFAULT)


def save_playbook_rule(payload, actor_role):
    if actor_role != "admin":
        return None, "hanya admin"
    name = str(payload.get("name") or "").strip()[:80]
    trigger = payload.get("trigger") or {}
    action = payload.get("action") or {}
    if not name:
        return None, "nama rule wajib"
    if trigger.get("type") not in PLAYBOOK_TRIGGERS:
        return None, "trigger harus spend_pct/agent_error_count/schedule/approval_pending/incident_open"
    if action.get("type") not in ("telegram", "pause", "report", "webhook"):
        return None, "action harus telegram/pause/report/webhook"
    data = list_playbook()
    rule = {"id": "pb_" + hashlib.md5((name + str(time.time())).encode()).hexdigest()[:8],
            "name": name, "enabled": bool(payload.get("enabled", True)),
            "trigger": trigger, "action": action, "created_at": now_iso()}
    data["rules"].append(rule)
    save_json(PLAYBOOK_FILE, data)
    return rule, None


def delete_playbook_rule(rule_id, actor_role):
    if actor_role != "admin":
        return None, "hanya admin"
    data = list_playbook()
    before = len(data["rules"])
    data["rules"] = [r for r in data["rules"] if r["id"] != rule_id]
    if len(data["rules"]) == before:
        return None, "rule tidak ditemukan"
    save_json(PLAYBOOK_FILE, data)
    return {"deleted": rule_id}, None


def _check_rule(rule):
    trig = rule.get("trigger", {})
    ttype = trig.get("type", "")
    try:
        if ttype == "spend_pct":
            gte = float(trig.get("gte", 80))
            hit = [r for r in get_payroll().get("rows", []) if r.get("pct", 0) >= gte]
            if hit:
                return f"Spend ≥{gte}%: " + ", ".join(f"{r.get('id')} {r.get('pct')}%" for r in hit)
        elif ttype == "agent_error_count":
            gte = int(trig.get("gte", 2))
            hit = [r for r in get_health().get("rows", []) if r.get("status") != "online"]
            if len(hit) >= gte:
                return f"Agent tidak sehat ≥{gte}: " + ", ".join(str(r.get("id")) for r in hit)
        elif ttype == "schedule":
            cron = str(trig.get("cron", "")).split()
            if len(cron) == 5:
                try:
                    hh, mm = cron[0].split(":")
                    dow = int(cron[4])
                    now = datetime.now(timezone.utc) + timedelta(hours=7)
                    if now.hour == int(hh) and now.minute == int(mm) and now.weekday() == dow - 1:
                        return "jadwal tercapai"
                except Exception:
                    pass
        elif ttype == "approval_pending":
            try:
                pend = [i for i in list_approvals() if i.get("status") == "pending"]
                gte = int(trig.get("gte", 3))
                if len(pend) >= gte:
                    return f"{len(pend)} approval menunggu (≥{gte})"
            except Exception:
                pass
        elif ttype == "incident_open":
            try:
                inc = load_json(INCIDENT_FILE, INCIDENT_DEFAULT).get("items", [])
                open_inc = [i for i in inc if i.get("status") in ("open", "escalated")]
                gte = int(trig.get("gte", 1))
                if len(open_inc) >= gte:
                    return f"{len(open_inc)} incident open (≥{gte})"
            except Exception:
                pass
    except Exception:
        return None
    return None


def run_playbook():
    """Jalankan rules playbook — dedupe 1x/hari per rule."""
    rules = load_json(PLAYBOOK_FILE, PLAYBOOK_DEFAULT).get("rules", [])
    if not rules:
        return
    st = load_json(os.path.join(DATA_DIR, "playbook_state.json"), {})
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for r in rules:
        if not r.get("enabled", True):
            continue
        rid = r["id"]
        msg = _check_rule(r)
        if not msg:
            continue
        if st.get(rid) == today:
            continue
        st[rid] = today
        action = r.get("action", {})
        atype = action.get("type", "telegram")
        try:
            if atype == "telegram":
                push_telegram(f"📋 <b>Playbook: {r.get('name')}</b>\n{msg}")
            elif atype == "pause" and action.get("agent"):
                set_agent_pause(action["agent"], True, action.get("reason", "playbook"), "playbook")
                push_telegram(f"⏸ <b>Playbook: {r.get('name')}</b>\nPause {action['agent']}: {msg}")
            elif atype == "report":
                res, err = generate_report(action.get("kind", "kpi"), 7)
                if res:
                    push_telegram(f"📄 <b>Playbook: {r.get('name')}</b>\nLaporan dibuat: {res['file']}")
            elif atype == "webhook" and action.get("url"):
                try:
                    req = urllib.request.Request(
                        action["url"],
                        data=json.dumps({"rule": r.get("name"), "message": msg, "trigger": trig}).encode(),
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        resp.read(1024)
                except Exception as e:
                    push_telegram(f"⚠️ <b>Playbook webhook gagal</b>: {r.get('name')} — {e}")
        except Exception:
            pass
    save_json(os.path.join(DATA_DIR, "playbook_state.json"), st)


def run_playbook_scheduler():
    while True:
        try:
            run_playbook()
        except Exception:
            pass
        time.sleep(300)  # tiap 5 menit


# ---------- incident & escalation (fitur #8) ----------

INCIDENT_FILE = os.path.join(DATA_DIR, "incidents.json")
INCIDENT_DEFAULT = {"items": []}


def list_incidents():
    data = load_json(INCIDENT_FILE, INCIDENT_DEFAULT)
    items = sorted(data.get("items", []), key=lambda i: i.get("created_at", ""), reverse=True)
    return {"items": items[:100], "open": sum(1 for i in items if i.get("status") == "open")}


def resolve_incident(inc_id, actor_role, note=None):
    if actor_role not in ("admin", "manager"):
        return None, "hanya admin/manager"
    data = load_json(INCIDENT_FILE, INCIDENT_DEFAULT)
    for i in data.get("items", []):
        if i["id"] == inc_id:
            i["status"] = "resolved"
            i["resolved_at"] = now_iso()
            i["resolved_by"] = note or "unknown"
            save_json(INCIDENT_FILE, data)
            return {"id": inc_id, "status": "resolved"}, None
    return None, "incident tidak ditemukan"


def check_incidents():
    """Deteksi incident (agent offline/degraded) + eskalasi otomatis (critical > 15 menit)."""
    now = datetime.now(timezone.utc)
    data = load_json(INCIDENT_FILE, INCIDENT_DEFAULT)
    items = data.get("items", [])
    fleet = fetch_fleet() or {"agents": []}
    new_ids = []
    for a in fleet.get("agents", []):
        st = a.get("status")
        if st in ("offline", "degraded"):
            sev = "critical" if st == "offline" else "warning"
            key = f"{a['id']}-{st}"
            if not any(i.get("key") == key and i.get("status") in ("open", "escalated") for i in items):
                items.append({"id": "inc_" + hashlib.md5(key.encode()).hexdigest()[:8], "key": key,
                              "agent": a["id"], "severity": sev, "message": f"Agent {a['id']} {st}",
                              "status": "open", "created_at": now.isoformat(), "escalated": False})
                new_ids.append(a["id"])
    # eskalasi otomatis
    for i in items:
        if i.get("status") == "open" and i.get("severity") == "critical" and not i.get("escalated"):
            try:
                created = datetime.fromisoformat(i["created_at"])
                if (now - created).total_seconds() > 900:
                    i["status"] = "escalated"
                    i["escalated"] = True
                    try:
                        push_telegram(f"🚨 <b>INCIDENT ESKALASI</b>: {i.get('message')} — belum resolve 15 menit")
                    except Exception:
                        pass
            except Exception:
                pass
    save_json(INCIDENT_FILE, data)
    # notif incident baru (dedupe via notify_state)
    if new_ids:
        st = load_json(os.path.join(DATA_DIR, "notify_state.json"), {})
        fresh = []
        for aid in new_ids:
            k = "incident_" + aid
            if st.get(k, 0) < time.time() - 600:
                st[k] = time.time()
                fresh.append(aid)
        save_json(os.path.join(DATA_DIR, "notify_state.json"), st)
        if fresh:
            try:
                push_telegram("🚨 <b>INCIDENT</b>: " + ", ".join(f"{x} tidak sehat" for x in fresh))
            except Exception:
                pass
    return {"open": sum(1 for i in items if i.get("status") in ("open", "escalated"))}


def run_incident_scheduler():
    while True:
        try:
            check_incidents()
        except Exception:
            pass
        time.sleep(300)  # tiap 5 menit


def _client_ip(headers, sock_addr):
    """IP asal request: X-Forwarded-For (nginx) → client socket."""
    xff = headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    ip = sock_addr[0] if sock_addr else ""
    return ip or ""


def evaluate_geofence(payload, client_ip):
    """Cek geofence untuk aksi berisiko. Return None = boleh, string = alasan blokir (pending manual)."""
    gf = get_geofence()
    if not gf.get("enabled"):
        return None
    risk = payload.get("risk", "medium")
    atype = payload.get("type", "other")
    risky = risk in ("high", "critical") or atype in (
        "deploy", "install", "secret_access", "spending", "external_contact"
    )
    if not risky:
        return None
    # jam WIB (UTC+7)
    try:
        hour = (datetime.now(timezone.utc) + timedelta(hours=7)).hour
        hrs = (gf.get("allowed_hours") or "00-23").split("-")
        lo, hi = int(hrs[0]), int(hrs[1])
        if not (lo <= hour < hi):
            return f"geofence: di luar jam izin ({gf.get('allowed_hours')}) WIB — wajib approval manual"
    except Exception:
        pass
    # IP izin (hanya relevan kalau daftar tidak kosong)
    allowed = gf.get("allowed_ips") or []
    if allowed and client_ip and client_ip not in allowed and client_ip != "127.0.0.1":
        return f"geofence: IP {client_ip} tidak terdaftar — wajib approval manual"
    return None


def evaluate_approval(payload):
    """Terapkan policy: kembalikan (status, note)."""
    policy = get_policy()
    risk = payload.get("risk", "medium")
    atype = payload.get("type", "other")
    spend = float(payload.get("amount_usd") or payload.get("detail", "").replace("$", "").replace(",", "") or 0) \
        if payload.get("type") == "spending" else 0

    if risk in policy.get("require_approval_risks", []):
        return "pending", f"Risiko {risk} — wajib approval"
    if atype in policy.get("require_approval_types", []):
        if atype == "spending" and spend <= policy.get("spend_threshold_usd", 50):
            return "approved", f"Spending ${spend} di bawah threshold ${policy.get('spend_threshold_usd')} — auto-approve"
        return "pending", f"Tipe {atype} — wajib approval"
    if risk in policy.get("auto_approve_risks", []) and atype in policy.get("auto_approve_types", []):
        return "approved", "Read-only / risiko low — auto-approve (policy)"
    return "pending", "Perlu review manual"


def get_status_machine():
    """Status live per agent: offline | paused | waiting_approval | processing | idle."""
    fleet = fetch_fleet() or {"agents": []}
    approvals = list_approvals("pending").get("items", [])
    pending_by_agent = {}
    for a in approvals:
        pending_by_agent.setdefault(a.get("agent"), 0)
        pending_by_agent[a.get("agent")] += 1
    rows = []
    for agent in fleet.get("agents", []):
        aid = agent["id"]
        live = agent.get("status", "offline")
        paused, _ = is_agent_paused(aid)
        if live == "offline":
            state = "offline"
        elif paused:
            state = "paused"
        elif pending_by_agent.get(aid, 0) > 0:
            state = "waiting_approval"
        elif agent.get("currentTask"):
            state = "processing"
        else:
            state = "idle"
        rows.append({
            "id": aid,
            "name": agent.get("name", aid),
            "state": state,
            "live": live,
            "paused": paused,
            "pending_approvals": pending_by_agent.get(aid, 0),
            "currentTask": agent.get("currentTask"),
            "server": agent.get("server", "-"),
        })
    return {
        "generated_at": now_iso(),
        "rows": rows,
        "summary": {
            "offline": sum(1 for r in rows if r["state"] == "offline"),
            "paused": sum(1 for r in rows if r["state"] == "paused"),
            "waiting_approval": sum(1 for r in rows if r["state"] == "waiting_approval"),
            "processing": sum(1 for r in rows if r["state"] == "processing"),
            "idle": sum(1 for r in rows if r["state"] == "idle"),
        },
    }


def get_timeline(hours=48):
    """Replay riwayat kerja dari activity_log."""
    cutoff = time.time() - hours * 3600
    events = []
    if os.path.exists(ACTIVITY_LOG):
        with open(ACTIVITY_LOG, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                    if rec.get("ts", 0) >= cutoff:
                        events.append(rec)
                except Exception:
                    continue
    events.sort(key=lambda e: e.get("ts", 0), reverse=True)
    for e in events:
        e["ts_iso"] = datetime.fromtimestamp(e["ts"], tz=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    return {"hours": hours, "events": events, "count": len(events)}


def update_quality(payload):
    """Simpan quality/autonomy/tasks_completed per agent ke kpi_manual.json."""
    data = load_json(KPI_MANUAL_FILE, KPI_MANUAL_DEFAULT)
    agent = payload.get("agent", "")
    if not agent:
        return None, "agent required"
    scores = data.setdefault("scores", {})
    entry = scores.setdefault(agent, {})
    for key in ("quality", "autonomy", "tasks_completed"):
        if key in payload and payload[key] is not None:
            entry[key] = payload[key]
    data["scores"] = scores
    save_json(KPI_MANUAL_FILE, data)
    return entry, None


# ---------- HTTP handler ----------

def send_json(handler, code, obj):
    body = json.dumps(obj).encode()
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", CORS_ORIGIN)
    handler.end_headers()
    handler.wfile.write(body)


def read_body(handler, max_body=2 * 1024 * 1024):
    """Baca JSON body dengan limit ukuran (anti DoS memory)."""
    length = int(handler.headers.get("Content-Length") or 0)
    if length <= 0:
        return {}
    if length > max_body:
        handler.connection.close()
        return {}
    raw = handler.rfile.read(length)
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return {}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # senyap

    def _route(self, method):
        path = self.path.split("?")[0].rstrip("/")
        token = _office_token()
        if token:
            provided = self.headers.get("X-Office-Token", "")
            if provided != token:
                return send_json(self, 401, {"ok": False, "error": "Unauthorized"})
        try:
            # --- approvals ---
            if path == "/office/fleet" and method == "GET":
                return send_json(self, 200, fetch_fleet() or {"agents": [], "updated": None})
            if path == "/office/approvals" and method == "GET":
                return send_json(self, 200, list_approvals())
            if path == "/office/approvals" and method == "POST":
                if not _role_ok(_auth_role_from_headers(self.headers, self.client_address), ("admin", "manager")):
                    return send_json(self, 403, {"ok": False, "error": "role tidak diizinkan"})
                item = submit_approval(read_body(self), _client_ip(self.headers, self.client_address))
                return send_json(self, 201, {"ok": True, "item": item})
            # --- geofence (Tahap 3) ---
            if path == "/office/geofence" and method == "GET":
                return send_json(self, 200, get_geofence())
            if path == "/office/geofence" and method == "POST":
                return send_json(self, 200, {"ok": True, "geofence": save_geofence(read_body(self))})
            # --- draft/publish + rollback (Tahap 4) ---
            if path == "/office/versions" and method == "GET":
                qs = self.path.split("?", 1)[1] if "?" in self.path else ""
                resource = ""
                for kv in qs.split("&"):
                    if kv.startswith("resource="):
                        resource = kv.split("=", 1)[1]
                return send_json(self, 200, {"ok": True, "resource": resource, "versions": list_versions(resource)})
            if path == "/office/rollback" and method == "POST":
                body = read_body(self)
                data, err = rollback_resource(body.get("resource", ""), body.get("version", ""))
                if err:
                    return send_json(self, 400, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True, "resource": body.get("resource"), "data": data})
            # --- vault + artifacts versioning (Tahap 5) ---
            if path == "/office/vault" and method == "GET":
                qs = urllib.parse.parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
                action = (qs.get("action") or [""])[0]
                rel = (qs.get("path") or [""])[0]
                if action == "read":
                    return send_json(self, 200, vault_read(rel))
                if action == "versions":
                    return send_json(self, 200, {"ok": True, "versions": vault_versions(rel)})
                return send_json(self, 200, {"ok": True, "files": vault_list()})
            if path == "/office/vault" and method == "POST":
                qs = urllib.parse.parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
                action = (qs.get("action") or [""])[0]
                rel = (qs.get("path") or [""])[0]
                body = read_body(self)
                if action == "save":
                    return send_json(self, 200, vault_save(rel, body.get("content", "")))
                if action == "restore":
                    return send_json(self, 200, vault_restore(rel, body.get("version", "")))
                return send_json(self, 400, {"ok": False, "error": "aksi tidak dikenal"})
            m = re.match(r"^/office/approvals/([^/]+)/decision$", path)
            if m and method == "POST":
                if not _role_ok(_auth_role_from_headers(self.headers, self.client_address), ("admin", "manager")):
                    return send_json(self, 403, {"ok": False, "error": "hanya admin/manager yang bisa memutuskan approval"})
                body = read_body(self)
                decision = body.get("decision")
                if decision not in ("approved", "rejected"):
                    return send_json(self, 400, {"ok": False, "error": "decision must be approved|rejected"})
                item, err = decide_approval(m.group(1), decision, body.get("note"), body.get("decided_by", "samian"))
                if err:
                    return send_json(self, 404 if err == "not found" else 409, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True, "item": item})
            # --- org ---
            if path == "/office/org" and method == "GET":
                return send_json(self, 200, get_org())
            if path == "/office/org" and method == "POST":
                return send_json(self, 200, {"ok": True, "org": update_org(read_body(self))})
            # --- handoffs ---
            if path == "/office/handoffs" and method == "GET":
                status = self.path.split("?")[1].split("=")[1] if "?status=" in self.path else None
                return send_json(self, 200, list_handoffs(status))
            if path == "/office/handoffs" and method == "POST":
                item = submit_handoff(read_body(self))
                return send_json(self, 201, {"ok": True, "item": item})
            m = re.match(r"^/office/handoffs/([^/]+)/done$", path)
            if m and method == "POST":
                item, err = complete_handoff(m.group(1))
                if err:
                    return send_json(self, 404 if err == "not found" else 409, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True, "item": item})
            # --- kpi ---
            if path == "/office/kpi" and method == "GET":
                return send_json(self, 200, get_kpi())
            # --- health ---
            if path == "/office/health" and method == "GET":
                return send_json(self, 200, get_health())
            # --- standup ---
            if path == "/office/standup" and method == "GET":
                return send_json(self, 200, get_standup())
            # --- employees ---
            if path == "/office/employees" and method == "GET":
                return send_json(self, 200, get_employees())
            # --- controls (kill-switch / pause) ---
            if path == "/office/controls" and method == "GET":
                return send_json(self, 200, get_controls())
            if path == "/office/controls/agent" and method == "POST":
                if not _role_ok(_auth_role_from_headers(self.headers, self.client_address), ("admin",)):
                    return send_json(self, 403, {"ok": False, "error": "hanya admin"})
                body = read_body(self)
                data = set_agent_pause(body.get("agent", ""), bool(body.get("paused")), body.get("reason"), body.get("by", "samian"))
                return send_json(self, 200, {"ok": True, "controls": data})
            if path == "/office/controls/global" and method == "POST":
                body = read_body(self)
                data = set_global_pause(bool(body.get("paused")), body.get("reason"), body.get("by", "samian"))
                return send_json(self, 200, {"ok": True, "controls": data})
            # --- reviews (1:1) ---
            if path == "/office/reviews" and method == "GET":
                agent = self.path.split("?")[1].split("=")[1] if "?agent=" in self.path else None
                return send_json(self, 200, list_reviews(agent))
            if path == "/office/reviews" and method == "POST":
                item = submit_review(read_body(self))
                return send_json(self, 201, {"ok": True, "item": item})
            # --- onboarding ---
            if path == "/office/onboarding" and method == "GET":
                return send_json(self, 200, get_onboarding())
            if path == "/office/onboarding/draft" and method == "POST":
                draft = add_draft_agent(read_body(self))
                return send_json(self, 201, {"ok": True, "draft": draft})
            m = re.match(r"^/office/onboarding/draft/([^/]+)/hire$", path)
            if m and method == "POST":
                draft, err = hire_agent(m.group(1), read_body(self).get("by", "samian"))
                if err:
                    return send_json(self, 404 if err == "not found" else 409, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True, "draft": draft})
            m = re.match(r"^/office/onboarding/draft/([^/]+)$", path)
            if m and method == "DELETE":
                _, err = remove_draft(m.group(1))
                if err:
                    return send_json(self, 404, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True})
            # --- vacation / cuti ---
            if path == "/office/vacation" and method == "GET":
                status = self.path.split("?")[1].split("=")[1] if "?status=" in self.path else None
                return send_json(self, 200, list_vacation(status))
            if path == "/office/vacation" and method == "POST":
                item, err = submit_vacation(read_body(self))
                if err:
                    return send_json(self, 400, {"ok": False, "error": err})
                return send_json(self, 201, {"ok": True, "item": item})
            m = re.match(r"^/office/vacation/([^/]+)/end$", path)
            if m and method == "POST":
                item, err = end_vacation(m.group(1))
                if err:
                    return send_json(self, 404 if err == "not found" else 409, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True, "item": item})
            # --- shift & jam kerja ---
            if path == "/office/shift" and method == "GET":
                return send_json(self, 200, get_shift())
            if path == "/office/shift/config" and method == "GET":
                return send_json(self, 200, {"ok": True, "config": get_shift_config()})
            if path == "/office/shift/config" and method == "POST":
                if not _role_ok(_auth_role_from_headers(self.headers, self.client_address), ("admin",)):
                    return send_json(self, 403, {"ok": False, "error": "hanya admin"})
                body = read_body(self)
                cfg = get_shift_config()
                for k in ("work_start", "work_end", "tz_offset_hours", "overtime_alert_hours"):
                    if k in body:
                        cfg[k] = body[k]
                save_json(SHIFT_FILE, cfg)
                return send_json(self, 200, {"ok": True, "config": cfg})
            # --- timesheet token per agent (Tahap 6) ---
            if path == "/office/timesheet" and method == "GET":
                return send_json(self, 200, get_timesheet())
            # --- Fase 5: status machine ---
            if path == "/office/status" and method == "GET":
                return send_json(self, 200, get_status_machine())
            # --- Fase 5: timeline replay ---
            if path == "/office/timeline" and method == "GET":
                hours = 48
                if "?hours=" in self.path:
                    try:
                        hours = int(self.path.split("?hours=")[1])
                    except Exception:
                        pass
                return send_json(self, 200, get_timeline(hours))
            # --- Fase 5: policy ---
            if path == "/office/policy" and method == "GET":
                return send_json(self, 200, get_policy())
            # --- Fase 5: caps ---
            if path == "/office/caps" and method == "GET":
                return send_json(self, 200, get_caps())
            if path == "/office/caps" and method == "POST":
                body = read_body(self)
                caps = load_json(CAPS_FILE, CAPS_DEFAULT)
                if "auto_pause" in body:
                    caps["auto_pause"] = bool(body["auto_pause"])
                if "global_budget_usd" in body:
                    caps["global_budget_usd"] = float(body["global_budget_usd"])
                if "agent_caps" in body and isinstance(body["agent_caps"], dict):
                    caps["agent_caps"].update(body["agent_caps"])
                save_versioned("caps", caps)
                return send_json(self, 200, {"ok": True, "caps": caps})
            # --- Fase 5: quality input ---
            if path == "/office/quality" and method == "POST":
                entry, err = update_quality(read_body(self))
                if err:
                    return send_json(self, 400, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True, "score": entry})
            # --- payroll ---
            if path == "/office/payroll" and method == "GET":
                if not _role_ok(_auth_role_from_headers(self.headers, self.client_address), ("admin", "manager")):
                    return send_json(self, 403, {"ok": False, "error": "hanya admin/manager yang bisa melihat payroll"})
                return send_json(self, 200, get_payroll())
            if path == "/office/health" and method == "GET":
                return send_json(self, 200, {"ok": True, "service": "office-backend", "time": now_iso()})
            # --- branding / whitelabel (W1) ---
            if path == "/office/branding" and method == "GET":
                return send_json(self, 200, {"ok": True, "branding": get_branding()})
            if path == "/office/branding" and method == "POST":
                return send_json(self, 200, {"ok": True, "branding": save_branding(read_body(self))})
            # --- kanban board (fitur jualan) ---
            if path == "/office/board/config" and method == "GET":
                return send_json(self, 200, {"ok": True, "config": {"type_agent": _board_type_agent_map()}})
            if path == "/office/board/config" and method == "POST":
                if not _role_ok(_auth_role_from_headers(self.headers, self.client_address), ("admin",)):
                    return send_json(self, 403, {"ok": False, "error": "hanya admin"})
                body = read_body(self)
                data = load_json(BOARD_CONFIG_FILE, {})
                if isinstance(body.get("type_agent"), dict):
                    data["type_agent"] = {str(k).strip()[:30]: str(v).strip()[:30] for k, v in body["type_agent"].items() if v}
                save_json(BOARD_CONFIG_FILE, data)
                return send_json(self, 200, {"ok": True, "config": data})
            if path == "/office/board" and method == "GET":
                qs = urllib.parse.parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
                action = (qs.get("action") or [""])[0]
                if action == "stats":
                    return send_json(self, 200, {"ok": True, "stats": get_board_stats()})
                if action == "rules":
                    return send_json(self, 200, {"ok": True, "rules": list_board_rules()})
                if action == "templates":
                    return send_json(self, 200, {"ok": True, "templates": list_board_templates()})
                status = (qs.get("status") or [None])[0]
                agent = (qs.get("agent") or [None])[0]
                priority = (qs.get("priority") or [None])[0]
                return send_json(self, 200, {"ok": True, **list_board(status, agent, priority)})
            # --- kanban D: automation rules ---
            if path == "/office/board/rules" and method == "GET":
                return send_json(self, 200, {"ok": True, "rules": list_board_rules()})
            if path == "/office/board/rules" and method == "POST":
                if (urllib.parse.parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}).get("action") == ["check"]:
                    return send_json(self, 200, {"ok": True, "created": check_board_rules()})
                rule, err = save_board_rule(read_body(self))
                if err:
                    return send_json(self, 400, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True, "rule": rule})
            m = re.match(r"^/office/board/rules/([^/]+)$", path)
            if m and method == "DELETE":
                ok, err = delete_board_rule(m.group(1))
                if not ok:
                    return send_json(self, 404, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True})
            # --- kanban D: templates ---
            if path == "/office/board/templates" and method == "GET":
                return send_json(self, 200, {"ok": True, "templates": list_board_templates()})
            if path == "/office/board/templates" and method == "POST":
                tpl, err = save_board_template(read_body(self))
                if err:
                    return send_json(self, 400, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True, "template": tpl})
            m = re.match(r"^/office/board/templates/([^/]+)/apply$", path)
            if m and method == "POST":
                item, err = apply_board_template(m.group(1))
                if err:
                    return send_json(self, 404 if err == "not found" else 400, {"ok": False, "error": err})
                return send_json(self, 201, {"ok": True, "item": item})
            m = re.match(r"^/office/board/templates/([^/]+)$", path)
            if m and method == "DELETE":
                ok, err = delete_board_template(m.group(1))
                if not ok:
                    return send_json(self, 404, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True})
            if path == "/office/board" and method == "POST":
                item, err = create_board_item(read_body(self))
                if err:
                    return send_json(self, 400, {"ok": False, "error": err})
                return send_json(self, 201, {"ok": True, "item": item})
            m = re.match(r"^/office/board/([^/]+)/move$", path)
            if m and method == "POST":
                body = read_body(self)
                item, err = move_board_item(m.group(1), body.get("to", ""), body.get("note"), body.get("by", "samian"), _client_ip(self.headers, self.client_address), body.get("delegator"))
                if err:
                    return send_json(self, 404 if err == "not found" else 400, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True, "item": item})
            m = re.match(r"^/office/board/([^/]+)$", path)
            if m and method == "GET":
                item, err = get_board_item(m.group(1))
                if err:
                    return send_json(self, 404, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True, "item": item})
            if m and method == "DELETE":
                ok, err = delete_board_item(m.group(1))
                if not ok:
                    return send_json(self, 404, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True})
            # --- memory / knowledge base (fitur jualan) ---
            if path == "/office/memory" and method == "GET":
                qs = urllib.parse.parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
                category = (qs.get("category") or [None])[0]
                q = (qs.get("q") or [None])[0]
                agent = (qs.get("agent") or [None])[0]
                if (qs.get("action") or [""])[0] == "context":
                    return send_json(self, 200, {"ok": True, **get_memory_context(agent)})
                if (qs.get("action") or [""])[0] == "audit":
                    return send_json(self, 200, {"ok": True, "audit": audit_memory()})
                if (qs.get("action") or [""])[0] == "semantic":
                    q = (qs.get("q") or [""])[0]
                    cat = (qs.get("category") or [None])[0]
                    lim = int((qs.get("limit") or ["8"])[0])
                    return send_json(self, 200, {"ok": True, "semantic": semantic_search_memory(q, lim, cat)})
                if (qs.get("action") or [""])[0] == "read":
                    rel = (qs.get("path") or [""])[0]
                    item, err = get_memory(rel)
                    if err:
                        return send_json(self, 404, {"ok": False, "error": err})
                    return send_json(self, 200, {"ok": True, "item": item})
                return send_json(self, 200, {"ok": True, **list_memory(category, q, agent)})
            if path == "/office/memory" and method == "POST":
                item, err = save_memory(read_body(self))
                if err:
                    return send_json(self, 400, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True, "item": item})
            if path == "/office/memory/refresh-contexts" and method == "POST":
                updated = refresh_agent_contexts()
                return send_json(self, 200, {"ok": True, "updated": updated})
            if path == "/office/memory/daily" and method == "POST":
                return send_json(self, 200, {"ok": True, **generate_daily_memory()})
            if path == "/office/memory/dreaming" and method == "POST":
                return send_json(self, 200, {"ok": True, **run_dreaming()})
            if path == "/office/memory/context/refresh" and method == "POST":
                updated = []
                for ag in ("rena", "farrah", "nadine", "dinda", "aaron"):
                    updated.append(build_agent_context(ag))
                return send_json(self, 200, {"ok": True, "updated": updated})
            if path == "/office/memory/audit" and method == "GET":
                return send_json(self, 200, {"ok": True, "audit": audit_memory()})
            m = re.match(r"^/office/memory/([^/]+/[^/]+)$", path)
            if m and method == "GET":
                item, err = get_memory(m.group(1))
                if err:
                    return send_json(self, 404, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True, "item": item})
            if m and method == "DELETE":
                ok, err = delete_memory(m.group(1))
                if not ok:
                    return send_json(self, 404, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True})
            if path == "/office/tickets/stats" and method == "GET":
                return send_json(self, 200, ticket_stats())
            if path == "/office/tickets/queue" and method == "GET":
                return send_json(self, 200, ticket_queue())
            if path == "/office/tickets/inbox" and method == "GET":
                qs = urllib.parse.parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
                return send_json(self, 200, agent_inbox((qs.get("agent") or ["samian"])[0]))
            if path == "/office/tickets" and method == "GET":
                qs = urllib.parse.parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
                st = (qs.get("status") or [None])[0]
                ag = (qs.get("agent") or [None])[0]
                pr = (qs.get("priority") or [None])[0]
                try:
                    limit = int((qs.get("limit") or [""])[0]) or None
                except Exception:
                    limit = None
                try:
                    offset = int((qs.get("offset") or ["0"])[0])
                except Exception:
                    offset = 0
                return send_json(self, 200, list_tickets(st, ag, pr, limit, offset))
            if path == "/office/tickets" and method == "POST":
                try:
                    item = create_ticket(read_body(self))
                    return send_json(self, 201, {"ok": True, "item": item})
                except ValueError as e:
                    return send_json(self, 400, {"ok": False, "error": str(e)})
            m = re.match(r"^/office/tickets/([^/]+)/action$", path)
            if m and method == "POST":
                body = read_body(self)
                item, err = ticket_action(m.group(1), body.get("action", ""), body)
                if err:
                    return send_json(self, 400, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True, "item": item})
            # --- Fase 5: status machine (route utama di atas) ---
            # --- komunikasi agent (FASE 2) ---
            if path == "/office/messages" and method == "POST":
                msg, err = send_message(read_body(self))
                if err:
                    return send_json(self, 400, {"ok": False, "error": err})
                return send_json(self, 201, {"ok": True, "message": msg})
            if path == "/office/messages" and method == "GET":
                qs = urllib.parse.parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
                agent = (qs.get("agent") or [""])[0]
                return send_json(self, 200, {"ok": True, "items": list_messages(agent or None)})
            if path == "/office/broadcast" and method == "POST":
                if not _role_ok(_auth_role_from_headers(self.headers, self.client_address), ("admin", "manager")):
                    return send_json(self, 403, {"ok": False, "error": "hanya admin/manager"})
                b, err = broadcast_message(read_body(self))
                if err:
                    return send_json(self, 400, {"ok": False, "error": err})
                return send_json(self, 201, {"ok": True, "broadcast": b})
            if path == "/office/broadcast" and method == "GET":
                return send_json(self, 200, {"ok": True, "items": list_broadcasts()})
            if path == "/office/notifications" and method == "GET":
                qs = urllib.parse.parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
                return send_json(self, 200, {"ok": True, "items": get_notifications(int((qs.get("limit") or ["20"])[0]))})
            if path == "/office/inbox" and method == "GET":
                qs = urllib.parse.parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
                agent = (qs.get("agent") or ["samian"])[0]
                inbox = agent_inbox(agent)
                # gabung: pesan + broadcast dari arsip (dari inbox file)
                return send_json(self, 200, {"ok": True, "agent": agent, "items": inbox.get("items", [])})
            # --- F3: AI assistant, trace, ledger, review ---
            if path == "/office/ask" and method == "GET":
                qs = urllib.parse.parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
                q = (qs.get("q") or [""])[0]
                return send_json(self, 200, {"ok": True, "answer": ask_myoffice(q)})
            if path == "/office/trace" and method == "GET":
                qs = urllib.parse.parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
                return send_json(self, 200, {"ok": True, "items": get_trace((qs.get("agent") or [None])[0], int((qs.get("hours") or ["24"])[0]))})
            if path == "/office/ledger" and method == "GET":
                return send_json(self, 200, {"ok": True, **get_ledger()})
            if path == "/office/ledger" and method == "POST":
                if not _role_ok(_auth_role_from_headers(self.headers, self.client_address), ("admin", "manager")):
                    return send_json(self, 403, {"ok": False, "error": "hanya admin/manager"})
                body = read_body(self)
                if body.get("action") == "assign":
                    res, err = assign_project(body.get("agent"), body.get("project"))
                    if err:
                        return send_json(self, 400, {"ok": False, "error": err})
                    return send_json(self, 200, {"ok": True, "assignments": res})
                proj, err = set_ledger_project(body)
                if err:
                    return send_json(self, 400, {"ok": False, "error": err})
                return send_json(self, 201, {"ok": True, "project": proj})
            if path == "/office/review" and method == "GET":
                qs = urllib.parse.parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
                return send_json(self, 200, {"ok": True, "items": list_reviews((qs.get("agent") or [None])[0])})
            if path == "/office/review" and method == "POST":
                rev, err = submit_review(read_body(self))
                if err:
                    return send_json(self, 400, {"ok": False, "error": err})
                return send_json(self, 201, {"ok": True, "review": rev})
            if path == "/office/handoff" and method == "POST":
                body = read_body(self)
                item, err = create_board_item({
                    "title": str(body.get("title", "Handoff")),
                    "desc": str(body.get("note", "")),
                    "agent": str(body.get("to", "")).strip() or None,
                    "type": "handoff",
                    "risk": "medium",
                    "priority": body.get("priority", "normal"),
                    "tags": [str(body.get("from", ""))],
                })
                if err:
                    return send_json(self, 400, {"ok": False, "error": err})
                try:
                    push_telegram(f"🤝 Handoff → Board: {item.get('title')} → {item.get('agent') or 'pool'}")
                except Exception:
                    pass
                return send_json(self, 201, {"ok": True, "item": item})
            # --- F4-14: Board ↔ Ticketing sinkron (convert) ---
            if path == "/office/sync/board-to-ticket" and method == "POST":
                body = read_body(self)
                bd = load_json(BOARD_FILE, BOARD_DEFAULT)
                it = next((i for i in bd.get("items", []) if i.get("id") == body.get("board_id")), None)
                if not it:
                    return send_json(self, 404, {"ok": False, "error": "board item tidak ditemukan"})
                tkt = None
                try:
                    tkt = create_ticket({
                        "title": it.get("title", "Task"),
                        "description": it.get("desc", ""),
                        "agent": it.get("agent") or "pool",
                        "priority": it.get("priority", "normal"),
                        "source": "board",
                        "board_id": it["id"],
                    })
                except Exception as e:
                    return send_json(self, 400, {"ok": False, "error": str(e)})
                it["ticket_id"] = tkt.get("id")
                save_json(BOARD_FILE, bd)
                return send_json(self, 201, {"ok": True, "ticket": tkt})
            if path == "/office/sync/ticket-to-board" and method == "POST":
                body = read_body(self)
                tdata = load_json(TICKET_FILE, TICKET_DEFAULT)
                tkt = next((t for t in tdata.get("items", []) if t.get("id") == body.get("ticket_id")), None)
                if not tkt:
                    return send_json(self, 404, {"ok": False, "error": "tiket tidak ditemukan"})
                item, err = create_board_item({
                    "title": tkt.get("title", "Tiket"),
                    "desc": tkt.get("description", ""),
                    "agent": tkt.get("agent") or None,
                    "type": "ticket",
                    "risk": "medium",
                    "priority": tkt.get("priority", "normal"),
                    "tags": ["ticket"],
                })
                if err:
                    return send_json(self, 400, {"ok": False, "error": err})
                item["ticket_id"] = tkt["id"]
                save_json(BOARD_FILE, load_json(BOARD_FILE, BOARD_DEFAULT))
                return send_json(self, 201, {"ok": True, "item": item})
            # --- F4-13: Hire agent → fleet config ---
            if path == "/office/hire" and method == "POST":
                if not _role_ok(_auth_role_from_headers(self.headers, self.client_address), ("admin",)):
                    return send_json(self, 403, {"ok": False, "error": "hanya admin"})
                body = read_body(self)
                name = str(body.get("name", "")).strip().lower()
                if not name or " " in name:
                    return send_json(self, 400, {"ok": False, "error": "name wajib (satu kata, lowercase)"})
                fleets = {"rena": "http://127.0.0.1:3101", "farrah": "http://127.0.0.1:3102", "nadine": "http://127.0.0.1:3103", "aaron": "http://127.0.0.1:3104", "dinda": "http://127.0.0.1:3105"}
                host = str(body.get("host", "")).strip() or "http://127.0.0.1:3120"
                # tulis ke gateway_keys.env? Tidak — daftarkan ke org + fleet config via file
                org = load_json(ORG_FILE, ORG_DEFAULT)
                org.setdefault("agents", []).append({"id": name, "name": str(body.get("display_name", name)).strip() or name,
                                                     "role": str(body.get("role", "Agent")).strip() or "Agent",
                                                     "server": str(body.get("server", "Hostinger")).strip() or "Hostinger",
                                                     "status": "offline", "source": "hired"})
                save_json(ORG_FILE, org)
                # juga tambah ke ticket agents config
                tcfg = load_json(TICKET_CONFIG_FILE, {})
                tcfg.setdefault("agents", []).append(name)
                save_json(TICKET_CONFIG_FILE, tcfg)
                try:
                    push_telegram(f"🎉 Agent baru di-hire: <b>{name}</b> ({body.get('role', 'Agent')})")
                except Exception:
                    pass
                return send_json(self, 201, {"ok": True, "agent": {"id": name, "role": body.get("role", "Agent")}})
            # --- F3-6/9/12: parliament, fleet refresh, uptime, mcp ---
            if path == "/office/parliament" and method == "GET":
                qs = urllib.parse.parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
                return send_json(self, 200, {"ok": True, "items": list_parliament(int((qs.get("limit") or ["20"])[0]))})
            if path == "/office/parliament" and method == "POST":
                sess, err = start_parliament(read_body(self))
                if err:
                    return send_json(self, 400, {"ok": False, "error": err})
                return send_json(self, 201, {"ok": True, "session": sess})
            if path == "/office/fleet/refresh" and method == "POST":
                if not _role_ok(_auth_role_from_headers(self.headers, self.client_address), ("admin", "manager")):
                    return send_json(self, 403, {"ok": False, "error": "hanya admin/manager"})
                data = fleet_refresh()
                return send_json(self, 200, {"ok": True, "agents": len((data or {}).get("agents", []))})
            if path == "/office/uptime" and method == "GET":
                qs = urllib.parse.parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
                return send_json(self, 200, {"ok": True, "uptime": get_uptime((qs.get("agent") or [None])[0], int((qs.get("days") or ["7"])[0]))})
            if path == "/office/mcp" and method == "GET":
                return send_json(self, 200, {"ok": True, "servers": list_mcp()})
            if path == "/office/mcp" and method == "POST":
                if not _role_ok(_auth_role_from_headers(self.headers, self.client_address), ("admin",)):
                    return send_json(self, 403, {"ok": False, "error": "hanya admin"})
                srv, err = save_mcp(read_body(self))
                if err:
                    return send_json(self, 400, {"ok": False, "error": err})
                return send_json(self, 201, {"ok": True, "server": srv})
            if path == "/office/mcp/delete" and method == "POST":
                if not _role_ok(_auth_role_from_headers(self.headers, self.client_address), ("admin",)):
                    return send_json(self, 403, {"ok": False, "error": "hanya admin"})
                body = read_body(self)
                ok = delete_mcp(str(body.get("name", "")))
                return send_json(self, 200, {"ok": ok})
            # --- playbook & incidents ---
            if path == "/office/playbook" and method == "GET":
                if not _role_ok(_auth_role_from_headers(self.headers, self.client_address), ("admin", "manager")):
                    return send_json(self, 403, {"ok": False, "error": "hanya admin/manager"})
                return send_json(self, 200, {"ok": True, **list_playbook()})
            if path == "/office/playbook" and method == "POST":
                rule, err = save_playbook_rule(read_body(self), _auth_role_from_headers(self.headers, self.client_address))
                if err:
                    return send_json(self, 403, {"ok": False, "error": err})
                return send_json(self, 201, {"ok": True, "rule": rule})
            if path == "/office/playbook/run" and method == "POST":
                if not _role_ok(_auth_role_from_headers(self.headers, self.client_address), ("admin",)):
                    return send_json(self, 403, {"ok": False, "error": "hanya admin"})
                run_playbook()
                return send_json(self, 200, {"ok": True})
            m = re.match(r"^/office/playbook/([^/]+)$", path)
            if m and method == "DELETE":
                res, err = delete_playbook_rule(m.group(1), _auth_role_from_headers(self.headers, self.client_address))
                if err:
                    return send_json(self, 403, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True, **res})
            if path == "/office/incidents" and method == "GET":
                return send_json(self, 200, {"ok": True, **list_incidents()})
            if path == "/office/incidents/check" and method == "POST":
                if not _role_ok(_auth_role_from_headers(self.headers, self.client_address), ("admin",)):
                    return send_json(self, 403, {"ok": False, "error": "hanya admin"})
                return send_json(self, 200, {"ok": True, **check_incidents()})
            m = re.match(r"^/office/incidents/([^/]+)/resolve$", path)
            if m and method == "POST":
                body = read_body(self)
                res, err = resolve_incident(m.group(1), _auth_role_from_headers(self.headers, self.client_address), body.get("note"))
                if err:
                    return send_json(self, 403, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True, **res})
            # --- multi-user & roles ---
            if path == "/office/auth/login" and method == "POST":
                user, err = auth_login(read_body(self))
                if err:
                    return send_json(self, 401, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True, "user": user})
            if path == "/office/auth/me" and method == "GET":
                utok = self.headers.get("X-Office-User-Token", "") or self.headers.get("x-office-user-token", "")
                if not utok:
                    return send_json(self, 200, {"ok": True, "user": {"username": "admin", "name": "Administrator", "role": "admin"}})
                users = load_json(USERS_FILE, USERS_DEFAULT).get("users", [])
                for usr in users:
                    if usr.get("token") == utok:
                        return send_json(self, 200, {"ok": True, "user": {"username": usr["username"], "name": usr.get("name"), "role": usr.get("role")}})
                return send_json(self, 401, {"ok": False, "error": "token tidak dikenal"})
            if path == "/office/auth/users" and method == "GET":
                users, err = auth_list_users(_auth_role_from_headers(self.headers, self.client_address))
                if err:
                    return send_json(self, 403, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True, "users": users})
            if path == "/office/auth/users" and method == "POST":
                user, err = auth_create_user(read_body(self), _auth_role_from_headers(self.headers, self.client_address))
                if err:
                    return send_json(self, 403, {"ok": False, "error": err})
                return send_json(self, 201, {"ok": True, "user": user})
            if path == "/office/auth/users/delete" and method == "POST":
                res, err = auth_delete_user(read_body(self), _auth_role_from_headers(self.headers, self.client_address))
                if err:
                    return send_json(self, 403, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True, **res})
            if path == "/office/auth/password" and method == "POST":
                body = read_body(self)
                utok = self.headers.get("X-Office-User-Token", "") or self.headers.get("x-office-user-token", "")
                uname = None
                for usr in load_json(USERS_FILE, USERS_DEFAULT).get("users", []):
                    if usr.get("token") == utok:
                        uname = usr["username"]
                        break
                if not uname:
                    return send_json(self, 401, {"ok": False, "error": "token tidak dikenal"})
                res, err = auth_change_password(body, uname)
                if err:
                    return send_json(self, 400, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True})
            if path == "/office/logs" and method == "GET":
                qs = urllib.parse.parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
                tail = (qs.get("tail") or ["300"])[0]
                level = (qs.get("level") or ["all"])[0]
                return send_json(self, 200, {"ok": True, **get_system_logs(level, tail)})
            if path == "/office/export" and method == "GET":
                qs = urllib.parse.parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
                kind = (qs.get("type") or ["kpi"])[0]
                csv_text, err = export_csv(kind)
                if err:
                    return send_json(self, 400, {"ok": False, "error": err})
                body = csv_text.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                self.send_header("Content-Disposition", f'attachment; filename="{kind}_export.csv"')
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if path == "/office/report" and method == "POST":
                body = read_body(self)
                res, err = generate_report(body.get("kind", "kpi"), body.get("days", 7))
                if err:
                    return send_json(self, 400, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True, **res})
            if path == "/office/export-xlsx" and method == "POST":
                body = read_body(self)
                res, err = export_xlsx(body.get("kind", "kpi"))
                if err:
                    return send_json(self, 400, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True, **res})
            if path == "/office/license" and method == "GET":
                return send_json(self, 200, {"ok": True, "license": get_license()})
            if path == "/office/license/activate" and method == "POST":
                if not _role_ok(_auth_role_from_headers(self.headers, self.client_address), ("admin",)):
                    return send_json(self, 403, {"ok": False, "error": "hanya admin"})
                lic, err = activate_license(read_body(self))
                if err:
                    return send_json(self, 400, {"ok": False, "error": err})
                return send_json(self, 200, {"ok": True, "license": lic})
            return send_json(self, 404, {"ok": False, "error": f"no route {method} {path}"})
        except Exception as e:
            return send_json(self, 500, {"ok": False, "error": str(e)})

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_DELETE(self):
        self._route("DELETE")


if __name__ == "__main__":
    os.makedirs(DATA_DIR, exist_ok=True)
    # seed kalau kosong
    for path, default in [
        (APPROVAL_FILE, APPROVAL_DEFAULT),
        (ORG_FILE, ORG_DEFAULT),
        (KPI_MANUAL_FILE, KPI_MANUAL_DEFAULT),
        (PAYROLL_FILE, PAYROLL_DEFAULT),
        (SHIFT_FILE, SHIFT_DEFAULT),
        (POLICY_FILE, POLICY_DEFAULT),
        (CAPS_FILE, CAPS_DEFAULT),
        (BRANDING_FILE, BRANDING_DEFAULT),
        (BOARD_FILE, BOARD_DEFAULT),
        (BOARD_RULES_FILE, BOARD_RULES_DEFAULT),
        (BOARD_TEMPLATES_FILE, BOARD_TEMPLATES_DEFAULT),
        (LICENSE_FILE, LICENSE_DEFAULT),
    ]:
        if not os.path.exists(path):
            save_json(path, default)
    os.makedirs(MEMORY_DIR, exist_ok=True)
    for cat in MEMORY_CATEGORIES:
        os.makedirs(os.path.join(MEMORY_DIR, cat), exist_ok=True)
    # Bootstrap admin dari env MYOFFICE_ADMIN_PASSWORD (sekali) — tanpa default password
    _bootstrap_admin()
    # Kanban D: scheduler rules otomatis
    threading.Thread(target=run_board_rules_scheduler, daemon=True).start()
    print("board rules scheduler started", flush=True)
    # Memory B: scheduler auto-context + ringkasan harian
    threading.Thread(target=run_memory_scheduler, daemon=True).start()
    print("memory scheduler started", flush=True)
    # Auto RAG: context per agent tiap 10 menit
    threading.Thread(target=run_context_scheduler, daemon=True).start()
    print("auto-rag context scheduler started", flush=True)
    # Playbook: tiap 5 menit
    threading.Thread(target=run_playbook_scheduler, daemon=True).start()
    print("playbook scheduler started", flush=True)
    # Incident: tiap 5 menit
    threading.Thread(target=run_incident_scheduler, daemon=True).start()
    print("incident scheduler started", flush=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"office-backend listening on 127.0.0.1:{PORT}", flush=True)
    server.serve_forever()
