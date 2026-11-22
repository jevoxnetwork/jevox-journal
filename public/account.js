(() => {
  'use strict';
  const session = JSON.parse(document.querySelector('#auth-session').textContent);
  const caption = document.createElement('div');
  caption.className = 'auth-provider-label';
  caption.textContent = `Вход через ${session.user.provider === 'telegram' ? 'Telegram' : 'ВКонтакте'}`;
  document.querySelector('#profile-popover').prepend(caption);
  const logout = document.createElement('button');
  logout.dataset.action = 'logout'; logout.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M10 4H5v16h5m4-12 4 4-4 4m4-4H9"/></svg><span>Выйти из аккаунта</span>';
  document.querySelector('#profile-popover').append(logout);
  document.addEventListener('click', async event => {
    if (event.target.closest('[data-action]')?.dataset.action !== 'logout') return;
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': session.csrf } });
      if (!response.ok) throw new Error();
      location.replace('/login');
    } catch { toast('Не удалось выйти. Попробуйте ещё раз.'); }
  });
  window.addEventListener('focus', async () => {
    try { const response = await fetch('/api/auth/session', { cache: 'no-store' }); if (response.ok) { const data = await response.json(); if (!data.user || data.user.status !== 'active') location.replace('/login'); } } catch {}
  });
})();
