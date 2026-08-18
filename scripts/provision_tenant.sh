#!/usr/bin/env bash
# ============================================================
#  MyOffice — Provision Tenant (multi-tenant, Jalur A)
#  Satu server, tiap klien = instance backend terisolasi.
#  Usage:
#    bash provision_tenant.sh --name "PT Maju" --template agency [--port 3151] [--color "#22D3EE"]
#  Hasil: /opt/myoffice-tenants/<slug>/ + systemd unit + tenants.json
# ============================================================
set -euo pipefail

NAME=""
TEMPLATE="agency"
PORT=""
COLOR="#6366F1"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) NAME="$2"; shift 2;;
    --template) TEMPLATE="$2"; shift 2;;
    --port) PORT="$2"; shift 2;;
    --color) COLOR="$2"; shift 2;;
    *) echo "argumen tidak dikenal: $1"; exit 1;;
  esac
done

if [[ -z "$NAME" ]]; then
  echo "Wajib: --name \"Nama Klien\""
  exit 1
fi

SLUG="$(echo "$NAME" | tr 'A-Z ' 'a-z-' | tr -cd 'a-z0-9-')"
SLUG="${SLUG:-tenant}"
BASE="/opt/myoffice-tenants/$SLUG"
[[ -z "$PORT" ]] && PORT=$((3150 + $(ls -d /opt/myoffice-tenants/*/ 2>/dev/null | wc -l)))

echo "=== PROVISION TENANT: $NAME ($SLUG) — port $PORT ==="

# 1. struktur
mkdir -p "$BASE"/{data,memory,workspace,logs}
echo "  struktur: $BASE"

# 2. .env tenant (override backend — semua sudah didukung office_backend)
TOKEN="$(openssl rand -hex 16)"
cat > "$BASE/.env" <<EOF
MYOFFICE_PORT=$PORT
MYOFFICE_API_TOKEN=$TOKEN
MYOFFICE_DATA_DIR=$BASE/data
MYOFFICE_VAULT_ROOT=$BASE/workspace
MYOFFICE_MEMORY_DIR=$BASE/memory
MYOFFICE_FLEET_URL=http://127.0.0.1:3120/fleet.json
MYOFFICE_JOBS_URL=http://127.0.0.1:3122/jobs.json
MYOFFICE_LICENSE_SECRET=
EOF
chmod 600 "$BASE/.env"
echo "  .env dibuat (token random)"

# 3. seed branding + data dari template
TEMPLATE_FILE="/opt/myoffice/templates/$TEMPLATE.json"
if [[ -f "$TEMPLATE_FILE" ]]; then
  python3 - "$TEMPLATE_FILE" "$BASE/data" "$NAME" "$COLOR" <<'PY'
import json, sys
tpl_path, data_dir, name, color = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
tpl = json.load(open(tpl_path))
def save(fn, obj):
    json.dump(obj, open(f"{data_dir}/{fn}", "w"), indent=2)
save("branding.json", {"name": name, "logo": "/myoffice-avatar.webp", "primary_color": color,
                        "description": "AI agent operating system", "footer": f"Powered by {name}", "contact": ""})
save("org.json", tpl.get("org", {"company": name, "departments": [], "agents": []}))
save("payroll.json", {"period": "2026-08", "currency": "USD", "warning_threshold_pct": 80,
                       "agents": [{"id": a["id"], "name": a.get("name", a["id"]), "salary_usd": a.get("salary_usd", 50)} for a in tpl.get("org", {}).get("agents", [])]})
save("caps.json", {"auto_pause": True, "global_budget_usd": 200,
                    "agent_caps": {a["id"]: a.get("salary_usd", 50) for a in tpl.get("org", {}).get("agents", [])}})
save("policy.json", {"require_approval_risks": ["deploy", "spending", "secret_access"], "note": "default tenant policy"})
save("board.json", {"columns": ["backlog", "todo", "waiting_approval", "in_progress", "in_review", "done", "blocked"],
                     "items": [{"id": "bk_seed", "title": i.get("title", "Task awal"), "desc": i.get("desc", ""),
                                 "agent": i.get("agent"), "priority": i.get("priority", "medium"), "risk": i.get("risk", "low"),
                                 "type": i.get("type", "task"), "status": "todo", "sla_minutes": i.get("sla_minutes", 720),
                                 "tags": [], "created_at": "2026-08-18T00:00:00Z", "updated_at": "2026-08-18T00:00:00Z",
                                 "history": []} for i in tpl.get("board", [])[:5]]})
save("tickets.json", {"items": []})
save("license.json", {"key": None, "client_name": None, "status": "unlicensed"})
print("  seed data dari template:", tpl.get("niche", "template"))
PY
else
  echo "  ⚠ template $TEMPLATE tidak ditemukan — pakai data kosong"
fi

# 4. systemd unit per tenant
cat > /tmp/myoffice-tenant-unit <<EOF
[Unit]
Description=MyOffice Tenant: $NAME ($SLUG)
After=network.target

[Service]
Type=simple
User=aaron
WorkingDirectory=/opt/myoffice
EnvironmentFile=$BASE/.env
ExecStart=/usr/bin/python3 /opt/myoffice/office_backend.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo cp /tmp/myoffice-tenant-unit "/etc/systemd/system/myoffice-tenant-$SLUG.service"
sudo systemctl daemon-reload
sudo systemctl enable "myoffice-tenant-$SLUG" >/dev/null 2>&1 || true
sudo systemctl start "myoffice-tenant-$SLUG" || true
sleep 2
echo "  unit: myoffice-tenant-$SLUG.service"

# 5. registry
REG="/opt/myoffice/tenants.json"
python3 - "$REG" "$SLUG" "$NAME" "$PORT" "$TOKEN" "$TEMPLATE" <<'PY'
import json, sys, datetime
reg_path, slug, name, port, token, template = sys.argv[1:7]
try:
    reg = json.load(open(reg_path))
except Exception:
    reg = {"tenants": []}
reg["tenants"] = [t for t in reg.get("tenants", []) if t["slug"] != slug]
reg["tenants"].append({"slug": slug, "name": name, "port": int(port), "template": template,
                        "token": token, "created": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                        "status": "active"})
json.dump(reg, open(reg_path, "w"), indent=2)
print("  registry:", reg_path, f"({len(reg['tenants'])} tenant)")
PY

echo ""
echo "=== TENANT SIAP ==="
echo "  Slug     : $SLUG"
echo "  Port     : $PORT"
echo "  Health   : curl -H 'X-Office-Token: $TOKEN' http://127.0.0.1:$PORT/office/health"
echo "  Data     : $BASE/data"
echo "  Unit     : myoffice-tenant-$SLUG.service (start/stop/restart)"
echo "  Token    : $BASE/.env"
echo "  NOTE     : frontend/domain tenant belum dibuat — pasang nginx vhost bila perlu"
