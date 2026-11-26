const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const format = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow', dateStyle: 'medium', timeStyle: 'short',
});

export function checksPage(staff, icon, mayDelete) {
  return `<section class="checks-page">
    <header class="checks-heading">
      <span class="checks-icon">${icon(staff ? 'users' : 'scan')}</span>
      <h1>${staff ? 'Проверки персонала' : 'Мои проверки'}</h1>
      <p>${staff ? 'История проверок всех модераторов' : 'Ваши проверки на игровом сервере'}</p>
    </header>
    <form class="panel checks-filters" id="check-filters" data-staff="${staff}" data-can-delete="${staff && mayDelete}">
      <label>${staff ? 'Ник подозреваемого' : 'Ник игрока'}<input class="input" name="player" type="search" maxlength="100" placeholder="Введите ник"></label>
      ${staff ? '<label>Ник проверяющего<input class="input" name="moderator" type="search" maxlength="100" placeholder="Введите ник"></label>' : ''}
      <label>С<input class="input" name="from" type="date"></label>
      <label>По<input class="input" name="to" type="date"></label>
      <div class="checks-filter-actions"><button class="button primary" type="submit">${icon('scan')} Найти</button><button class="button" type="reset">Сбросить</button></div>
    </form>
    <div id="checks-results" aria-live="polite"><p class="panel checks-empty">Загрузка…</p></div>
  </section>`;
}

function time(value) {
  return value && Number.isFinite(new Date(value).valueOf()) ? `<time datetime="${new Date(value).toISOString()}">${format.format(value)}</time>` : '—';
}

function checkCard(item, staff, mayDelete) {
  const result = item.ban_reason ? 'Забанен' : item.result || (item.ended ? 'Завершена' : 'На проверке');
  const state = result === 'Забанен' ? 'ban' : item.ended ? 'closed' : 'active';
  return `<li class="panel checks-card">
    <div class="checks-card-heading"><div><span class="checks-label">${staff ? 'Подозреваемый' : 'Игрок'}</span><h2>${escape(item.player)}</h2></div>
      <span class="checks-result" data-state="${state}">${escape(result)}</span></div>
    <dl>
      <div><dt>${staff ? 'Проверяющий' : 'Модератор'}</dt><dd>${escape(item.moderator || '—')}</dd></div>
      <div><dt>Вызвали</dt><dd>${time(item.started)}</dd></div>
      <div><dt>Завершили</dt><dd>${time(item.ended)}</dd></div>
      ${item.removed_by ? `<div><dt>Кто завершил</dt><dd>${escape(item.removed_by)}</dd></div>` : ''}
    </dl>
    ${mayDelete ? `<div class="checks-card-actions"><button type="button" class="button danger-button"
      data-delete-check="${escape(item.id)}" data-check-player="${escape(item.player)}">Удалить</button></div>` : ''}
  </li>`;
}

let request;
let searchTimer;
export async function loadChecks(page = 1) {
  clearTimeout(searchTimer);
  const form = document.querySelector('#check-filters');
  const results = document.querySelector('#checks-results');
  if (!form || !results) return;

  request?.abort();
  request = new AbortController();
  const { signal } = request;
  const query = new URLSearchParams(new FormData(form));
  query.set('page', page);
  const staff = form.dataset.staff === 'true';
  const mayDelete = form.dataset.canDelete === 'true';
  const endpoint = staff ? 'staff-checks' : 'checks';
  results.setAttribute('aria-busy', 'true');

  try {
    const response = await window.journalFetch('/api/server/' + endpoint + '?' + query, { signal, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось загрузить проверки.');
    if (signal.aborted || !results.isConnected) return;
    if (!data.items.length && data.total && page > 1) return loadChecks(data.pages);
    results.dataset.page = data.page;
    results.innerHTML = `<div class="checks-results-heading"><strong>Найдено: ${data.total}</strong><span>Время по Москве</span></div>
      ${data.items.length ? `<ul class="checks-cards">${data.items.map(item => checkCard(item, staff, mayDelete)).join('')}</ul>` :
        '<p class="panel checks-empty">Проверок по этим условиям не найдено.</p>'}
      ${data.pages > 1 ? `<nav class="checks-pages" aria-label="Страницы проверок">
        <button class="button" type="button" data-check-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>Назад</button>
        <span>${data.page} / ${data.pages}</span>
        <button class="button" type="button" data-check-page="${data.page + 1}" ${data.page >= data.pages ? 'disabled' : ''}>Далее</button>
      </nav>` : ''}`;
  } catch (error) {
    if (!signal.aborted && results.isConnected) {
      results.innerHTML = '<p class="panel checks-empty"></p>';
      results.firstElementChild.textContent = error.message || 'Не удалось загрузить проверки.';
    }
  } finally {
    if (!signal.aborted) results.removeAttribute('aria-busy');
  }
}

export function bindCheckWork({ csrf, showDelete }) {
  document.addEventListener('input', event => {
    if (!event.target.matches('#check-filters input[type="search"]') || event.isComposing) return;
    const form = event.target.form;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { if (form.isConnected) loadChecks(); }, 300);
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-check-page]');
    if (button && !button.disabled) loadChecks(Number(button.dataset.checkPage));
    const remove = event.target.closest('[data-delete-check]');
    if (!remove) return;
    showDelete(`<p class="modal-description">Проверка игрока <strong>${escape(remove.dataset.checkPlayer)}</strong> исчезнет из истории и статистики.</p>
      <form data-confirm-check-delete="${escape(remove.dataset.deleteCheck)}" class="staff-control-form">
        <p class="staff-form-error" role="alert"></p>
        <div class="detail-actions"><button type="submit" class="button danger-button">Удалить проверку</button>
          <button type="button" class="button" data-action="close-modal">Отмена</button></div>
      </form>`);
  });
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (form.id === 'check-filters') {
      event.preventDefault();
      loadChecks();
      return;
    }
    if (!form.matches('form[data-confirm-check-delete]')) return;
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    const errorBox = form.querySelector('[role="alert"]');
    errorBox.textContent = '';
    try {
      const response = await window.journalFetch('/api/server/staff-checks/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ id: form.dataset.confirmCheckDelete }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось удалить проверку.');
      if (form.isConnected) form.closest('dialog').close();
      loadChecks(Number(document.querySelector('#checks-results')?.dataset.page || 1));
    } catch (error) {
      errorBox.textContent = error.message || 'Не удалось удалить проверку.';
      submit.disabled = false;
    }
  });
  document.addEventListener('reset', event => {
    if (event.target.id === 'check-filters') queueMicrotask(() => loadChecks());
  });
}
