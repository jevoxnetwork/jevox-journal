import { chatMessages } from './check-chat.mjs';

const icons={
  history:'<path d="M3 12a9 9 0 1 1 2.4 6.1M3 17v-5h5m4-4v5l3 2"/>',
  target:'<circle cx="12" cy="12" r="7"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/><circle cx="12" cy="12" r="1.5"/>',
  chat:'<path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-5a2 2 0 0 1-1-2V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h6"/>',
  send:'<path d="m3 11 18-8-8 18-2.4-7.6L3 11Zm7.6 2.4L21 3"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 4v3"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  down:'<path d="M12 5v14m-5-5 5 5 5-5"/>'
};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
const statuses={queued:'Вызов отправлен',active:'На проверке',released:'Отпущен',banned:'Забанен',left:'Игрок вышел',stopped:'Проверка завершена',failed:'Вызов не выполнен'};
const moscowTime=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'});
const moscowDate=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'long'});
const timerPresets=[[60,'1 мин'],[180,'3 мин'],[300,'5 мин'],[600,'10 мин']];
const banPresets=[['1d','1 день'],['7d','7 дней'],['30d','30 дней'],['perm','Навсегда']];
const presets=(values,name)=>`<div class="call-presets">${values.map(([value,label])=>
  `<button type="button" class="call-choice" data-call-field="${name}" data-call-value="${value}" aria-pressed="${value===180}">${label}</button>`).join('')}</div>`;

export function callPage(){
  return `<section class="work-page call-page" id="check-call-page">
    <header><h1>Вызов на проверку</h1><p>Вызовите игрока и проведите проверку из журнала.</p></header>
    <div class="call-bar">
      <div id="check-connection" class="call-connection" role="status" hidden></div>
      <a class="call-back" href="#checks">${icon('history')} История проверок</a>
    </div>
    <div class="call-grid">
      <section class="panel call-panel" aria-labelledby="check-call-title">
        <header class="call-panel-head"><span class="call-icon">${icon('target')}</span><h2 id="check-call-title">Новый вызов</h2></header>
        <div id="check-session" class="call-session" hidden>
          <div class="call-player-line"><strong id="check-player"></strong><span id="check-state" class="call-state"></span></div>
          <p id="check-reason"></p>
          <div id="check-timer" class="call-timer" hidden>
            <div><span>Таймер проверки</span><strong id="check-clock">—</strong></div>
            <progress id="check-progress" value="0" max="1" aria-label="Оставшееся время проверки"></progress>
          </div>
          <dl id="check-times" class="call-times" hidden>
            <div><dt>Начало, МСК</dt><dd id="check-started"></dd></div>
          </dl>
          <p id="check-action" class="call-action" role="status" hidden></p>
          <div id="check-actions" class="call-actions" hidden>
            <p class="call-notice" id="check-finish-error" role="alert" hidden></p>
            <form data-check-work="release"><button class="button call-release" type="submit">${icon('check')} Отпустить игрока</button></form>
            <details class="call-ban" id="check-ban"><summary>Выдать наказание</summary>
              <form data-check-work="ban" class="work-form">
                <label>Срок блокировки<input class="input" name="duration" maxlength="9" placeholder="Например, 7d" required pattern="perm|[1-9][0-9]{0,3}[mhdw]"></label>
                ${presets(banPresets,'duration')}
                <label>Причина блокировки<textarea class="input" name="reason" rows="2" minlength="3" maxlength="300" required></textarea></label>
                <button class="button danger-button" type="submit">Подтвердить бан</button>
              </form>
            </details>
          </div>
        </div>
        <form data-check-work="start" class="work-form call-start">
          <label>Ник игрока<input class="input" name="player" required minlength="3" maxlength="16" pattern="[A-Za-z0-9_]+" placeholder="Ник онлайн-игрока" spellcheck="false" autocapitalize="off"></label>
          <label>Причина вызова<textarea class="input" name="reason" minlength="3" maxlength="300" rows="3" placeholder="Почему игрок вызван на проверку?" required></textarea></label>
          <label>Время на проверку <span class="call-seconds"><input class="input" name="seconds" type="number" min="30" max="900" value="180" required><span>сек.</span></span></label>
          ${presets(timerPresets,'seconds')}
          <p class="call-notice" id="check-call-failure" role="status" hidden></p>
          <p class="call-notice" id="check-start-error" role="alert" hidden></p>
          <button class="button primary call-submit" type="submit" disabled>${icon('target')} Вызвать на проверку</button>
        </form>
      </section>
      <section class="panel call-room" aria-labelledby="check-room-title">
        <header class="call-panel-head">
          <span class="call-icon">${icon('chat')}</span>
          <div><h2 id="check-room-title">Чат проверки</h2><p id="check-room-state">Приватная переписка</p></div>
          <button class="button check-history-chat call-chat-history" id="check-chat-history" type="button" aria-haspopup="dialog" hidden>История чата</button>
          <span class="call-lock" title="Приватная переписка">${icon('lock')}</span>
        </header>
        <div class="call-transcript">
          <div id="check-messages" class="call-messages" role="log" tabindex="0" aria-label="Сообщения проверки"></div>
          <p id="check-empty" class="call-empty"><span class="call-icon">${icon('chat')}</span><strong>Чат пока пуст</strong><span>Переписка откроется после вызова игрока.</span></p>
          <button class="button call-jump" id="check-new-messages" type="button" hidden>${icon('down')} Новые сообщения</button>
        </div>
        <form data-check-work="chat" class="call-compose">
          <div class="call-compose-input"><textarea class="input" name="message" maxlength="500" placeholder="Сообщение игроку" aria-label="Сообщение игроку" rows="2" required disabled></textarea>
          <span id="check-count" aria-hidden="true">0 / 500</span></div>
          <button class="button primary" type="submit" disabled>${icon('send')} Отправить</button>
          <p class="call-notice" id="check-chat-error" role="alert" hidden></p>
          <small id="check-compose-hint">Enter — отправить · Shift + Enter — новая строка</small>
        </form>
      </section>
    </div>
  </section>`;
}

