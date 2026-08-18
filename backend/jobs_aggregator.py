#!/usr/bin/env python3
"""MyOffice Jobs Aggregator — polling jobs SEMUA agent (Hermes cron + SAMCODER schedule/autonomous)
& expose JSON + aksi edit. Port 3122 (localhost only).

Endpoints:
  GET  /jobs.json        → {'updated', 'agents': [{id,name,server,type,jobs/...}]}
  POST /action           → {agent, action, jobId?, payload?}  (terusan ke gateway agent)
  GET  /health
"""
import json
import os
import threading
import time
import urllib.request
import urllib.parse
import urllib.error
import http.cookiejar
import http.server

KEYS_FILE = '/opt/myoffice/gateway_keys.env'
KEYS = {}
if os.path.exists(KEYS_FILE):
    for line in open(KEYS_FILE):
        line = line.strip()
        if '=' in line:
            k, _, v = line.partition('=')
            KEYS[k.strip()] = v.strip()

GATEWAYS = [
    {'id': 'rena',   'name': 'Rena',   'server': 'Hostinger', 'url': 'http://127.0.0.1:8642',  'key': KEYS.get('RENA', '')},
    {'id': 'farrah', 'name': 'Farrah', 'server': 'Contabo',   'url': 'http://127.0.0.1:18642', 'key': KEYS.get('FARRAH', '')},
    {'id': 'nadine', 'name': 'Nadine', 'server': 'Contabo',   'url': 'http://127.0.0.1:18643', 'key': KEYS.get('NADINE', '')},
    {'id': 'aaron',  'name': 'Aaron',  'server': 'OVH',       'url': 'http://127.0.0.1:18644', 'key': KEYS.get('AARON', '')},
]

SAMCODER = {
    'id': 'dinda', 'name': 'Dinda', 'server': 'Contabo',
    'url': 'https://coder.sam.university',
    'user': KEYS.get('SAMCODER_USER', ''), 'pass': KEYS.get('SAMCODER_PASS', ''),
}

POLL_INTERVAL = 30  # detik
state = {'updated': None, 'agents': []}
_samcoder_session_id = None  # sesi SAMCODER yang dipakai polling (agar schedule terbaca)


