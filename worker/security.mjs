export const SESSION_LIFETIME_SECONDS = 3 * 24 * 60 * 60;
export const isSessionToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const now = () => Math.floor(Date.now() / 1000);
export function randomToken(bytes = 32) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export async function hash(value) {
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export function cookies(request) {
  const values = Object.create(null);
  for (const pair of (request.headers.get('cookie') || '').split(';')) {
    const at = pair.indexOf('='); if (at < 1) continue;
    const key = pair.slice(0, at).trim();
    if (Object.hasOwn(values, key)) { values[key] = null; continue; }
    values[key] = pair.slice(at + 1).trim();
  }
  return values;
}
export function authConfig(env, origin) {
  const url = new URL(env.PUBLIC_URL || origin);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('HTTPS_REQUIRED');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('INVALID_PUBLIC_URL');
  return {
    origin: url.origin, secure: url.protocol === 'https:',
    sessionName: url.protocol === 'https:' ? '__Host-journal_session' : 'journal_session',
    flowName: url.protocol === 'https:' ? '__Host-journal_flow' : 'journal_flow',
    telegram: { id: (env.TELEGRAM_CLIENT_ID || '').trim(), secret: (env.TELEGRAM_CLIENT_SECRET || '').trim() },
    vk: { id: (env.VK_CLIENT_ID || '').trim(), secret: (env.VK_CLIENT_SECRET || '').trim() },
    admins: { telegram: list(env.ADMIN_TELEGRAM_IDS), vk: list(env.ADMIN_VK_IDS) },
    staff: { telegram: list(env.STAFF_TELEGRAM_IDS), vk: list(env.STAFF_VK_IDS) },
  };
}
function list(value) { return new Set(String(value || '').split(',').map(x => x.trim()).filter(Boolean)); }
export function available(config) {
  return { telegram: /^\d+$/.test(config.telegram.id) && !!config.telegram.secret, vk: /^\d+$/.test(config.vk.id) };
}
export function cookie(config, name, value, seconds = SESSION_LIFETIME_SECONDS) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${config.secure ? '; Secure' : ''}`;
}
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
export function redirect(path, status = 302) { return new Response(null, { status, headers: { Location: path, 'Cache-Control': 'no-store' } }); }
export function secureResponse(response) {
  const result = new Response(response.body, response);
  result.headers.set('X-Content-Type-Options', 'nosniff');
  result.headers.set('Referrer-Policy', 'no-referrer');
  result.headers.set('X-Frame-Options', 'DENY');
  result.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  result.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://textures.minecraft.net; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
  return result;
}
export function clean(value, limit = 120) { return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, limit).trim(); }
export function authFailureCode(error) {
  if (typeof error?.authFailureCode === 'string' && /^[A-Z0-9_]{1,100}$/.test(error.authFailureCode)) return error.authFailureCode;
  if (typeof error?.code === 'string' && /^ERR_(JWT|JWKS|JWS|JOSE|JWK)_[A-Z_]+$/.test(error.code)) {
    return error.code + (['nonce','iss','aud','sub','exp','iat'].includes(error.claim) ? '_' + error.claim.toUpperCase() : '');
  }
  if (['INVALID_IDENTITY','INVALID_DEVICE','PROVIDER_RESPONSE_TOO_LARGE'].includes(error?.message)) return error.message;
  if (['TimeoutError','AbortError'].includes(error?.name)) return 'PROVIDER_TIMEOUT';
  if (error?.name === 'TypeError') return 'NETWORK_OR_TYPE_ERROR';
  return 'SERVER_OR_NETWORK_ERROR';
}
