#!/usr/bin/env bash
# ============================================================
#  MyOffice — Setup Wizard (whitelabel, jual putus)
#  Untuk klien non-teknis: pasang branding + template data
#  dalam hitungan menit, tanpa coding.
#
#  Cara pakai:
#    bash setup.sh                          # mode interaktif (tanya-tanya)
#    bash setup.sh --name "PT Maju" \
#      --template agency --color "#22D3EE"  # mode non-interaktif
#
#  Template tersedia: agency, ecommerce, jasa, saas
# ============================================================
set -euo pipefail

BACKEND="http://127.0.0.1:3121"
DATA_DIR="/opt/myoffice/data"
TEMPLATE_DIR="/opt/myoffice/templates"
ENV_FILE="/opt/myoffice/.env"

# --- ambil token ---
TOKEN=""
if [ -f "$ENV_FILE" ]; then
  TOKEN="$(grep '^MYOFFICE_API_TOKEN=' "$ENV_FILE" | cut -d= -f2 | tr -d '"' | tr -d "'" || true)"
fi
if [ -z "$TOKEN" ]; then
  echo "❌ MYOFFICE_API_TOKEN tidak ditemukan di $ENV_FILE"
  exit 1
fi
AUTH=(-H "X-Office-Token: $TOKEN" -H "Content-Type: application/json")

# --- parse argumen ---
NAME=""
TEMPLATE=""
COLOR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --template) TEMPLATE="$2"; shift 2 ;;
    --color) COLOR="$2"; shift 2 ;;
    *) echo "Argumen tidak dikenal: $1"; exit 1 ;;
  esac
done

echo ""
echo "=============================================="
echo "  🏢 MyOffice Setup Wizard"
echo "  Whitelabel Agent OS — siap jual putus"
echo "=============================================="
echo ""

# --- 1. Nama brand ---
if [ -z "$NAME" ]; then
  read -rp "Nama perusahaan / brand: " NAME
fi
if [ -z "$NAME" ]; then
  echo "❌ Nama brand wajib diisi"
  exit 1
fi
echo "   ✓ Brand: $NAME"

# --- 2. Template niche ---
if [ -z "$TEMPLATE" ]; then
  echo ""
  echo "Pilih template bisnis (data awal: org chart, payroll, policy, board, memory):"
  echo "  1) agency    — Digital Agency"
  echo "  2) ecommerce — E-commerce / Toko Online"
  echo "  3) jasa      — Jasa / Layanan (UMKM)"
  echo "  4) saas      — SaaS / Startup Teknologi"
  read -rp "Pilihan [1-4]: " TPL_CHOICE
  case "${TPL_CHOICE:-1}" in
    1) TEMPLATE="agency" ;;
    2) TEMPLATE="ecommerce" ;;
    3) TEMPLATE="jasa" ;;
    4) TEMPLATE="saas" ;;
    *) echo "❌ Pilihan tidak valid"; exit 1 ;;
  esac
fi
TPL_FILE="$TEMPLATE_DIR/$TEMPLATE.json"
if [ ! -f "$TPL_FILE" ]; then
  echo "❌ Template '$TEMPLATE' tidak ditemukan di $TEMPLATE_DIR"
  exit 1
fi
echo "   ✓ Template: $TEMPLATE"

# --- 3. Warna primer (opsional) ---
if [ -z "$COLOR" ]; then
  read -rp "Warna utama (Enter = default #6366F1): " COLOR
  COLOR="${COLOR:-#6366F1}"
fi
echo "   ✓ Warna: $COLOR"

echo ""
echo "⏳ Menyiapkan branding & seed data..."
echo ""

# --- 4. Branding ---
curl -s -X POST "$BACKEND/office/branding" "${AUTH[@]}" \
  -d "{\"name\":\"$NAME\",\"primary_color\":\"$COLOR\",\"footer\":\"Powered by $NAME\"}" >/dev/null
echo "   ✓ Branding diterapkan ($NAME, $COLOR)"

# --- 5. Seed dari template (via Python: org/payroll/policy/caps + API board/memory) ---
python3 - "$TPL_FILE" "$NAME" <<'PYEOF'
import json, os, subprocess, sys, urllib.request

TPL_FILE, BRAND = sys.argv[1], sys.argv[2]
DATA_DIR = "/opt/myoffice/data"
BACKEND = "http://127.0.0.1:3121"
env_path = "/opt/myoffice/.env"
token = ""
with open(env_path) as f:
    for line in f:
        line = line.strip()
        if line.startswith("MYOFFICE_API_TOKEN="):
            token = line.split("=", 1)[1].strip().strip('"').strip("'")
            break
HDR = {"X-Office-Token": token, "Content-Type": "application/json"}

def api(method, path, payload=None):
    req = urllib.request.Request(
        BACKEND + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers=HDR, method=method,
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)

tpl = json.load(open(TPL_FILE))

# org
org = dict(tpl.get("org", {}))
org["company"] = BRAND
try:
    api("POST", "/office/org", org)
    print("   ✓ Org chart: " + BRAND)
except Exception as e:
    print("   ⚠ Org chart gagal: " + str(e))

# payroll / policy / caps / kpi_manual — tulis file langsung (data lokal)
payroll = tpl.get("payroll", {})
json.dump(payroll, open(os.path.join(DATA_DIR, "payroll.json"), "w"), indent=2, ensure_ascii=False)
json.dump(tpl.get("policy", {}), open(os.path.join(DATA_DIR, "policy.json"), "w"), indent=2, ensure_ascii=False)
json.dump(tpl.get("caps", {}), open(os.path.join(DATA_DIR, "caps.json"), "w"), indent=2, ensure_ascii=False)
json.dump({"best_work": [], "scores": {}}, open(os.path.join(DATA_DIR, "kpi_manual.json"), "w"), indent=2, ensure_ascii=False)
print("   ✓ Payroll, policy, caps, KPI di-seed")

# board
for item in tpl.get("board", []):
    try:
        api("POST", "/office/board", {**item, "by": "setup"})
    except Exception:
        pass
print(f"   ✓ Board: {len(tpl.get('board', []))} task contoh")

# memory
for note in tpl.get("memory", []):
    try:
        api("POST", "/office/memory", note)
    except Exception:
        pass
print(f"   ✓ Memory: {len(tpl.get('memory', []))} notes awal")

print("DONE")
PYEOF

echo ""
echo "=============================================="
echo "  ✅ Setup selesai!"
echo "  Brand : $NAME"
echo "  Warna : $COLOR"
echo "  Template: $TEMPLATE"
echo ""
echo "  Langkah berikutnya:"
echo "   1) Ganti logo: upload file ke public/myoffice-avatar.webp (atau set via /office/branding)"
echo "   2) Hubungkan domain & SSL (kalau belum)"
echo "   3) Buka dashboard → mulai kasih task di /board"
echo "=============================================="
