const backend = 'https://jevoxjournal.pages.dev';
const key = 'jevox-journal.github-session';
const verifierKey = 'jevox-journal.github-verifier';
const site = '/jevox-journal/';

export function fetch(path, options = {}) {
  const url = new URL(path, backend);
  if (url.origin !== backend || !url.pathname.startsWith('/api/')) return globalThis.fetch(path, options);
  const headers = new Headers(options.headers);
  const token = sessionStorage.getItem(key);
  if (token) headers.set('Authorization', 'Bearer ' + token);
  return globalThis.fetch(url, { ...options, headers, credentials: 'omit', redirect: 'error', cache: 'no-store' });
}

const base64url = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

export async function startLogin(provider) {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  sessionStorage.setItem(verifierKey, verifier);
  location.assign(backend + '/auth/' + provider + '/start?pages=' + base64url(new Uint8Array(digest)));
}

export async function exchangeLogin() {
  const code = new URLSearchParams(location.hash.slice(1)).get('handoff');
  if (!code) return;
  history.replaceState(null, '', site);
  const verifier = sessionStorage.getItem(verifierKey);
  sessionStorage.removeItem(verifierKey);
  try {
    if (!verifier) throw new Error();
    const response = await fetch('/api/auth/pages/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, verifier }),
    });
    if (!response.ok) throw new Error();
    const { token } = await response.json();
    sessionStorage.setItem(key, token);
  } catch {
    history.replaceState(null, '', site + '?error=expired');
  }
}

export function clearLogin() {
  sessionStorage.removeItem(key);
}

export function loadManualImages() {
  const root = document.querySelector('#main');
  const sources = new Map();
  const observer = new MutationObserver(() => {
    for (const image of root.querySelectorAll('img[src^="/api/manual-images/"]')) {
      const path = image.getAttribute('src');
      if (!/^\/api\/manual-images\/[a-f0-9-]{36}$/.test(path)) continue;
      image.dataset.journalImage = path;
      image.removeAttribute('src');
      if (!sources.has(path)) {
        sources.set(path, fetch(path).then(async response => {
          if (!response.ok) throw new Error();
          return URL.createObjectURL(await response.blob());
        }).catch(error => {
          sources.delete(path);
          throw error;
        }));
      }
      sources.get(path).then(src => {
        if (image.isConnected && image.dataset.journalImage === path) image.src = src;
      }).catch(() => { image.alt = 'Не удалось загрузить изображение'; });
    }
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
}
