import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

export const Route = createFileRoute('/shift')({
  component: ShiftScreen,
})

type ShiftRow = {
  id: string
  name: string
  status: 'aktif' | 'lembur' | 'idle'
  live: string
  absent: boolean
  hours_active: number
  overtime_hours: number
  overtime_alert: boolean
  last_activity: string | null
  hourly: number[]
  currentTask: string | null
}

type ShiftData = {
  config: { work_start: string; work_end: string; tz_offset_hours: number; overtime_alert_hours: number }
  today: string
  now_local_h: number
  rows: ShiftRow[]
  summary: { aktif: number; lembur: number; idle: number; absent: number }
}

const AGENT_COLOR: Record<string, string> = {
  rena: 'bg-indigo-600 text-white',
  farrah: 'bg-violet-600 text-white',
  nadine: 'bg-sky-600 text-white',
  aaron: 'bg-emerald-600 text-white',
  dinda: 'bg-rose-600 text-white',
}

const STATUS_STYLE: Record<string, string> = {
  aktif: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  lembur: 'border-amber-200 bg-amber-50 text-amber-700',
  idle: 'border-neutral-200 bg-[var(--theme-card2)] text-[var(--theme-text-muted)]',
}

function Timeline({ row, workStart, workEnd }: { row: ShiftRow; workStart: number; workEnd: number }) {
  const max = Math.max(...row.hourly, 1)
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-[9px] uppercase tracking-wide text-[var(--theme-muted)]">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
      </div>
      <div className="flex gap-0.5">
        {row.hourly.map((count, h) => {
          const inWork = h >= workStart && h < workEnd
          const intensity = count > 0 ? Math.max(Math.round((count / max) * 3), 1) : 0
          const base = inWork ? 'bg-emerald-500' : 'bg-amber-500'
          const opacity = intensity === 0 ? 'bg-[var(--theme-border)] opacity-70' : base
          const style: React.CSSProperties = {}
          if (intensity > 0) style.opacity = 0.35 + intensity * 0.2
          return (
            <div
              key={h}
              title={`${h}:00 — ${count} event${inWork ? '' : ' (lembur)'}`}
              className={`h-6 flex-1 rounded-sm ${opacity}`}
              style={style}
            />
          )
        })}
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-[var(--theme-muted)]">
        <span>jam kerja {workStart}:00–{workEnd}:00</span>
        <span>{row.hours_active} jam aktif</span>
      </div>
    </div>
  )
}

function fmtTime(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
}

