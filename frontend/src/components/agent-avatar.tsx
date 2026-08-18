import { cn } from '@/lib/utils'

const AGENT_COLOR: Record<string, string> = {
  rena: 'bg-indigo-600 text-white',
  farrah: 'bg-violet-600 text-white',
  nadine: 'bg-sky-600 text-white',
  aaron: 'bg-emerald-600 text-white',
  dinda: 'bg-amber-600 text-white',
  unknown: 'bg-neutral-600 text-white',
}

type Props = {
  id: string
  name: string
  avatar?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZES = {
  sm: 'size-7 text-xs rounded-full',
  md: 'size-9 text-sm rounded-full',
  lg: 'size-12 text-lg rounded-xl',
}

/** Avatar agent — pakai gambar kalau field avatar ada, fallback inisial berwarna. */
export function AgentAvatar({ id, name, avatar, size = 'md', className }: Props) {
  const initials = (name || id || '?').charAt(0).toUpperCase()
  if (avatar) {
    return (
      <img
        src={avatar}
        alt={name || id}
        className={cn(SIZES[size], 'shrink-0 object-cover', className)}
      />
    )
  }
  return (
    <div
      className={cn(
        SIZES[size],
        'flex shrink-0 items-center justify-center font-bold',
        AGENT_COLOR[id] ?? AGENT_COLOR.unknown,
        className,
      )}
    >
      {initials}
    </div>
  )
}
