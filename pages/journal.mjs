import { fetch, loadManualImages } from './client.mjs';

const loading = document.querySelector('#main');
try {
  const response = await fetch('/api/auth/session');
  if (!response.ok) throw new Error();
  const session = await response.json();
  if (session.user?.status !== 'active') {
    location.replace('/jevox-journal/');
  } else {
    document.querySelector('#auth-session').textContent = JSON.stringify(session);
    const name = session.user.displayName || '';
    document.querySelector('.profile-name').textContent = name;
    document.querySelector('.avatar').textContent = name.replace(/\s/g, '').slice(0, 2).toUpperCase();
    loadManualImages();
    await import('../dist/app.js');
    await import('../public/account.js');
  }
} catch {
  loading.textContent = 'Не удалось загрузить журнал. Обновите страницу.';
}
