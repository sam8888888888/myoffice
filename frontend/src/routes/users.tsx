import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

export const Route = createFileRoute('/users')({
  component: UsersScreen,
})

type UserRow = { username: string; name: string; role: string; created_at?: string }

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', manager: 'Manager', viewer: 'Viewer' }
const ROLE_COLOR: Record<string, string> = {
  admin: 'bg-red-500/15 text-red-300',
  manager: 'bg-amber-500/15 text-amber-300',
  viewer: 'bg-sky-500/15 text-sky-300',
}

function UsersScreen() {
  const qc = useQueryClient()
  const [uName, setUName] = useState('')
  const [uPass, setUPass] = useState('')
  const [uFull, setUFull] = useState('')
  const [uRole, setURole] = useState('viewer')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const meQuery = useQuery({
    queryKey: ['auth-me'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=auth&action=me')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()).user as { username: string; role: string; name?: string }
    },
  })

  const usersQuery = useQuery({
    queryKey: ['auth-users'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=auth&action=users')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()).users as UserRow[]
    },
    enabled: meQuery.data?.role === 'admin',
  })

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/office?resource=auth&action=users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: uName, password: uPass, name: uFull, role: uRole }),
      })
      if (!res.ok) throw new Error(((await res.json()).error) ?? `HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => {
      setMsg(`User ${uName} dibuat`)
      setUName(''); setUPass(''); setUFull(''); setURole('viewer')
      setErr(null)
      qc.invalidateQueries({ queryKey: ['auth-users'] })
      setTimeout(() => setMsg(null), 4000)
    },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Gagal membuat user'),
  })

  const del = useMutation({
    mutationFn: async (username: string) => {
      const res = await fetch('/api/office?resource=auth&action=users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteUsername: username }),
      })
      if (!res.ok) throw new Error(((await res.json()).error) ?? `HTTP ${res.status}`)
    },
    onSuccess: () => {
      setMsg('User dihapus')
      qc.invalidateQueries({ queryKey: ['auth-users'] })
      setTimeout(() => setMsg(null), 4000)
    },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Gagal hapus'),
  })

  const role = meQuery.data?.role
  const isAdmin = role === 'admin'

  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--theme-text)]">👥 Users & Roles</h1>
          <p className="mt-1 text-sm text-[var(--theme-muted)]">
            Kelola akses: Admin / Manager / Viewer
          </p>
        </div>
        <span className="rounded-full bg-[var(--theme-card2)] px-3 py-1 text-xs font-medium text-[var(--theme-text-muted)]">
          Masuk sebagai <b>{meQuery.data?.username ?? '…'}</b> · {role ? ROLE_LABEL[role] : '…'}
        </span>
      </div>

      {msg && <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{msg}</div>}
      {err && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}

      {!isAdmin ? (
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-6 text-sm text-[var(--theme-muted)]">
          🔒 Halaman ini khusus <b>Admin</b>. Role Anda: <b>{role ? ROLE_LABEL[role] : '…'}</b>.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Daftar user */}
          <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--theme-text)]">Daftar User</h2>
            <div className="space-y-2">
              {(usersQuery.data ?? []).map((u) => (
                <div key={u.username} className="flex items-center justify-between rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-2">
                  <div>
                    <div className="text-sm font-medium text-[var(--theme-text)]">{u.name || u.username}</div>
                    <div className="text-[11px] text-[var(--theme-muted)]">@{u.username}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ROLE_COLOR[u.role] ?? ''}`}>
                      {ROLE_LABEL[u.role] ?? u.role}
                    </span>
                    {u.username !== 'admin' && (
                      <button
                        onClick={() => del.mutate(u.username)}
                        className="rounded-md border border-red-500/30 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/10"
                      >
                        Hapus
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tambah user */}
          <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--theme-text)]">Tambah User</h2>
            <div className="space-y-3">
              <input value={uName} onChange={(e) => setUName(e.target.value)} placeholder="Username" className="w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]" />
              <input value={uFull} onChange={(e) => setUFull(e.target.value)} placeholder="Nama lengkap (opsional)" className="w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]" />
              <input value={uPass} onChange={(e) => setUPass(e.target.value)} type="password" placeholder="Password (min 6 karakter)" className="w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]" />
              <select value={uRole} onChange={(e) => setURole(e.target.value)} className="w-full rounded-lg border border-[var(--theme-input)] bg-[var(--theme-card2)] px-3 py-2 text-sm text-[var(--theme-text)]">
                <option value="viewer">Viewer — lihat saja</option>
                <option value="manager">Manager — lihat + approve</option>
                <option value="admin">Admin — semua akses</option>
              </select>
              <button
                onClick={() => create.mutate()}
                disabled={!uName || !uPass || create.isPending}
                className="w-full rounded-lg bg-accent-500 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 disabled:opacity-40"
              >
                {create.isPending ? 'Menyimpan…' : '＋ Buat User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
