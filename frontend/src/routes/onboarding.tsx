import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

export const Route = createFileRoute('/onboarding')({
  component: OnboardingScreen,
})

type DraftAgent = {
  id: string
  name: string
  role: string
  dept: string
  notes: string
  created_at: string
  hired_at?: string
  hired_by?: string
}

type OnboardingData = {
  draft_agents: DraftAgent[]
  hired: DraftAgent[]
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })
}

export function OnboardingScreen() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [role, setRole] = useState('Agent')
  const [dept, setDept] = useState('Umum')
  const [notes, setNotes] = useState('')

  const onboardQuery = useQuery({
    queryKey: ['onboarding'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=onboarding')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return data as OnboardingData
    },
    staleTime: 3000,
    refetchInterval: 10000,
  })

  const addDraft = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/office?resource=onboarding&action=draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, role, dept, notes }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['onboarding'] })
      setName('')
      setRole('Agent')
      setNotes('')
    },
  })

  const hire = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch('/api/office?resource=onboarding&action=hire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding'] }),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/office?resource=onboarding&action=remove&id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding'] }),
  })

  const data = onboardQuery.data
  const drafts = data?.draft_agents ?? []
  const hired = data?.hired ?? []

  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-[var(--theme-text)]">Onboarding</h1>
        <p className="mt-1 text-sm text-[var(--theme-muted)]">
          Draft → Hire — agent baru tidak aktif sampai Papi setujui.
        </p>
      </div>

      {/* Form draft */}
      <div className="mb-5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
        <h2 className="mb-3 text-sm font-semibold text-[var(--theme-text)]">Daftarkan kandidat agent</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nama agent…"
            className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)] sm:col-span-2"
          />
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Role…"
            className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
          />
          <select
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
          >
            {['Koordinasi & Operasional', 'Ops & Bisnis', 'Proyek FindBuyer', 'Development & Automation', 'Audit & Security', 'Umum'].map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Catatan…"
            className="rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]"
          />
          <button
            onClick={() => addDraft.mutate()}
            disabled={addDraft.isPending || !name.trim()}
            className="rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            + Draft
          </button>
        </div>
      </div>

      {/* Draft list */}
      <div className="mb-5">
        <h2 className="mb-2 text-sm font-semibold text-[var(--theme-text)]">Draft ({drafts.length})</h2>
        <div className="space-y-2">
          {drafts.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/30 px-4 py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500 text-sm font-bold text-white">
                {d.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-[var(--theme-text)]">{d.name}</div>
                <div className="text-xs text-[var(--theme-muted)]">{d.role} · {d.dept}</div>
              </div>
              {d.notes && <div className="max-w-[200px] truncate text-xs text-[var(--theme-muted)]">{d.notes}</div>}
              <span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">draft</span>
              <span className="text-[10px] text-[var(--theme-muted)]">{fmtTime(d.created_at)}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => hire.mutate(d.id)}
                  disabled={hire.isPending}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  ✓ Hire
                </button>
                <button
                  onClick={() => remove.mutate(d.id)}
                  disabled={remove.isPending}
                  className="rounded-lg bg-neutral-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-600 disabled:opacity-50"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
          {drafts.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--theme-border)] py-8 text-center text-xs text-[var(--theme-muted)]">
              Belum ada draft agent. Daftarkan kandidat di atas.
            </div>
          )}
        </div>
      </div>

      {/* Hired */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-[var(--theme-text)]">Sudah di-hire ({hired.length})</h2>
        <div className="space-y-2">
          {hired.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-4 py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
                {h.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-[var(--theme-text)]">{h.name}</div>
                <div className="text-xs text-[var(--theme-muted)]">{h.role} · {h.dept}</div>
              </div>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">hired</span>
              <span className="text-[10px] text-[var(--theme-muted)]">oleh {h.hired_by} · {fmtTime(h.hired_at ?? h.created_at)}</span>
            </div>
          ))}
          {hired.length === 0 && <div className="text-xs text-[var(--theme-muted)]">Belum ada yang di-hire.</div>}
        </div>
      </div>
    </div>
  )
}
