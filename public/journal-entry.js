(async () => {
  'use strict';

  const shell = document.querySelector('.shell');
  const status = document.querySelector('#journal-loading');

  function loadScript(path) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = path;
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
  }

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
    await loadScript('/app.js');
    await loadScript('/account.js');
    status.remove();
    shell.hidden = false;
  } catch {
    status.textContent = 'Не удалось загрузить журнал. Обновите страницу.';
  }
})();
