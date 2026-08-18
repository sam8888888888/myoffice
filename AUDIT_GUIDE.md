# MyOffice — Panduan Audit (route API + struktur frontend)

Dibuat otomatis: 2026-08-18T14:06Z

## 1. Route API Backend (office_backend.py — HTTP, port 3121)

```
/office/approvals
/office/auth/login
/office/auth/me
/office/auth/password
/office/auth/users
/office/auth/users/delete
/office/board
/office/board/rules
/office/board/templates
/office/branding
/office/caps
/office/controls
/office/controls/agent
/office/controls/global
/office/employees
/office/geofence
/office/handoffs
/office/health
/office/incidents
/office/incidents/check
/office/kpi
/office/license
/office/license/activate
/office/logs
/office/memory
/office/memory/audit
/office/memory/context/refresh
/office/memory/daily
/office/memory/dreaming
/office/memory/refresh-contexts
/office/onboarding
/office/onboarding/draft
/office/org
/office/payroll
/office/playbook
/office/playbook/run
/office/policy
/office/quality
/office/report
/office/reviews
/office/rollback
/office/shift
/office/standup
/office/status
/office/tickets
/office/tickets/inbox
/office/tickets/queue
/office/tickets/stats
/office/timeline
/office/timesheet
/office/vacation
/office/vault
/office/versions
```

## 2. Struktur Frontend (src/routes — halaman & menu)

```
$
__root
activity
agents
analytics
approvals
audit
board
brain
chat
conductor
control
crews
dashboard
docs
employees
files
fleet
handoffs
health
help
hr
incidents
index
jobs
jobs-all
kpi
logs
memory
onboarding
operations
org
patterns
payroll
playbook
profiles
review
session-history
settings
settings
shift
skills
standup
tasks
team
terminal
tickets
timeline
users
vault
```

## 3. Komponen frontend (UI)

```
agents
analytics
audit
chat
conductor
crews
dashboard
docs
files
help
jobs
logs
memory
operations
patterns
profiles
session-history
settings
skills
tasks
```

## 4. Arsitektur
- Frontend: Next.js (Hermes Studio + halaman custom MyOffice)
- Backend: office_backend.py (HTTP 3121) — approvals/org/kpi/payroll/board/memory/tickets/users/playbook/incidents/license/reports/logs/geofence/controls
- Poller: fleet_aggregator.py (agent) + jobs_aggregator.py (cron jobs)
- Data: file-based JSON (/opt/myoffice/data) + markdown (memory) + workspace (vault)
- Multi-tenant: /opt/myoffice-tenants/<slug>/ dengan env override (port/data/token terpisah)
- Lisensi: HMAC-SHA256 (client.expiry.signature), env MYOFFICE_LICENSE_SECRET
