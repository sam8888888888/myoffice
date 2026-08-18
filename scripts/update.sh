#!/usr/bin/env bash
# ============================================================
#  MyOffice — Updater (dijalankan di server klien saat ada versi baru)
#  Data 100% aman: backup otomatis sebelum update.
#
#  Cara pakai:
#    1. Vendor kirim file update:  myoffice-update.tar.gz
#    2. Letakkan di /tmp/myoffice-update.tar.gz
#    3. Jalankan:  bash update.sh
# ============================================================
set -euo pipefail
cd /opt/myoffice

echo "=============================================="
echo "  🔄 MyOffice Updater"
echo "=============================================="

echo ""
echo "[1/4] Backup data..."
TS="$(date +%Y%m%d_%H%M%S)"
sudo cp -r data "data.backup_${TS}"
echo "  ✓ Backup: data.backup_${TS}"

echo "[2/4] Ambil update..."
if [ -f /tmp/myoffice-update.tar.gz ]; then
  sudo tar xzf /tmp/myoffice-update.tar.gz -C /opt/myoffice
  rm -f /tmp/myoffice-update.tar.gz
  echo "  ✓ Update diekstrak (source + script baru)"
else
  echo "  ⚠ Tidak ada /tmp/myoffice-update.tar.gz — build dari source existing"
fi

echo "[3/4] Rebuild & restart container..."
sudo docker compose -f docker-compose.myoffice.yml build 2>&1 | tail -2
sudo docker compose -f docker-compose.myoffice.yml up -d --force-recreate 2>&1 | tail -2
sleep 3
STATUS="$(sudo docker ps --filter name=myoffice-studio --format '{{.Status}}')"
echo "  ✓ Container: $STATUS"

echo "[4/4] Cek kesehatan..."
sleep 2
TOK="$(grep '^MYOFFICE_API_TOKEN=' /opt/myoffice/.env 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'" || true)"
if [ -n "$TOK" ]; then
  curl -s --max-time 10 -H "X-Office-Token: $TOK" http://127.0.0.1:3121/office/health
  echo ""
fi
echo ""
echo "✅ UPDATE SELESAI — data aman. Hapus backup lama kalau sudah yakin:"
echo "   sudo rm -rf /opt/myoffice/data.backup_${TS}"
