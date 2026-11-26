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
      await window.journalLogout(session.csrf);
      location.replace('/login');
    } catch {
      const status = document.querySelector('#toast');
      status.textContent = 'Не удалось выйти. Попробуйте ещё раз.';
      status.classList.add('visible');
      setTimeout(() => status.classList.remove('visible'), 3000);
    }
  });
  async function verifySession() {
    try {
      const current = await window.journalSession();
      if (current.user?.status !== 'active' || current.user.id !== session.user.id) location.replace('/login');
    } catch {}
  }
  window.addEventListener('focus', verifySession);
  window.addEventListener('pageshow', verifySession);
  window.addEventListener('storage', verifySession);
})();
