import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'

const BASE = 'http://127.0.0.1:3121'
const OFFICE_TOKEN = process.env.MYOFFICE_API_TOKEN || ''

async function proxy(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(8000),
    headers: {
      'Content-Type': 'application/json',
      ...(OFFICE_TOKEN ? { 'X-Office-Token': OFFICE_TOKEN } : {}),
      ...(init?.headers ?? {}),
    },
  })
  return res.json()
}

export const Route = createFileRoute('/api/office')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const url = new URL(request.url)
          const resource = url.searchParams.get('resource') ?? 'approvals'
          const action = url.searchParams.get('action')
          if (resource === 'notifications' || resource === 'inbox' || resource === 'messages' || resource === 'broadcast' || resource === 'parliament' || resource === 'mcp' || resource === 'uptime') {
            const data = await proxy(`${BASE}/office/${resource}`)
            return json({ ok: true, ...data })
          }
          if (resource === 'auth' && action === 'me') {
            const data = await proxy(`${BASE}/office/auth/me`)
            return json({ ok: true, ...data })
          }
          if (resource === 'board' && action === 'config') {
            const data = await proxy(`${BASE}/office/board/config`)
            return json({ ok: true, ...data })
          }
          if (resource === 'auth' && action === 'users') {
            const data = await proxy(`${BASE}/office/auth/users`)
            return json({ ok: true, ...data })
          }
          url.searchParams.delete('resource')
          const qs = url.searchParams.toString()
          const target = `${BASE}/office/${resource}${qs ? '?' + qs : ''}`
          const data = await proxy(target)
          return json({ ok: true, ...data })
        } catch (err) {
          return json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 502 },
          )
        }
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const url = new URL(request.url)
          const resource = url.searchParams.get('resource') ?? 'approvals'
          const action = url.searchParams.get('action') ?? 'submit'
          const body = await request.json().catch(() => ({}))

          let target = ''
          if (resource === 'approvals' && action === 'decide' && body.id) {
            target = `${BASE}/office/approvals/${body.id}/decision`
          } else if (resource === 'approvals') {
            target = `${BASE}/office/approvals`
          } else if (resource === 'handoffs' && action === 'done' && body.id) {
            target = `${BASE}/office/handoffs/${body.id}/done`
          } else if (resource === 'handoffs') {
            target = `${BASE}/office/handoffs`
          } else if (resource === 'controls' && action === 'agent') {
            target = `${BASE}/office/controls/agent`
          } else if (resource === 'controls' && action === 'global') {
            target = `${BASE}/office/controls/global`
          } else if (resource === 'controls') {
            target = `${BASE}/office/controls`
          } else if (resource === 'reviews') {
            target = `${BASE}/office/reviews`
          } else if (resource === 'onboarding' && action === 'draft') {
            target = `${BASE}/office/onboarding/draft`
          } else if (resource === 'onboarding' && action === 'hire' && body.id) {
            target = `${BASE}/office/onboarding/draft/${body.id}/hire`
          } else if (resource === 'onboarding') {
            target = `${BASE}/office/onboarding`
          } else if (resource === 'vacation' && action === 'end' && body.id) {
            target = `${BASE}/office/vacation/${body.id}/end`
          } else if (resource === 'vacation') {
            target = `${BASE}/office/vacation`
          } else if (resource === 'org' && action === 'update') {
            target = `${BASE}/office/org`
          } else if (resource === 'quality') {
            target = `${BASE}/office/quality`
          } else if (resource === 'caps') {
            target = `${BASE}/office/caps`
          } else if (resource === 'geofence') {
            target = `${BASE}/office/geofence`
          } else if (resource === 'branding') {
            target = `${BASE}/office/branding`
          } else if (resource === 'board' && action === 'move' && body.id) {
            target = `${BASE}/office/board/${body.id}/move`
          } else if (resource === 'board' && action === 'rules') {
            target = `${BASE}/office/board/rules`
          } else if (resource === 'board' && action === 'templates' && body.applyId) {
            target = `${BASE}/office/board/templates/${body.applyId}/apply`
          } else if (resource === 'board' && action === 'templates') {
            target = `${BASE}/office/board/templates`
          } else if (resource === 'board') {
            target = `${BASE}/office/board`
          } else if (resource === 'messages') {
            target = `${BASE}/office/messages`
          } else if (resource === 'broadcast') {
            target = `${BASE}/office/broadcast`
          } else if (resource === 'parliament') {
            target = `${BASE}/office/parliament`
          } else if (resource === 'mcp') {
            target = `${BASE}/office/mcp`
          } else if (resource === 'fleet' && action === 'refresh') {
            target = `${BASE}/office/fleet/refresh`
          } else if (resource === 'shift' && action === 'config') {
            target = `${BASE}/office/shift/config`
          } else if (resource === 'board' && action === 'config') {
            target = `${BASE}/office/board/config`
          } else if (resource === 'playbook' && action === 'delete' && body.id) {
            target = `${BASE}/office/playbook/${body.id}`
          } else if (resource === 'playbook') {
            target = `${BASE}/office/playbook`
          } else if (resource === 'incidents' && action === 'resolve' && body.id) {
            target = `${BASE}/office/incidents/${body.id}/resolve`
          } else if (resource === 'incidents' && action === 'check') {
            target = `${BASE}/office/incidents/check`
          } else if (resource === 'incidents') {
            target = `${BASE}/office/incidents`
          } else if (resource === 'auth' && action === 'login') {
            target = `${BASE}/office/auth/login`
          } else if (resource === 'auth' && action === 'users' && body.deleteUsername) {
            target = `${BASE}/office/auth/users/delete`
          } else if (resource === 'auth' && action === 'users') {
            target = `${BASE}/office/auth/users`
          } else if (resource === 'auth' && action === 'password') {
            target = `${BASE}/office/auth/password`
          } else if (resource === 'report') {
            target = `${BASE}/office/report`
          } else if (resource === 'tickets' && action === 'action' && body.id) {
            target = `${BASE}/office/tickets/${body.id}/action`
          } else if (resource === 'tickets') {
            target = `${BASE}/office/tickets`
          } else if (resource === 'memory' && action === 'refresh-contexts') {
            target = `${BASE}/office/memory/refresh-contexts`
          } else if (resource === 'memory' && action === 'daily') {
            target = `${BASE}/office/memory/daily`
          } else if (resource === 'memory' && action === 'dreaming') {
            target = `${BASE}/office/memory/dreaming`
          } else if (resource === 'memory' && action === 'audit') {
            target = `${BASE}/office/memory/audit`
          } else if (resource === 'memory') {
            target = `${BASE}/office/memory`
          } else {
            return json({ ok: false, error: `unsupported ${resource}/${action}` }, { status: 400 })
          }

          const data = await proxy(target, { method: 'POST', body: JSON.stringify(body) })
          return json({ ok: true, ...data })
        } catch (err) {
          return json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 502 },
          )
        }
      },
      DELETE: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const url = new URL(request.url)
          const id = url.searchParams.get('id')
          const resource = url.searchParams.get('resource') ?? 'onboarding'
          if (resource === 'onboarding' && id) {
            const data = await proxy(`${BASE}/office/onboarding/draft/${id}`, { method: 'DELETE' })
            return json({ ok: true, ...data })
          }
          if (resource === 'board' && id) {
            const data = await proxy(`${BASE}/office/board/${id}`, { method: 'DELETE' })
            return json({ ok: true, ...data })
          }
          if (resource === 'board_rules' && id) {
            const data = await proxy(`${BASE}/office/board/rules/${id}`, { method: 'DELETE' })
            return json({ ok: true, ...data })
          }
          if (resource === 'board_templates' && id) {
            const data = await proxy(`${BASE}/office/board/templates/${id}`, { method: 'DELETE' })
            return json({ ok: true, ...data })
          }
          if (resource === 'memory' && id) {
            const data = await proxy(`${BASE}/office/memory/${id}`, { method: 'DELETE' })
            return json({ ok: true, ...data })
          }
          return json({ ok: false, error: 'unsupported DELETE' }, { status: 400 })
        } catch (err) {
          return json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 502 },
          )
        }
      },
    },
  },
})