export function ShiftScreen() {
  const shiftQuery = useQuery({
    queryKey: ['shift'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=shift')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return data as ShiftData
    },
    staleTime: 5000,
    refetchInterval: 30000,
  })

  const s = shiftQuery.data
  const rows = s?.rows ?? []
  const workStart = parseInt((s?.config.work_start ?? '08:00').split(':')[0], 10)
  const workEnd = parseInt((s?.config.work_end ?? '17:00').split(':')[0], 10)
  const [cfg, setCfg] = useState({ work_start: s?.config.work_start ?? '08:00', work_end: s?.config.work_end ?? '17:00', tz_offset_hours: String(s?.config.tz_offset_hours ?? 7), overtime_alert_hours: String(s?.config.overtime_alert_hours ?? 2) })
  const [cfgMsg, setCfgMsg] = useState<string | null>(null)
  const saveCfg = async () => {
    try {
      const res = await fetch('/api/office?resource=shift&action=config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_start: cfg.work_start,
          work_end: cfg.work_end,
          tz_offset_hours: Number(cfg.tz_offset_hours),
          overtime_alert_hours: Number(cfg.overtime_alert_hours),
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setCfgMsg('✅ Konfigurasi shift disimpan')
      shiftQuery.refetch()
      setTimeout(() => setCfgMsg(null), 3000)
    } catch (e) {
      setCfgMsg(`⚠️ ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--theme-text)]">Shift & Jam Kerja</h1>
          <p className="mt-1 text-sm text-[var(--theme-muted)]">
            Timeline aktivitas 24 jam ({s?.today ?? '…'}, WIB) — deteksi lembur & bolos.
          </p>
        </div>
        {s && (
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-medium text-emerald-700">
              🟢 {s.summary.aktif} aktif
            </span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 font-medium text-amber-700">
              🟡 {s.summary.lembur} lembur
            </span>
            <span className="rounded-full border border-neutral-200 bg-[var(--theme-card2)] px-3 py-1 font-medium text-[var(--theme-text-muted)]">
              ⚪ {s.summary.idle} idle
            </span>
            {s.summary.absent > 0 && (
              <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 font-medium text-red-700">
                🔴 {s.summary.absent} bolos
              </span>
            )}
          </div>
        )}
      </div>

      {/* Config shift (F1-7): edit jam kerja dari UI */}
      <div className="mb-4 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
        <div className="mb-2 text-sm font-semibold text-[var(--theme-text)]">⚙️ Konfigurasi Jam Kerja</div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--theme-muted)]">Mulai</label>
            <input
              type="time"
              value={cfg.work_start}
              onChange={(e) => setCfg((c) => ({ ...c, work_start: e.target.value }))}
              className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--theme-muted)]">Selesai</label>
            <input
              type="time"
              value={cfg.work_end}
              onChange={(e) => setCfg((c) => ({ ...c, work_end: e.target.value }))}
              className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--theme-muted)]">UTC Offset (jam)</label>
            <input
              type="number"
              value={cfg.tz_offset_hours}
              onChange={(e) => setCfg((c) => ({ ...c, tz_offset_hours: e.target.value }))}
              className="w-20 rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-[var(--theme-muted)]">Alert Lembur (jam)</label>
            <input
              type="number"
              value={cfg.overtime_alert_hours}
              onChange={(e) => setCfg((c) => ({ ...c, overtime_alert_hours: e.target.value }))}
              className="w-20 rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
            />
          </div>
          <button
            onClick={saveCfg}
            className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-600"
          >
            Simpan
          </button>
          {cfgMsg && <span className="text-xs text-emerald-500">{cfgMsg}</span>}
        </div>
      </div>

      {shiftQuery.isError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Gagal memuat shift: {String(shiftQuery.error)}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {rows.map((r) => (
          <div key={r.id} className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold ${AGENT_COLOR[r.id] ?? 'bg-neutral-500 text-white'}`}>
                {r.name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-[var(--theme-text)]">{r.name}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLE[r.status] ?? STATUS_STYLE.idle}`}>
                    {r.status}
                  </span>
                  {r.absent && (
                    <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-700">
                      🔴 bolos
                    </span>
                  )}
                  {r.overtime_alert && (
                    <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-orange-700">
                      ⏰ lembur {r.overtime_hours}h
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-[var(--theme-muted)]">
                  {r.currentTask ? `🔧 ${r.currentTask}` : '🟢 Idle'} · last: {fmtTime(r.last_activity)}
                </div>
              </div>
            </div>
            <Timeline row={r} workStart={workStart} workEnd={workEnd} />
          </div>
        ))}
      </div>

      {rows.length === 0 && !shiftQuery.isError && (
        <div className="py-10 text-center text-[var(--theme-muted)]">Memuat shift… (butuh beberapa menit untuk data aktivitas)</div>
      )}

      <TimesheetTable />
    </div>
  )
}

function TimesheetTable() {
  const tsQuery = useQuery({
    queryKey: ['timesheet'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=timesheet')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as {
        rows: Array<{
          id: string
          name: string
          status: string
          messages: number
          tokens: number
          cost: number
          days: Array<{ date: string; events: number; active_hours: number; in_work: number; overtime: number }>
        }>
      }
    },
    staleTime: 30000,
    refetchInterval: 60000,
  })

  const rows = tsQuery.data?.rows ?? []

  return (
    <div className="mt-6 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-[var(--theme-text)]">🧾 Timesheet 7 Hari — Token per Agent</h2>
        <p className="mt-0.5 text-xs text-[var(--theme-muted)]">
          Jam aktif per hari (WIB), event aktivitas, plus total pesan/token/biaya dari fleet.
        </p>
      </div>
      {tsQuery.isError && (
        <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          Gagal memuat timesheet: {String(tsQuery.error)}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--theme-border)] text-[10px] uppercase tracking-wide text-[var(--theme-muted)]">
              <th className="py-2 pr-3">Agent</th>
              <th className="py-2 pr-3">Msg</th>
              <th className="py-2 pr-3">Token</th>
              <th className="py-2 pr-3">Cost</th>
              {rows[0]?.days.map((d) => (
                <th key={d.date} className="py-2 pr-2 text-center" title={d.date}>
                  {d.date.slice(5).replace('-', '/')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[var(--theme-border-subtle)]">
                <td className="py-2 pr-3 font-medium text-[var(--theme-text)]">
                  {r.name}
                  <span className="ml-1 text-[10px] text-[var(--theme-muted)]">({r.status})</span>
                </td>
                <td className="py-2 pr-3 text-[var(--theme-text-muted)]">{r.messages}</td>
                <td className="py-2 pr-3 text-[var(--theme-text-muted)]">{r.tokens.toLocaleString()}</td>
                <td className="py-2 pr-3 text-[var(--theme-text-muted)]">${r.cost.toFixed(2)}</td>
                {r.days.map((d) => (
                  <td key={d.date} className="py-2 pr-2 text-center">
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        d.events === 0
                          ? 'text-[var(--theme-muted)]'
                          : d.overtime > 0
                            ? 'bg-orange-500/15 text-orange-600'
                            : 'bg-emerald-500/15 text-emerald-600'
                      }`}
                      title={`${d.events} event · ${d.active_hours} jam aktif${d.overtime ? ` · ${d.overtime} lembur` : ''}`}
                    >
                      {d.events === 0 ? '—' : `${d.active_hours}h`}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && !tsQuery.isError && (
        <div className="py-4 text-center text-xs text-[var(--theme-muted)]">Memuat timesheet…</div>
      )}
    </div>
  )
}