def office_token():
    """Token akses service: env MYOFFICE_API_TOKEN, fallback /opt/myoffice/.env (pola office_backend)."""
    t = os.environ.get("MYOFFICE_API_TOKEN")
    if t:
        return t
    try:
        with open('/opt/myoffice/.env', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line.startswith('MYOFFICE_API_TOKEN='):
                    return line.split('=', 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return ''


def _authed(handler):
    """Validasi X-Office-Token. Kalau token belum di-set → allow (mode dev)."""
    token = office_token()
    if not token:
        return True
    provided = handler.headers.get('X-Office-Token', '')
    return provided == token


def http_json(url, key=None, timeout=10, method='GET', data=None, headers=None):
    h = dict(headers or {})
    if key:
        h['Authorization'] = 'Bearer ' + key
    body = None
    if data is not None:
        h['Content-Type'] = 'application/json'
        body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode('utf-8', 'replace')
        try:
            return json.loads(raw)
        except Exception:
            return {'raw': raw}


# ---------- Normalisasi ----------

def norm_hermes_job(j):
    return {
        'type': 'hermes',
        'id': j.get('id'),
        'name': j.get('name'),
        'prompt': j.get('prompt', ''),
        'schedule_display': j.get('schedule_display') or j.get('schedule', ''),
        'schedule': j.get('schedule'),
        'enabled': bool(j.get('enabled')),
        'state': j.get('state'),
        'next_run_at': j.get('next_run_at'),
        'last_run_at': j.get('last_run_at'),
        'last_status': j.get('last_status'),
        'last_error': j.get('last_error'),
        'no_agent': bool(j.get('no_agent')),
        'script': j.get('script'),
        'skills': j.get('skills') or [],
        'repeat': j.get('repeat'),
        'deliver': j.get('deliver'),
        'origin': j.get('origin'),
        'created_at': j.get('created_at'),
        'model': j.get('model'),
    }


def poll_hermes_jobs(gw):
    try:
        data = http_json(gw['url'] + '/api/jobs?include_disabled=true', gw['key'], timeout=10)
        jobs = data.get('jobs', []) if isinstance(data, dict) else []
        return {'id': gw['id'], 'name': gw['name'], 'server': gw['server'], 'type': 'hermes',
                'jobs': [norm_hermes_job(j) for j in jobs], 'error': None}
    except Exception as e:
        return {'id': gw['id'], 'name': gw['name'], 'server': gw['server'], 'type': 'hermes',
                'jobs': [], 'error': str(e)}


def _samcoder_login():
    """Login ke hub SAMCODER, return opener + data login."""
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    opener.addheaders = [('User-Agent', 'Mozilla/5.0 (MyOffice Jobs Aggregator)')]
    req = urllib.request.Request(
        SAMCODER['url'] + '/api/login',
        data=json.dumps({'username': SAMCODER['user'], 'password': SAMCODER['pass']}).encode(),
        headers={'Content-Type': 'application/json'}, method='POST')
    with opener.open(req, timeout=12) as r:
        login = json.loads(r.read().decode())
    if not login.get('ok'):
        raise Exception('SAMCODER login gagal')
    return opener


def _samcoder_ensure_session(opener):
    """Pastikan ada sesi aktif (schedules butuh sesi). Buat SEKALI kalau kosong."""
    global _samcoder_session_id
    try:
        with opener.open(SAMCODER['url'] + '/api/sessions', timeout=10) as r:
            d = json.loads(r.read().decode())
        sess = d.get('sessions', [])
        if sess:
            _samcoder_session_id = sess[-1].get('id') or sess[-1].get('sessionId')
            return _samcoder_session_id
        # buat sesi baru (spawn agent — hanya jika benar-benar tidak ada)
        req = urllib.request.Request(
            SAMCODER['url'] + '/api/sessions',
            data=json.dumps({'name': 'MyOffice Jobs'}).encode(),
            headers={'Content-Type': 'application/json'}, method='POST')
        with opener.open(req, timeout=15) as r:
            created = json.loads(r.read().decode())
        sid = (created.get('session') or {}).get('id')
        _samcoder_session_id = sid
        return sid
    except Exception:
        return _samcoder_session_id


def norm_samcoder_schedule(j):
    sched = j.get('schedule')
    if isinstance(sched, dict):
        sched_disp = sched.get('expression') or sched.get('kind') or json.dumps(sched)
    else:
        sched_disp = sched
    return {
        'type': 'dinda-schedule',
        'id': j.get('id') or j.get('jobId'),
        'name': j.get('name') or j.get('title') or ('Jadwal ' + str(j.get('id', ''))[:8]),
        'prompt': j.get('prompt') or j.get('goal') or '',
        'schedule_display': sched_disp,
        'schedule': sched,
        'enabled': bool(j.get('enabled', True)),
        'state': j.get('status') or ('scheduled' if j.get('enabled', True) else 'paused'),
        'next_run_at': j.get('nextRun') or j.get('next_run_at'),
        'last_run_at': j.get('lastRun') or j.get('last_run_at'),
        'last_status': j.get('lastStatus') or j.get('last_status'),
        'repeat': None, 'deliver': None, 'origin': None,
    }


def norm_samcoder_auto(j):
    if not j:
        return None
    return {
        'type': 'dinda-autonomous',
        'id': 'auto-' + str(j.get('startedAt', '')),
        'name': 'Mode Otonom',
        'prompt': j.get('goal', ''),
        'schedule_display': 'kerja kontinu (checkpoint)',
        'schedule': None,
        'enabled': j.get('status') == 'running',
        'state': j.get('status'),
        'next_run_at': None,
        'last_run_at': j.get('startedAt'),
        'last_status': j.get('status'),
        'turns': j.get('turns'),
        'maxTurns': j.get('maxTurns'),
        'tokenUsed': j.get('tokenUsed'),
        'maxTokens': j.get('maxTokens'),
        'lastOutput': (j.get('lastOutput') or '')[:300],
        'prevStatus': j.get('prevStatus'),
    }


def poll_samcoder_jobs():
    try:
        opener = _samcoder_login()
        _samcoder_ensure_session(opener)
        out = {'id': SAMCODER['id'], 'name': SAMCODER['name'], 'server': SAMCODER['server'],
               'type': 'samcoder', 'jobs': [], 'error': None}
        try:
            with opener.open(SAMCODER['url'] + '/api/schedules', timeout=10) as r:
                d = json.loads(r.read().decode())
            sch = d.get('jobs', []) if isinstance(d, dict) else []
            for j in sch:
                out['jobs'].append(norm_samcoder_schedule(j))
        except Exception as e:
            out['error'] = ('schedules: ' + str(e)) if not out['error'] else out['error'] + '; schedules: ' + str(e)
        try:
            with opener.open(SAMCODER['url'] + '/api/autonomous', timeout=10) as r:
                d = json.loads(r.read().decode())
            auto = d.get('job') if isinstance(d, dict) else None
            if auto:
                n = norm_samcoder_auto(auto)
                if n:
                    out['jobs'].append(n)
        except Exception as e:
            out['error'] = (out['error'] + '; ' if out['error'] else '') + 'autonomous: ' + str(e)
        return out
    except Exception as e:
        return {'id': SAMCODER['id'], 'name': SAMCODER['name'], 'server': SAMCODER['server'],
                'type': 'samcoder', 'jobs': [], 'error': str(e)}


def refresh():
    agents = [poll_hermes_jobs(g) for g in GATEWAYS]
    agents.append(poll_samcoder_jobs())
    state['agents'] = agents
    state['updated'] = time.time()


# ---------- Aksi ----------

def action_hermes(gw, action, job_id, payload):
    base = gw['url']
    if action == 'create':
        return http_json(base + '/api/jobs', gw['key'], method='POST', data=payload or {})
    if action == 'update':
        return http_json(base + '/api/jobs/' + urllib.parse.quote(job_id), gw['key'], method='PATCH', data=payload or {})
    if action == 'pause':
        return http_json(base + '/api/jobs/' + urllib.parse.quote(job_id) + '/pause', gw['key'], method='POST')
    if action == 'resume':
        return http_json(base + '/api/jobs/' + urllib.parse.quote(job_id) + '/resume', gw['key'], method='POST')
    if action == 'run':
        return http_json(base + '/api/jobs/' + urllib.parse.quote(job_id) + '/run', gw['key'], method='POST')
    if action == 'delete':
        return http_json(base + '/api/jobs/' + urllib.parse.quote(job_id), gw['key'], method='DELETE')
    if action in ('pause_all', 'resume_all'):
        # bulk: loop semua job, hanya yang statusnya cocok
        verb = 'pause' if action == 'pause_all' else 'resume'
        data = http_json(base + '/api/jobs?include_disabled=true', gw['key'])
        jobs = data.get('jobs', []) if isinstance(data, dict) else []
        done = 0
        errors = []
        for j in jobs:
            target_state = 'paused' if action == 'pause_all' else 'scheduled'
            cur = j.get('state')
            if action == 'pause_all' and cur == 'paused':
                continue
            if action == 'resume_all' and cur != 'paused' and j.get('enabled'):
                continue
            try:
                http_json(base + '/api/jobs/' + urllib.parse.quote(j.get('id')) + '/' + verb, gw['key'], method='POST')
                done += 1
            except Exception as e:
                errors.append(str(e))
        return {'bulk': True, 'action': action, 'applied': done, 'errors': errors}
    raise ValueError('aksi tidak dikenal: ' + action)


def action_samcoder(action, job_id, payload):
    opener = _samcoder_login()
    _samcoder_ensure_session(opener)
    if action == 'create':
        return http_json(SAMCODER['url'] + '/api/schedules', None, method='POST',
                         data={'schedule': (payload or {}).get('schedule', ''), 'prompt': (payload or {}).get('prompt', '')},
                         headers={'Cookie': _cookie_str(opener)})
    if action == 'delete':
        return http_json(SAMCODER['url'] + '/api/schedules/' + urllib.parse.quote(job_id), None, method='DELETE',
                         headers={'Cookie': _cookie_str(opener)})
    if action == 'update':
        # SAMCODER tidak punya update schedule → hapus dulu, buat ulang dengan data baru
        try:
            http_json(SAMCODER['url'] + '/api/schedules/' + urllib.parse.quote(job_id), None, method='DELETE',
                      headers={'Cookie': _cookie_str(opener)})
        except Exception:
            pass  # job lama mungkin sudah tidak ada — lanjut buat baru
        p = payload or {}
        return http_json(SAMCODER['url'] + '/api/schedules', None, method='POST',
                         data={'schedule': p.get('schedule', ''), 'prompt': p.get('prompt', '')},
                         headers={'Cookie': _cookie_str(opener)})
    if action == 'autonomous_start':
        p = payload or {}
        return http_json(SAMCODER['url'] + '/api/autonomous', None, method='POST',
                         data={'goal': p.get('goal', ''), 'maxTurns': int(p.get('maxTurns') or 8),
                               'maxTokens': int(p.get('maxTokens') or 500000), 'maxMs': int(p.get('maxMs') or 3600000)},
                         headers={'Cookie': _cookie_str(opener)})
    if action == 'autonomous_stop':
        return http_json(SAMCODER['url'] + '/api/autonomous/stop', None, method='POST',
                         headers={'Cookie': _cookie_str(opener)})
    if action == 'autonomous_resume':
        return http_json(SAMCODER['url'] + '/api/autonomous/resume', None, method='POST',
                         headers={'Cookie': _cookie_str(opener)})
    raise ValueError('aksi tidak dikenal: ' + action)


def _cookie_str(opener):
    parts = []
    for c in opener.opener.cookiejar:
        parts.append(c.name + '=' + c.value)
    return '; '.join(parts)


def run_action(agent_id, action, job_id, payload):
    for gw in GATEWAYS:
        if gw['id'] == agent_id:
            return {'ok': True, 'data': action_hermes(gw, action, job_id, payload)}
    if agent_id == SAMCODER['id']:
        return {'ok': True, 'data': action_samcoder(action, job_id, payload)}
    raise ValueError('agent tidak dikenal: ' + str(agent_id))


# ---------- HTTP ----------

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/jobs.json'):
            if not _authed(self):
                return self._json(b'{"ok": false, "error": "Unauthorized"}', 401)
            body = json.dumps(state).encode()
            self._json(body)
        elif self.path == '/health':
            self._json(b'{"status":"ok"}')
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == '/action':
            if not _authed(self):
                return self._json(b'{"ok": false, "error": "Unauthorized"}', 401)
            try:
                ln = int(self.headers.get('Content-Length') or 0)
                if ln > 65536:
                    raise ValueError('payload terlalu besar')
                payload = json.loads(self.rfile.read(ln).decode() or '{}')
                agent = payload.get('agent', '')
                action = payload.get('action', '')
                job_id = payload.get('jobId') or ''
                data = payload.get('payload')
                result = run_action(agent, action, job_id, data)
                body = json.dumps(result).encode()
                self._json(body, 200)
            except Exception as e:
                self._json(json.dumps({'ok': False, 'error': str(e)}).encode(), 400)
        else:
            self.send_response(404)
            self.end_headers()

    def _json(self, body, code=200):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


def loop():
    while True:
        time.sleep(POLL_INTERVAL)
        try:
            refresh()
        except Exception:
            pass


def main():
    refresh()
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 3122), Handler)
    threading.Thread(target=loop, daemon=True).start()
    srv.serve_forever()


if __name__ == '__main__':
    main()