let current;
const formOf=(call,kind)=>call.root.querySelector(`[data-check-work="${kind}"]`);
const isOpen=call=>call.root.isConnected;
const busy=check=>['queued','active'].includes(check?.state);
const finishKind=kind=>kind==='ban'||kind==='release';
const time=value=>value?moscowTime.format(value):'—';
const sessionTime=value=>value&&moscowDate.format(value)!==moscowDate.format(Date.now())
  ?`${moscowDate.format(value)} · ${time(value)}`:time(value);
const changeText=(element,value)=>{if(element.textContent!==value)element.textContent=value;};

function clock(call){
  const check=call.check;
  if(check?.state!=='active'||!check.seconds)return;
  const left=Math.max(0,Math.min(check.seconds,Math.ceil((Number(check.started||check.created)+check.seconds*1000-Date.now())/1000)));
  const display=left?`${Math.floor(left/60)}:${String(left%60).padStart(2,'0')}`:'Время вышло';
  changeText(call.el('clock'),display);
  call.el('timer').dataset.expired=String(!left);
  const progress=call.el('progress');
  progress.max=check.seconds;
  progress.value=left;
}

function paintControls(call){
  const check=call.check,active=check?.state==='active',pending=call.pending;
  const finishing=call.requestedFinish||finishKind(call.action?.kind)&&['queued','claimed'].includes(call.action.state);
  formOf(call,'start').querySelector('[type=submit]').disabled=!call.connected||busy(check)||pending.has('start')||!!call.startId;
  const canChat=call.connected&&active&&!finishing;
  const chat=formOf(call,'chat');
  const message=chat.elements.message;
  // Keep the draft editable if a live conversation temporarily loses connection.
  message.disabled=!active;
  chat.querySelector('[type=submit]').disabled=!canChat||pending.has('chat');
  for(const kind of ['release','ban']){
    formOf(call,kind).querySelector('[type=submit]').disabled=!call.connected||!active||finishing||pending.has('release')||pending.has('ban');
  }
}

