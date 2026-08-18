import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

export const Route = createFileRoute('/vault')({
  component: VaultScreen,
})

type VaultFile = {
  name: string
  path: string
  dir: string
  size: number
  mtime: string
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function VaultScreen() {
  const [active, setActive] = useState<VaultFile | null>(null)
  const [filter, setFilter] = useState<'all' | 'vault' | 'data'>('all')
  const [versions, setVersions] = useState<Array<{ version: string; ts: string; size: number }>>([])
  const [showVersions, setShowVersions] = useState(false)
  const [versionMsg, setVersionMsg] = useState<string | null>(null)

  const loadVersions = async (path: string) => {
    try {
      const res = await fetch(`/api/office?resource=vault&action=versions&path=${encodeURIComponent(path)}`)
      const d = await res.json()
      setVersions(d.versions ?? [])
      setShowVersions(true)
      setVersionMsg(null)
    } catch (e) {
      setVersionMsg(`⚠️ ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const doRestore = async (version: string) => {
    if (!active || !confirm(`Kembalikan ${active.path} ke versi ${version.slice(0, 20)}?`)) return
    try {
      const res = await fetch(
        `/api/office?resource=vault&action=restore&path=${encodeURIComponent(active.path)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version }),
        },
      )
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || 'gagal')
      setVersionMsg('✅ File dikembalikan')
      setShowVersions(false)
      listQuery.refetch()
      readQuery.refetch()
    } catch (e) {
      setVersionMsg(`⚠️ ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const listQuery = useQuery({
    queryKey: ['vault'],
    queryFn: async () => {
      const res = await fetch('/api/office?resource=vault')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return (data.files ?? []) as Array<VaultFile>
    },
    staleTime: 3000,
    refetchInterval: 15000,
  })

  const readQuery = useQuery({
    queryKey: ['vault-read', active?.path],
    queryFn: async () => {
      if (!active) return null
      const res = await fetch(`/api/office?resource=vault&action=read&path=${encodeURIComponent(active.path)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return data as { ok: boolean; name?: string; content?: string; error?: string }
    },
    enabled: !!active,
    staleTime: 5000,
  })

  const files = listQuery.data ?? []
  const shown = filter === 'all' ? files : files.filter((f) => f.dir === filter)

  return (
    <div className="min-h-full px-4 py-4 md:px-8 md:py-6 lg:px-10">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-[var(--theme-text)]">Vault &amp; Data</h1>
        <p className="mt-1 text-sm text-[var(--theme-muted)]">
          File browser — hasil kerja (standup, handoff) &amp; store data MyOffice.
        </p>
        <div className="mt-3 flex rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] p-0.5 text-sm w-fit">
          {(['all', 'vault', 'data'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`rounded-md px-3 py-1.5 font-medium capitalize ${
                filter === t ? 'bg-[var(--theme-accent)] text-white' : 'text-[var(--theme-muted)] hover:bg-[var(--theme-hover)]'
              }`}
            >
              {t === 'all' ? `Semua (${files.length})` : t}
            </button>
          ))}
        </div>
      </div>

      {listQuery.isError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Gagal memuat file: {String(listQuery.error)}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* list */}
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-2">
          <div className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--theme-muted)]">
            File ({shown.length})
          </div>
          <div className="max-h-[560px] space-y-1 overflow-y-auto">
            {shown.map((f) => (
              <button
                key={`${f.dir}/${f.path}`}
                onClick={() => setActive(f)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  active?.path === f.path && active.dir === f.dir
                    ? 'bg-[var(--theme-accent)] text-white'
                    : 'text-[var(--theme-text)] hover:bg-[var(--theme-hover)]'
                }`}
              >
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                  f.dir === 'vault' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'
                }`}>
                  {f.dir}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.path}</span>
                <span className="shrink-0 text-[10px] text-[var(--theme-muted)]">{fmtSize(f.size)}</span>
              </button>
            ))}
            {shown.length === 0 && !listQuery.isError && (
              <div className="py-10 text-center text-[var(--theme-muted)]">Belum ada file.</div>
            )}
          </div>
        </div>

        {/* preview */}
        <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)]">
          <div className="border-b border-[var(--theme-border)] px-4 py-2.5 text-xs font-semibold text-[var(--theme-muted)]">
            {active ? (
              <span className="flex items-center gap-2">
                <span className="font-mono text-[var(--theme-text)]">{active.path}</span>
                <button
                  onClick={() => void loadVersions(active.path)}
                  title="Riwayat versi file"
                  className="ml-2 rounded border border-[var(--theme-border)] px-2 py-0.5 text-[10px] text-[var(--theme-text-muted)] hover:bg-[var(--theme-card2)]"
                >
                  🕘 {versions.length > 0 ? versions.length : ''}
                </button>
                {active && (
                  <button
                    onClick={() => setActive(null)}
                    className="ml-auto text-xs text-[var(--theme-muted)] hover:text-red-500"
                  >
                    ✕ tutup
                  </button>
                )}
                <span className="text-[var(--theme-muted)]">{fmtSize(active.size)} · {active.mtime}</span>
              </span>
            ) : (
              'Pilih file untuk preview'
            )}
          </div>
          <div className="max-h-[520px] overflow-auto p-4">
            {readQuery.isLoading && <div className="text-sm text-[var(--theme-muted)]">Memuat…</div>}
            {readQuery.isError && (
              <div className="text-sm text-red-600">Gagal membaca: {String(readQuery.error)}</div>
            )}
            {readQuery.data?.error && (
              <div className="text-sm text-red-600">{readQuery.data.error}</div>
            )}
            {readQuery.data?.content && (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-[var(--theme-text)]">
                {readQuery.data.content}
              </pre>
            )}
          </div>
        </div>
      </div>

      {versionMsg && (
        <div className="mt-4 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-4 py-3 text-sm text-[var(--theme-text)]">
          {versionMsg}
        </div>
      )}

      {showVersions && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowVersions(false)}>
          <div className="w-full max-w-lg rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-[var(--theme-text)]">🕘 Riwayat Versi File</h3>
              <button onClick={() => setShowVersions(false)} className="rounded-lg px-2 py-1 text-[var(--theme-muted)] hover:bg-[var(--theme-card2)]">✕</button>
            </div>
            {versions.length === 0 ? (
              <div className="rounded-lg bg-[var(--theme-card2)] px-3 py-6 text-center text-sm text-[var(--theme-muted)]">
                Belum ada versi. Versi dibuat otomatis saat file ditimpa.
              </div>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {versions
                  .slice()
                  .reverse()
                  .map((v) => (
                    <div key={v.version} className="flex items-center justify-between rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-card2)] px-3 py-2 text-sm">
                      <span className="font-mono text-xs text-[var(--theme-text)]">{v.ts}</span>
                      <button
                        onClick={() => doRestore(v.version)}
                        className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500"
                      >
                        ↩ Restore
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
