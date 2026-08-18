#!/usr/bin/env bash
# ============================================================
#  MyOffice — Packaging Distribusi (VENDOR — dijalankan Papi)
#  Bikin paket tar.gz siap kirim ke klien:
#    - source hermes-studio (dashboard)
#    - office_backend + setup.sh + update.sh + license.sh
#    - templates + README
#  Hasil: /tmp/myoffice-dist-<tanggal>.tar.gz
# ============================================================
set -euo pipefail
cd /opt/myoffice

OUT="/tmp/myoffice-dist"
TS="$(date +%Y%m%d)"

echo "🧹 Bersihkan folder distribusi lama..."
rm -rf "$OUT"
mkdir -p "$OUT"

echo "📦 Salin file inti..."
cp docker-compose.myoffice.yml "$OUT/"
cp office_backend.py "$OUT/"
cp setup.sh "$OUT/" 2>/dev/null || true
cp update.sh "$OUT/" 2>/dev/null || true
cp license.sh "$OUT/" 2>/dev/null || true
cp README_SETUP.md "$OUT/" 2>/dev/null || true
cp -r templates "$OUT/" 2>/dev/null || true

echo "🏗️ Salin source dashboard (tanpa node_modules, .next, .git)..."
mkdir -p "$OUT/hermes-studio"
tar --exclude='node_modules' --exclude='.next' --exclude='.git' --exclude='.runtime' \
  -cf - -C /opt/myoffice hermes-studio | tar -xf - -C "$OUT"

echo "🗜️ Kompres..."
tar czf "/tmp/myoffice-dist-${TS}.tar.gz" -C "$OUT" .
SIZE="$(du -h "/tmp/myoffice-dist-${TS}.tar.gz" | cut -f1)"
rm -rf "$OUT"

echo ""
echo "✅ PAKET SIAP: /tmp/myoffice-dist-${TS}.tar.gz (${SIZE})"
echo ""
echo "Cara kirim ke klien:"
echo "  1. scp /tmp/myoffice-dist-${TS}.tar.gz user@server-klien:/tmp/"
echo "  2. Di server klien:"
echo "     cd /opt/myoffice && sudo tar xzf /tmp/myoffice-dist-${TS}.tar.gz -C /opt/myoffice"
echo "     bash setup.sh            # (install pertama)"
echo "     bash license.sh --key <KEY> --client 'Nama Klien'"
echo ""
echo "Update berikutnya: kirim file yang sama, klien jalankan bash update.sh"
