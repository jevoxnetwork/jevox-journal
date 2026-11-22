import { equal, json } from './security.mjs';
import { serverData } from './server-data.mjs';

export async function checkBridge(request, env) {
  const token = env.CHECK_BRIDGE_TOKEN;
  if (request.method !== 'POST' || !token || !equal(request.headers.get('authorization'), 'Bearer ' + token)) {
    return json({ error: 'Нет доступа.' }, 403);
  }
  const raw = await request.text();
  if (raw.length > 65000) return json({ error: 'Слишком большой запрос.' }, 413);
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: 'Некорректный запрос.' }, 400);
  }
  // Allow older plugin installations to finish flushing without sending them work.
  if (event?.op === 'poll') return json({ jobs: [] });
  if (['job', 'state', 'message'].includes(event?.op)) return json({ ok: true });
  if (event?.op !== 'sync') return json({ error: 'Некорректное событие.' }, 400);

  const url = new URL('/api/server/sync', request.url);
  const forwarded = new Request(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: JSON.stringify({ kind: event.kind, records: event.records }),
  });
  return serverData(forwarded, { ...env, SERVER_SYNC_TOKEN: token }, null, url);
}
