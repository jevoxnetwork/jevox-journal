import { bindCheckChat } from './check-chat.mjs';
import { bindCheckCall } from './check-call.mjs';
export { callPage, loadCall } from './check-call.mjs';

const html=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',dateStyle:'short',timeStyle:'short'});
const time=value=>value?date.format(value):'—';

export function checksPage(){
  return `<section class="work-page"><header><h1>Проверки</h1><p>Личная история проверок · время по Москве</p></header>
    <form class="panel work-filters" id="check-filters">
      <label>Ник игрока<input class="input" name="player" type="search" maxlength="16" placeholder="Поиск по нику"></label>
      <label>Причина<input class="input" name="reason" type="search" maxlength="150" placeholder="Фрагмент причины"></label>
      <label>С<input class="input" name="from" type="date"></label>
      <label>По<input class="input" name="to" type="date"></label>
      <button class="button primary" type="submit">Найти</button>
    </form>
    <div id="work-history" class="panel work-history" aria-live="polite">Загрузка…</div></section>`;
}

let historyRequest;
export async function loadChecks(page=1){
  const list=document.querySelector('#work-history'),form=document.querySelector('#check-filters');
  if(!list||!form)return;
  historyRequest?.abort();
  historyRequest=new AbortController();
  const signal=historyRequest.signal;
  const query=new URLSearchParams(new FormData(form));
  query.set('page',page);
  list.setAttribute('aria-busy','true');
  try{
    const response=await fetch('/api/server/checks?'+query,{signal});
    const data=await response.json();
    if(!response.ok)throw Error(data.error);
    if(signal.aborted||!list.isConnected)return;
    if(!data.items.length){list.innerHTML='<p class="work-empty">Проверок по этим условиям не найдено.</p>';return;}
    list.innerHTML=`<ul>${data.items.map(item=>`<li class="work-check-row">
      <div><strong>${html(item.player)}</strong><p>${html(item.reason||'Причина не указана')}</p></div>
      <div><small>Вызвали</small><time>${time(item.started)}</time></div>
      <div><small>Завершили</small><time>${time(item.ended)}</time></div>
      <div class="work-check-result"><div><small>Исход</small><span class="work-outcome">${html(item.ban_reason?'Забанен':item.result||(item.ended?'Завершена':'На проверке'))}</span></div>
      ${item.chat_id?`<button class="button check-history-chat" type="button" aria-haspopup="dialog" data-check-chat="${html(item.chat_id)}">История чата</button>`:''}</div>
    </li>`).join('')}</ul>${data.pages>1?`<footer class="work-pages"><button class="button" data-check-page="${data.page-1}" ${data.page<=1?'disabled':''}>Назад</button><span>${data.page} / ${data.pages}</span><button class="button" data-check-page="${data.page+1}" ${data.page>=data.pages?'disabled':''}>Далее</button></footer>`:''}`;
  }catch(error){
    if(!signal.aborted&&list.isConnected)list.textContent=error.message||'Не удалось загрузить историю.';
  }finally{if(!signal.aborted)list.removeAttribute('aria-busy');}
}


export function bindCheckWork(csrf){
  bindCheckCall(csrf);
  bindCheckChat();
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-check-page]');
    if(button&&!button.disabled)loadChecks(Number(button.dataset.checkPage));
  });
  document.addEventListener('submit',event=>{
    if(event.target.id==='check-filters'){
      event.preventDefault();
      loadChecks();
    }
  });
}