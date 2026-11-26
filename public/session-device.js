(() => {
  'use strict';

  const activeKey = 'jevox.session.device';
  const pendingKey = 'jevox.session.pending-device';
  const valid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

  function request(path, options, device) {
    const url = new URL(path, location.origin);
    if (url.origin !== location.origin) throw new Error('Invalid journal request origin');
    const headers = new Headers(options?.headers);
    headers.delete('X-Journal-Device');
    if (valid(device)) headers.set('X-Journal-Device', device);
    return fetch(url, { ...options, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  }

  let device;
  async function readSession(candidate) {
    const response = await request('/api/auth/session', {}, candidate);
    if (!response.ok) throw new Error('Session unavailable');
    return response.json();
  }

  window.journalFetch = (path, options) => request(path, options, device);
  window.journalSession = async () => {
    if (device) return readSession(device);
    const pending = sessionStorage.getItem(pendingKey);
    if (valid(pending)) {
      const session = await readSession(pending);
      if (session.user) {
        localStorage.setItem(activeKey, pending);
        sessionStorage.removeItem(pendingKey);
        device = pending;
        return session;
      }
    }
    const active = localStorage.getItem(activeKey);
    const session = await readSession(active);
    if (session.user) device = active;
    return session;
  };
  window.journalStartLogin = async provider => {
    const random = crypto.getRandomValues(new Uint8Array(32));
    const pending = btoa(String.fromCharCode(...random)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    sessionStorage.setItem(pendingKey, pending);
    const response = await request('/auth/' + provider + '/start', { method: 'POST' }, pending);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return data.url;
  };
  window.journalLogout = async csrf => {
    const response = await window.journalFetch('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrf } });
    if (!response.ok) throw new Error('Logout failed');
    if (localStorage.getItem(activeKey) === device) localStorage.removeItem(activeKey);
    sessionStorage.removeItem(pendingKey);
    device = undefined;
  };
})();
