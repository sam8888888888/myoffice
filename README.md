# MyOffice — AI Agent Operating System (whitelabel)

Suite HR + orchestration agent berbasis Hermes Studio, di-deploy sebagai produk whitelabel (jual putus / multi-tenant).

## Fitur
- **Kanban** HR-grade: 7 kolom + SLA + approval gate + auto-assign + automation rules + templates
- **Memory/Brain**: MemFS-style markdown + versioning + auto-context + dreaming + semantic search (zero-dependency embedding)
- **Ticketing**: agent inbox, SLA alert, auto-router, archive
- **Multi-user & roles**: Admin / Manager / Viewer, role gate di payroll/approvals/kill-switch
- **Playbook**: automation rules (spend %, agent health, jadwal laporan)
- **Incident escalation**: deteksi agent down + eskalasi otomatis
- **Whitelabel**: branding runtime, setup wizard klien, lisensi HMAC, laporan PDF
- **Multi-tenant**: provisioning per-klien (isolasi data + port + token)

## Arsitektur
- `myoffice-studio` — frontend Next.js (Hermes Studio + halaman custom MyOffice)
- `office_backend.py` — backend API (HTTP, port default 3121) — approvals, org, KPI, payroll, board, memory, tickets, users, playbook, incidents, license, reports
- `fleet_aggregator.py` — polling agent (Hermes gateways + SAMCODER)
- `jobs_aggregator.py` — polling cron jobs
- Semua data file-based (JSON + markdown) — mudah backup & multi-tenant

## Setup (produksi)
1. Salin file backend + scripts ke `/opt/myoffice/`
2. Buat `/opt/myoffice/.env`: `MYOFFICE_API_TOKEN=<random>`, `MYOFFICE_LICENSE_SECRET=<random>`, `MYOFFICE_TG_BOT_TOKEN`/`MYOFFICE_TG_CHAT_ID` (opsional), `MYOFFICE_HERMES_TOKEN` (gateway)
3. Jalankan `scripts/setup.sh --name "Brand" --template agency`
4. Frontend: `pnpm install && pnpm build && pnpm start` (container/nginx)

## Keamanan
- Wajib set `MYOFFICE_LICENSE_SECRET` (fallback di source TIDAK berisi secret nyata)
- Token dibaca dari env — tidak ada secret hardcode di repo ini
- Rate limit nginx, port internal ditutup dari internet, role-based access

## Disclaimer
Audit/analisa dilakukan HANYA pada aset milik/berizin pemilik. Kode ini untuk keperluan keamanan dan edukasi.
