(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  let current;
  const errors = {
    not_configured: 'Этот способ входа ещё не подключён. Обратитесь к администратору журнала.',
    rate_limit: 'Слишком много попыток входа. Подождите несколько минут.',
    expired: 'Попытка входа устарела. Нажмите кнопку входа ещё раз.',
    cancelled: 'Вход отменён. Можно выбрать другой способ или попробовать снова.',
    invalid_response: 'Не удалось получить подтверждение аккаунта. Повторите вход.',
    provider_failed: 'Не удалось подтвердить вход. Попробуйте ещё раз или выберите другой способ.',
    blocked: 'Доступ к журналу для этого аккаунта приостановлен. Обратитесь к руководителю.',
  };
  const query = new URLSearchParams(location.search);
  if (errors[query.get('error')]) { $('#login-error').hidden = false; $('#login-error').textContent = errors[query.get('error')]; }
  if (location.search) history.replaceState(null, '', '/login');
  async function refresh() {
    try {
      const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error();
      current = await response.json();
      if (current.user?.status === 'active') { location.replace('/journal'); return; }
      $('#login-choice').hidden = !!current.user;
      $('#account-pending').hidden = !current.user;
      if (current.user) {
        $('#identity-name').textContent = current.user.displayName;
        $('#identity-provider').textContent = current.user.provider === 'telegram' ? 'Telegram' : 'ВКонтакте';
        $('#identity-id').textContent = current.user.providerId;
        if (current.user.status === 'blocked') {
          $('#pending-title').textContent = 'Доступ приостановлен';
          $('#pending-label').textContent = 'ДОСТУП ОГРАНИЧЕН';
          $('#pending-description').textContent = 'Обратитесь к руководителю, чтобы уточнить причину ограничения.';
        }
        return;
      }
      const available = current.providers || {};
      for (const provider of ['telegram', 'vk']) $(`#${provider}-login`).disabled = !available[provider];
      $('#provider-notice').textContent = !available.telegram && !available.vk
        ? 'Способы входа пока подключаются. Страница будет готова к авторизации после настройки администратором.'
        : !available.telegram || !available.vk ? 'Один из способов входа пока недоступен. Воспользуйтесь другим.'
          : '';
      $('#provider-notice').hidden = !$('#provider-notice').textContent;
    } catch {
      $('#provider-notice').hidden = false;
      $('#provider-notice').textContent = 'Не удалось связаться с сервером. Обновите страницу через несколько секунд.';
    }
  }
  for (const provider of ['telegram', 'vk']) $(`#${provider}-login`).addEventListener('click', () => location.assign(`/auth/${provider}/start`));
  $('#check-access').addEventListener('click', async () => {
    $('#check-access').disabled = true;
    await refresh();
    $('#check-access').disabled = false;
    if (current?.user?.status === 'pending') { $('#pending-error').hidden = false; $('#pending-error').textContent = 'Доступ ещё не выдан. Попробуйте позже.'; }
  });
  $('#logout-pending').addEventListener('click', async () => {
    $('#logout-pending').disabled = true;
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': current.csrf } });
      if (!response.ok) throw new Error();
      location.replace('/login');
    } catch { $('#logout-pending').disabled = false; $('#pending-error').hidden = false; $('#pending-error').textContent = 'Не удалось выйти. Попробуйте ещё раз.'; }
  });
  refresh();
})();
