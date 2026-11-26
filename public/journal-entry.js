import './session-device.js';

(async () => {
  'use strict';

  const shell = document.querySelector('.shell');
  const status = document.querySelector('#journal-loading');

  try {
    const session = await window.journalSession();
    if (session.user?.status !== 'active') {
      location.replace('/login');
      return;
    }
    const name = session.user.displayName ?? '';
    document.querySelector('.profile-name').textContent = name;
    document.querySelector('.avatar').textContent = name.replace(/\s/g, '').slice(0, 2).toUpperCase();
    document.querySelector('#auth-session').textContent = JSON.stringify(session);
    await import('../dist/app.js');
    await import('./account.js');
    status.remove();
    shell.hidden = false;
  } catch {
    status.textContent = 'Не удалось загрузить журнал. Обновите страницу.';
  }
})();
