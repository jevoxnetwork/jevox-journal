const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const format = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow', dateStyle: 'medium', timeStyle: 'short',
});

export function checksPage(staff, icon) {
  return `<section class="checks-page">
    <header class="checks-heading">
      <span class="checks-icon">${icon(staff ? 'users' : 'scan')}</span>
      <h1>${staff ? 'Проверки состава' : 'Проверки'}</h1>
      <p>${staff ? 'История проверок всех модераторов' : 'Ваши проверки на игровом сервере'}</p>
    </header>
    <form class="panel checks-filters" id="check-filters" data-staff="${staff}">
      <label>Ник игрока<input class="input" name="player" type="search" maxlength="100" placeholder="Найти игрока"></label>
      ${staff ? '<label>Ник модератора<input class="input" name="moderator" type="search" maxlength="100" placeholder="Найти модератора"></label>' : ''}
      <label>Причина<input class="input" name="reason" type="search" maxlength="150" placeholder="Фрагмент причины"></label>
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

function checkCard(item) {
  const result = item.ban_reason ? 'Забанен' : item.result || (item.ended ? 'Завершена' : 'На проверке');
  const state = result === 'Забанен' ? 'ban' : item.ended ? 'closed' : 'active';
  return `<li class="panel checks-card">
    <div class="checks-card-heading"><div><span class="checks-label">Игрок</span><h2>${escape(item.player)}</h2></div>
      <span class="checks-result" data-state="${state}">${escape(result)}</span></div>
    <dl>
      <div><dt>Модератор</dt><dd>${escape(item.moderator || '—')}</dd></div>
      <div><dt>Вызвали</dt><dd>${time(item.started)}</dd></div>
      <div><dt>Завершили</dt><dd>${time(item.ended)}</dd></div>
      ${item.removed_by ? `<div><dt>Кто завершил</dt><dd>${escape(item.removed_by)}</dd></div>` : ''}
    </dl>
    ${item.reason ? `<p class="checks-reason"><span class="checks-label">Причина</span>${escape(item.reason)}</p>` : ''}
  </li>`;
}

let request;
export async function loadChecks(page = 1) {
  const form = document.querySelector('#check-filters');
  const results = document.querySelector('#checks-results');
  if (!form || !results) return;

  request?.abort();
  request = new AbortController();
  const { signal } = request;
  const query = new URLSearchParams(new FormData(form));
  query.set('page', page);
  const endpoint = form.dataset.staff === 'true' ? 'staff-checks' : 'checks';
  results.setAttribute('aria-busy', 'true');

  try {
    const response = await fetch('/api/server/' + endpoint + '?' + query, { signal, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось загрузить проверки.');
    if (signal.aborted || !results.isConnected) return;
    if (!data.items.length && data.total && page > 1) return loadChecks(data.pages);
    results.innerHTML = `<div class="checks-results-heading"><strong>Найдено: ${data.total}</strong><span>Время по Москве</span></div>
      ${data.items.length ? `<ul class="checks-cards">${data.items.map(checkCard).join('')}</ul>` :
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

export function bindCheckWork() {
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-check-page]');
    if (button && !button.disabled) loadChecks(Number(button.dataset.checkPage));
  });
  document.addEventListener('submit', event => {
    if (event.target.id !== 'check-filters') return;
    event.preventDefault();
    loadChecks();
  });
  document.addEventListener('reset', event => {
    if (event.target.id === 'check-filters') queueMicrotask(() => loadChecks());
  });
}
