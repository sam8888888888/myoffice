#!/usr/bin/env bash
# ============================================================
#  MyOffice — Aktivasi Lisensi (dijalankan di server klien)
#  Usage: bash license.sh --key <KEY> --client "Nama Klien"
# ============================================================
set -euo pipefail

KEY=""
CLIENT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --key) KEY="$2"; shift 2 ;;
    --client) CLIENT="$2"; shift 2 ;;
    *) echo "Argumen tidak dikenal: $1"; exit 1 ;;
  esac
done

if [ -z "$KEY" ] || [ -z "$CLIENT" ]; then
  echo "Usage: bash license.sh --key <KEY> --client 'Nama Klien'"
  exit 1
fi

TOKEN="$(grep '^MYOFFICE_API_TOKEN=' /opt/myoffice/.env 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'" || true)"
if [ -z "$TOKEN" ]; then
  echo "❌ MYOFFICE_API_TOKEN tidak ditemukan — pastikan MyOffice sudah di-setup"
  exit 1
fi

echo "🔑 Mengaktifkan lisensi untuk: $CLIENT"
RESP="$(curl -s -X POST http://127.0.0.1:3121/office/license/activate \
  -H "X-Office-Token: $TOKEN" -H "Content-Type: application/json" \
  -d "{\"key\":\"$KEY\",\"client_name\":\"$CLIENT\"}")"

echo "$RESP" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print("⚠ Respons tidak terbaca:", sys.stdin.read()[:200]); sys.exit(1)
if d.get("ok"):
    l = d["license"]
    print("✅ LISENSI AKTIF")
    print("   Klien   : " + str(l.get("client_name")))
    print("   Expires : " + str(l.get("expires_at")))
    print("   Status  : " + str(l.get("status")))
else:
    print("❌ Gagal: " + str(d.get("error", "unknown")))
    sys.exit(1)
'
