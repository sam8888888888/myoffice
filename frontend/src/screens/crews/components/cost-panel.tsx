'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { BarChartIcon, CoinsIcon, Delete01Icon } from '@hugeicons/core-free-icons'
import { fetchCrewUsage, resetUsage } from '@/lib/cost-api'
import type { CrewUsage } from '@/lib/cost-api'
import type { CrewMember } from '@/lib/crews-api'
import { AGENT_PERSONAS } from '@/lib/agent-personas'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

interface CostPanelProps {
  crewId: string
  members: CrewMember[]
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.0001) return '< $0.0001'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(4)}`
}

function KpiCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string
  value: string
  icon: React.ReactNode
  accent?: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-4 py-3">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--theme-muted)]">
          {label}
        </span>
      </div>
      <span
        className="text-xl font-bold tabular-nums"
        style={{ color: accent ?? 'var(--theme-text)' }}
      >
        {value}
      </span>
    </div>
  )
}

function UsageTable({
  usage,
  members,
}: {
  usage: CrewUsage
  members: CrewMember[]
}) {
  const memberMap = Object.fromEntries(members.map((m) => [m.sessionKey, m]))
  const rows = Object.values(usage.members).sort(
    (a, b) => b.lastUpdatedAt - a.lastUpdatedAt,
  )
  const hasZeroRows = rows.some(
    (r) => r.inputTokens === 0 && r.outputTokens === 0,
  )

  return (
    <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] overflow-hidden">
      {/* Table header */}
      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 border-b border-[var(--theme-border)] px-4 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-muted)]">
          Agent
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-muted)] text-right">
          Model
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-muted)] text-right">
          Input
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-muted)] text-right">
          Output
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-muted)] text-right">
          Est. Cost
        </span>
      </div>

      {/* Rows */}
      {rows.map((row) => {
        const member = memberMap[row.sessionKey]
        const persona = AGENT_PERSONAS.find(
          (p) => p.name.toLowerCase() === member?.model?.toLowerCase() ||
                 member?.displayName.toLowerCase().includes(p.name.toLowerCase()),
        )
        const noData = row.inputTokens === 0 && row.outputTokens === 0
        const modelLabel = row.model
          ? row.model.length > 18
            ? row.model.slice(0, 16) + '…'
            : row.model
          : null

        return (
          <div
            key={row.sessionKey}
            className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 border-b border-[var(--theme-border)] px-4 py-2.5 last:border-b-0 hover:bg-[var(--theme-hover)]"
          >
            <span
              className={cn(
                'text-xs font-medium',
                member?.color ?? 'text-[var(--theme-text)]',
              )}
            >
              {row.displayName}
            </span>
            <span className="text-right">
              {modelLabel ? (
                <span className="rounded-full border border-[var(--theme-border)] px-1.5 py-px text-[10px] text-[var(--theme-muted)]">
                  {modelLabel}
                </span>
              ) : (
                <span className="text-xs text-[var(--theme-muted)]">—</span>
              )}
            </span>
            <span className="text-right text-xs tabular-nums text-[var(--theme-text)]">
              {noData ? '—' : formatTokens(row.inputTokens)}
            </span>
            <span className="text-right text-xs tabular-nums text-[var(--theme-text)]">
              {noData ? '—' : formatTokens(row.outputTokens)}
            </span>
            <span className="text-right text-xs tabular-nums text-[var(--theme-text)]">
              {noData ? '—' : formatCost(row.estimatedCostUsd)}
            </span>
          </div>
        )
      })}

      {hasZeroRows && (
        <div className="px-4 py-2 text-[10px] text-[var(--theme-muted)]">
          Entries showing — require Hermes enhanced mode. Token data is not
          available in portable mode.
        </div>
      )}
    </div>
  )
}

export function CostPanel({ crewId, members }: CostPanelProps) {
  const queryClient = useQueryClient()

  const usageQuery = useQuery({
    queryKey: ['crew-usage', crewId],
    queryFn: () => fetchCrewUsage(crewId),
    refetchInterval: 30_000,
  })

  const resetMutation = useMutation({
    mutationFn: () => resetUsage(crewId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['crew-usage', crewId] })
      toast('Usage data cleared')
    },
    onError: () => toast('Failed to clear usage', { type: 'error' }),
  })

  const usage = usageQuery.data

  if (usageQuery.isLoading) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-[var(--theme-muted)]">
        Loading usage…
      </div>
    )
  }

  if (!usage) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)]">
          <HugeiconsIcon
            icon={BarChartIcon}
            size={22}
            className="text-[var(--theme-muted)]"
          />
        </div>
        <div>
          <p className="text-sm font-medium text-[var(--theme-text)]">
            No usage data yet
          </p>
          <p className="mt-1 max-w-xs text-xs text-[var(--theme-muted)]">
            Token counts are captured after each agent run completes.
            Requires Hermes enhanced mode.
          </p>
        </div>
      </div>
    )
  }

  const totalTokens = usage.totalInputTokens + usage.totalOutputTokens

  return (
    <div className="h-full overflow-y-auto space-y-5 p-6">
      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-3">
        <KpiCard
          label="Total Tokens"
          value={formatTokens(totalTokens)}
          icon={
            <HugeiconsIcon
              icon={BarChartIcon}
              size={12}
              strokeWidth={1.8}
              className="text-[var(--theme-muted)]"
            />
          }
        />
        <KpiCard
          label="Input / Output"
          value={`${formatTokens(usage.totalInputTokens)} / ${formatTokens(usage.totalOutputTokens)}`}
          icon={
            <HugeiconsIcon
              icon={BarChartIcon}
              size={12}
              strokeWidth={1.8}
              className="text-[var(--theme-muted)]"
            />
          }
        />
        <KpiCard
          label="Est. Total Cost"
          value={formatCost(usage.totalEstimatedCostUsd)}
          accent={
            usage.totalEstimatedCostUsd > 0
              ? 'var(--theme-accent)'
              : undefined
          }
          icon={
            <HugeiconsIcon
              icon={CoinsIcon}
              size={12}
              strokeWidth={1.8}
              className="text-[var(--theme-muted)]"
            />
          }
        />
      </div>

      {/* Per-member table */}
      <div>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--theme-muted)]">
          Per-Agent Breakdown
        </h2>
        <UsageTable usage={usage} members={members} />
      </div>

      {/* Footer: reset + notes */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-[var(--theme-muted)]">
          Cumulative since session start.{' '}
          <span title="Prices sourced from provider published rates. Estimates only.">
            Costs are estimates.
          </span>
        </p>
        <button
          onClick={() => resetMutation.mutate()}
          disabled={resetMutation.isPending}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--theme-border)] px-2.5 py-1.5 text-[10px] text-[var(--theme-muted)] transition-colors hover:border-[var(--theme-danger)] hover:text-[var(--theme-danger)] disabled:opacity-50"
        >
          <HugeiconsIcon icon={Delete01Icon} size={11} />
          Clear usage
        </button>
      </div>
    </div>
  )
}