function paintSession(call){
  const check=call.check,active=check?.state==='active';
  const ongoing=busy(check);
  const history=call.el('chat-history');
  history.hidden=!check||ongoing;
  history.dataset.checkChat=check?.id||'';
  call.el('session').hidden=!ongoing;
  formOf(call,'start').hidden=ongoing;
  changeText(call.el('call-title'),ongoing?'Проверка':'Новый вызов');
  const failure=call.el('call-failure');
  changeText(failure,check?.state==='failed'?check.detail||statuses.failed:'');
  failure.hidden=!failure.textContent;
  if(ongoing){
    changeText(call.el('player'),check.player);
    changeText(call.el('reason'),check.reason);
    const state=call.el('state');
    state.dataset.state=check.state;
    changeText(state,statuses[check.state]||'Проверка');
    call.el('timer').hidden=!active;
    call.el('times').hidden=!check.started&&!active;
    changeText(call.el('started'),sessionTime(check.started||check.created));
    call.el('actions').hidden=!active;
    const action=call.el('action');
    const detail=(call.action?.state==='failed'&&call.action.detail)||(check.detail!==statuses[check.state]&&check.detail)||'';
    changeText(action,detail);
    action.dataset.error=String(call.action?.state==='failed'||check.state==='failed');
    action.hidden=!detail;
  }
  changeText(call.el('room-state'),ongoing?check.player:check?'Переписка завершена':'Приватная переписка');
  paintControls(call);
  clock(call);
}

function paintMessages(call,messages){
  const list=call.el('messages'),empty=call.el('empty');
  const next=messages.map((item,index)=>String(item.id??`${item.created}-${item.side}-${index}`));
  if(next.length===call.messageIds.length&&next.every((id,index)=>id===call.messageIds[index]))return;
  const follow=call.messageIds.length===0||list.scrollHeight-list.scrollTop-list.clientHeight<55;
  const previousHeight=list.scrollHeight;
  const previousTop=list.scrollTop;
  const unchanged=call.messageIds.length&&call.messageIds.every((id,index)=>id===next[index]);
  const start=unchanged?call.messageIds.length:0;
  const newTail=next.at(-1)!==call.messageIds.at(-1);
  const content=chatMessages(call.check,messages,start);
  empty.hidden=messages.length>0;
  if(unchanged)list.insertAdjacentHTML('beforeend',content);
  else list.innerHTML=content;
  call.messageIds=next;
  if(follow)list.scrollTop=list.scrollHeight;
  else if(!unchanged)list.scrollTop=Math.max(0,previousTop+list.scrollHeight-previousHeight);
  call.el('new-messages').hidden=!messages.length||follow||(!newTail&&call.el('new-messages').hidden);
}

function showNotice(call,kind,value){
  const alert=call.el(`${finishKind(kind)?'finish':kind}-error`);
  changeText(alert,value);
  alert.hidden=!value;
}

function resetRoom(call){
  call.el('messages').replaceChildren();
  call.messageIds=[];
  call.el('empty').hidden=false;
  call.el('new-messages').hidden=true;
  call.el('ban').open=false;
  formOf(call,'ban').reset();
  formOf(call,'chat').reset();
  changeText(call.el('count'),'0 / 500');
  syncPresets(formOf(call,'ban'),'duration');
  call.requestedFinish=null;
  showNotice(call,'chat','');
  showNotice(call,'release','');
}

function refresh(call){
  if(!isOpen(call)||call.loading)return call.loading;
  clearTimeout(call.poll);
  call.loading=(async()=>{
    try{
      const response=await fetch('/api/work/checks',{cache:'no-store',signal:AbortSignal.timeout(7500)});
      if(!response.ok)throw Error();
      const {connected,check,messages,action}=await response.json();
      if(!isOpen(call))return;
      if(call.startId&&call.startId!==check?.id)return;
      if(call.check?.id!==check?.id)resetRoom(call);
      if(call.startId&&call.startId===check?.id){
        call.startId=null;
        formOf(call,'start').reset();
        syncPresets(formOf(call,'start'),'seconds');
      }
      if(call.requestedFinish===action?.kind||!busy(check))call.requestedFinish=null;
      call.check=check;
      call.action=action;
      call.connected=connected;
      const connection=call.el('connection');
      changeText(connection,connected?'':'Нет связи с игровым сервером');
      connection.hidden=connected;
      changeText(call.el('empty').lastElementChild,busy(check)?'Сообщения игрока появятся здесь.':check?'В этой проверке сообщений не было.':'Переписка откроется после вызова игрока.');
      paintSession(call);
      paintMessages(call,messages);
    }catch{
      if(!isOpen(call))return;
      call.connected=false;
      call.el('connection').hidden=false;
      changeText(call.el('connection'),'Журнал недоступен. Повторяем подключение…');
      paintControls(call);
    }finally{
      call.loading=null;
      if(isOpen(call))call.poll=setTimeout(()=>refresh(call),1800);
    }
  })();
  return call.loading;
}

