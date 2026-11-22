import { createRemoteJWKSet, jwtVerify } from 'jose';
import { clean, equal, hash } from './security.mjs';

const telegramKeys = createRemoteJWKSet(new URL('https://oauth.telegram.org/.well-known/jwks.json'), { timeoutDuration: 10000 });
export async function authorizationURL(config, provider, flow) {
  const telegram = provider === 'telegram';
  const url = new URL(telegram ? 'https://oauth.telegram.org/auth' : 'https://id.vk.ru/authorize');
  const params = {
    client_id: config[provider].id, redirect_uri: `${config.origin}/auth/${provider}/callback`,
    response_type: 'code', scope: telegram ? 'openid profile' : 'vkid.personal_info',
    state: flow.state, code_challenge: await hash(flow.verifier), code_challenge_method: telegram ? 'S256' : 's256',
  };
  // Code flow is bound by state + PKCE; the widget's nonce claim is separate.
  if (!telegram) { params.scheme = 'dark'; params.lang_id = '0'; }
  url.search = new URLSearchParams(params).toString();
  return url.toString();
}
async function postJson(url, params, headers = {}, fetchFn = fetch) {
  const stage = url.startsWith('https://oauth.telegram.org/') ? 'TELEGRAM_TOKEN' : url.endsWith('/auth') ? 'VK_TOKEN' : 'VK_PROFILE';
  const response = await fetchFn(url, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(params).toString(), redirect: 'manual', signal: AbortSignal.timeout(12000),
  });
  const text = await response.text(); if (text.length > 1048576) throw new Error('PROVIDER_RESPONSE_TOO_LARGE');
  let data; try { data = JSON.parse(text); } catch { throw providerFailure(stage, 'HTTP_' + response.status); }
  const known = new Set(['invalid_client','invalid_grant','invalid_request','unauthorized_client','invalid_redirect_uri','invalid_code_verifier','temporarily_unavailable']);
  if (!response.ok || !data || typeof data !== 'object' || data.error) {
    throw providerFailure(stage, known.has(data?.error) ? data.error.toUpperCase() : 'HTTP_' + response.status);
  }
  return data;
}
function providerFailure(stage, code) { const error = new Error('PROVIDER_REJECTED'); error.authFailureCode = stage + '_' + code; return error; }
export async function validateTelegramToken(token, config, nonce, keys = telegramKeys) {
  const { payload } = await jwtVerify(token, keys, {
    issuer: 'https://oauth.telegram.org', audience: config.telegram.id,
    algorithms: ['RS256', 'ES256'], requiredClaims: ['sub', 'iat', 'exp'],
    maxTokenAge: '10m', clockTolerance: 5,
  });
  if ((nonce !== undefined && !equal(payload.nonce, nonce)) || typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 200) throw new Error('INVALID_IDENTITY');
  if (payload.id !== undefined && !(typeof payload.id === 'number' && Number.isSafeInteger(payload.id) && payload.id > 0) && !(typeof payload.id === 'string' && /^\d{1,30}$/.test(payload.id))) throw new Error('INVALID_IDENTITY');
  return {
    provider: 'telegram', subject: payload.sub, providerId: String(payload.id ?? payload.sub),
    displayName: clean(payload.name || payload.given_name || payload.preferred_username) || 'Сотрудник',
    username: clean(payload.preferred_username), picture: '',
  };
}
export async function exchangeIdentity(config, provider, flow, callback, dependencies = {}) {
  const fetchFn = dependencies.fetchFn || fetch;
  const params = {
    grant_type: 'authorization_code', code: callback.code, client_id: config[provider].id,
    redirect_uri: `${config.origin}/auth/${provider}/callback`, code_verifier: flow.verifier,
  };
  if (provider === 'telegram') {
    const basic = btoa(`${config.telegram.id}:${config.telegram.secret}`);
    const result = await postJson('https://oauth.telegram.org/token', params, { Authorization: `Basic ${basic}` }, fetchFn);
    if (typeof result.id_token !== 'string') throw new Error('INVALID_IDENTITY');
    return validateTelegramToken(result.id_token, config, undefined, dependencies.telegramKeys || telegramKeys);
  }
  if (!callback.deviceId || callback.deviceId.length > 1000) throw new Error('INVALID_DEVICE');
  Object.assign(params, { device_id: callback.deviceId, state: callback.state });
  if (config.vk.secret) params.client_secret = config.vk.secret;
  const token = await postJson('https://id.vk.ru/oauth2/auth', params, {}, fetchFn);
  if (!equal(token.state, callback.state) || typeof token.access_token !== 'string' || !token.access_token || !/^\d{1,30}$/.test(String(token.user_id))) throw new Error('INVALID_IDENTITY');
  const result = await postJson('https://id.vk.ru/oauth2/user_info', { access_token: token.access_token, client_id: config.vk.id }, {}, fetchFn);
  const user = result.user;
  if (!user || String(user.user_id) !== String(token.user_id)) throw new Error('INVALID_IDENTITY');
  return {
    provider: 'vk', subject: String(user.user_id), providerId: String(user.user_id),
    displayName: clean([user.first_name, user.last_name].filter(Boolean).join(' ')) || 'Сотрудник',
    username: '', picture: '',
  };
}
