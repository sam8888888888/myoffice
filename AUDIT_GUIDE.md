# AUDIT GUIDE — MyOffice (AI Office OS)

**Versi:** 1.24.0 · 18 Agustus 2026
**Stack:** Python single-file backend (office_backend.py, ~4.560 baris) + Next.js/TanStack Start frontend (React 19, TS, Zustand, TanStack Query, Tailwind v4) + Hermes Studio base.
**Storage:** file-based JSON (data/) — tanpa database eksternal (fitur jualan: backup = copy folder, whitelabel mudah).
**Arsitektur:** backend service (port 3121) + fleet aggregator (3120) + jobs aggregator (3122) + studio proxy (3110) + container frontend.

## Struktur
- `backend/office_backend.py` — SEMUA logika bisnis (auth, board, approvals, payroll, memory, komunikasi, AI assistant, parliament, playbook, incident, multi-tenant license)
- `backend/office_token.py` — helper auth token
- `backend/*_alert.py`, `backend/fleet_aggregator.py`, `backend/jobs_aggregator.py` — worker/scheduler
- `frontend/src/` — UI lengkap (routes per halaman)
- `scripts/` — setup, license, morning brief, approval telegram
- `docs/` — panduan Board vs Ticketing

## API (prefix /office, auth: header X-Office-Token)
### Inti
- `GET /health` · `GET /fleet` · `GET /status` · `GET /timeline` · `GET /logs` · `GET /policy` · `GET /caps`
- Board: `GET|POST /board`, `POST /board/{id}/move`, `GET|POST /board/config` (auto-assign)
- Approvals: `GET /approvals`, `POST /approvals`, `POST /approvals/{id}/decision`, `GET /policy`
- Payroll/budget: `GET|POST /payroll`, `POST /caps` (edit cap agent)
- KPI: `GET /kpi` · Shift: `GET /shift`, `GET|POST /shift/config`
- Memory: `GET|POST /memory`, `POST /memory/dreaming`, `POST /memory/context/refresh` (auto-RAG)
- Ticketing: `GET|POST /tickets`, `POST /tickets/{id}/claim|resolve`, `GET /tickets/inbox`
- Multi-user: `POST /auth/login`, `GET|POST /auth/users` (roles: admin/manager/viewer)
- License: `GET /license`, `POST /license/activate`

### FASE 1-4 (baru)
- `POST /report` (PDF) · `POST /export-xlsx` (Excel) · `GET /export?type=` (CSV)
- `POST /messages` · `GET /messages` · `POST /broadcast` · `GET /broadcast` · `GET /notifications` · `GET /inbox?agent=`
- `GET /ask?q=` — **AI Assistant "Tanya MyOffice"** (rule-based data live: online/spend/task/approval/incident/message)
- `GET /trace?agent=&hours=` — decision log
- `GET|POST /ledger` — token ledger per project
- `GET|POST /review` — review agent → quality
- `POST /handoff` — handoff → board task
- `GET|POST /parliament` — **Agent Parliament** (voting multi-agent, world-first)
- `POST /fleet/refresh` · `GET /uptime?days=` · `GET|POST /mcp` · `POST /mcp/delete`
- `POST /sync/board-to-ticket` · `POST /sync/ticket-to-board`
- `POST /hire` — hire agent → org + ticket config
- Playbook: `GET|POST /playbook` (trigger: spend_pct, agent_error_count, schedule, approval_pending, incident_open; action: telegram/pause/report/webhook)
- Incidents: `GET|POST /incidents` (escalation >15 menit → 🚨)

## Fitur Keamanan (sudah di-fix dari audit sebelumnya)
- Password: **scrypt salted** (bukan SHA-256) — legacy hash migrasi otomatis
- Admin: bootstrap dari env `MYOFFICE_ADMIN_PASSWORD` — TIDAK ada default password di source
- Role gate: non-localhost tanpa user-token → DITOLAK (bukan admin)
- CORS: terbatas (default localhost, env override)
- Duplikasi endpoint status/timeline/policy/caps: dibersihkan
- vault_restore: realpath normalization
- Rate limiting server-side · auth middleware · no secret in repo

## Data Flow Penting
1. **Approval 2-arah Telegram**: approval pending → bot @myofficeagentbot kirim tombol ✅/❌ → polling `approval_tg.py` (cron tiap menit, flock anti-dobel) → `POST /approvals/{id}/decision` → status updated
2. **Morning Brief**: cron 07:00 WIB → fleet/kpi/approval summary → Telegram
3. **Auto-RAG**: tiap 10 menit → `workspace/contexts/<agent>.md` (identitas + company + semantic dari currentTask)
4. **Multi-tenant**: `provision_tenant.sh` → instance terisolasi per klien (data/, .env, systemd, domain)

## Catatan Audit
- Backend = 1 file monolith — sengaja (Karpathy: keep simple; klien non-teknis; refactor modul/sqlite = roadmap F4-17, ditunda)
- Semantic search = n-gram hashing + cosine (zero-dependency — tanpa API eksternal, cocok whitelabel)
- `agent-personas.ts` = 5 agent resmi (rena/farrah/nadine/aaron/dinda) — kompak
- Menu sudah di-rename (Budget/Kanban/Agent Registry/Orchestrator/Corrections) + Inbox + Parliament