export function loadCall(){
  const root=document.querySelector('#check-call-page');
  if(!root)return;
  if(current){clearTimeout(current.poll);clearInterval(current.timer);}
  const call={root,el:name=>root.querySelector(`#check-${name}`),pending:new Set(),messageIds:[],connected:false};
  current=call;
  call.timer=setInterval(()=>{
    if(isOpen(call))clock(call);
    else clearInterval(call.timer);
  },500);
  const list=call.el('messages');
  list.addEventListener('scroll',()=>{
    if(list.scrollHeight-list.scrollTop-list.clientHeight<55)call.el('new-messages').hidden=true;
  },{passive:true});
  refresh(call);
}

function syncPresets(form,name){
  for(const choice of form.querySelectorAll(`[data-call-field="${name}"]`))
    choice.setAttribute('aria-pressed',String(choice.dataset.callValue===form.elements[name].value));
}

export function bindCheckCall(csrf){
  document.addEventListener('click',event=>{
    const call=current;
    if(!call||!call.root.contains(event.target))return;
    const choice=event.target.closest('[data-call-field]');
    if(choice){
      const form=choice.closest('form');
      form.elements[choice.dataset.callField].value=choice.dataset.callValue;
      syncPresets(form,choice.dataset.callField);
    }
    if(event.target.closest('#check-new-messages')){
      const list=call.el('messages');
      list.scrollTop=list.scrollHeight;
      call.el('new-messages').hidden=true;
      list.focus({preventScroll:true});
    }
  });
  document.addEventListener('input',event=>{
    const call=current,field=event.target;
    if(!call||!call.root.contains(field))return;
    if(['seconds','duration'].includes(field.name))syncPresets(field.form,field.name);
    if(field.name==='message')changeText(call.el('count'),`${field.value.length} / 500`);
  });
  document.addEventListener('keydown',event=>{
    const call=current,field=event.target;
    if(!call||field!==formOf(call,'chat').elements.message)return;
    if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){
      event.preventDefault();
      if(!field.form.querySelector('[type=submit]').disabled&&field.value.trim())field.form.requestSubmit();
    }
  });
  document.addEventListener('submit',async event=>{
    const form=event.target,kind=form.dataset.checkWork,call=current;
    if(!kind||!call||!call.root.contains(form))return;
    event.preventDefault();
    const button=form.querySelector('[type=submit]');
    if(button.disabled||!call.connected)return;
    showNotice(call,kind,'');
    const data=Object.fromEntries(new FormData(form));
    if(kind==='start')data.seconds=Number(data.seconds);
    call.pending.add(kind);
    paintControls(call);
    try{
      const response=await fetch('/api/work/checks',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},
        body:JSON.stringify({...data,kind,id:call.check?.id})});
      const result=await response.json();
      if(!response.ok)throw Error(result.error);
      if(!isOpen(call))return;
      if(kind==='start'){
        call.startId=result.id;
        call.check={id:result.id,state:'queued',player:data.player,reason:data.reason,seconds:data.seconds,created:Date.now()};
        call.action=null;
        resetRoom(call);
        changeText(call.el('empty').lastElementChild,'Сообщения игрока появятся здесь.');
        paintSession(call);
      }
      if(finishKind(kind))call.requestedFinish=kind;
      if(kind==='chat'&&form.elements.message.value===data.message){
        form.reset();
        changeText(call.el('count'),'0 / 500');
      }
      if(call.loading)await call.loading;
      await refresh(call);
    }catch(error){
      if(isOpen(call))showNotice(call,kind,error.message||'Не удалось выполнить действие.');
    }finally{
      call.pending.delete(kind);
      if(isOpen(call))paintControls(call);
    }
  });
}
