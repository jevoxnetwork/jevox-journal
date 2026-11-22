import { json } from './security.mjs';

export const pagesOrigin = 'https://jevoxnetwork.github.io';
export const pagesHome = pagesOrigin + '/jevox-journal/';
export const pagesToken = /^[A-Za-z0-9_-]{43}$/;

export function isPagesApi(request) {
  const path = new URL(request.url).pathname;
  return request.headers.get('origin') === pagesOrigin && path.startsWith('/api/') &&
    !['/api/server/sync', '/api/check-bridge', '/api/discord/interactions'].includes(path);
}

export function pagesCors(request, response) {
  const result = new Response(response.body, response);
  if (new URL(request.url).pathname.startsWith('/api/')) result.headers.append('Vary', 'Origin');
  if (isPagesApi(request)) {
    result.headers.set('Access-Control-Allow-Origin', pagesOrigin);
    result.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    result.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-CSRF-Token');
  }
  return result;
}

export function pagesPreflight(request) {
  if (!isPagesApi(request)) return json({ error: 'Нет доступа.' }, 403);
  return new Response(null, { status: 204 });
}
