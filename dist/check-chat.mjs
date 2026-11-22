const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const time=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'});
const day=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'long',year:'numeric'});

export function chatMessages(check,messages,start=0){
  return messages.slice(start).map((item,index)=>{
    const date=day.format(item.created);
    const previous=messages[start+index-1];
    const divider=!previous||day.format(previous.created)!==date?`<div class="call-message-date">${escapeHtml(date)}</div>`:'';
    const moderator=item.side==='moderator';
    const author=moderator?check.moderator:check.player;
    return `${divider}<article class="call-message" data-side="${moderator?'moderator':'player'}">
      <div><strong>${escapeHtml(author)}</strong><time>${time.format(item.created)}</time></div><p>${escapeHtml(item.body)}</p></article>`;
  }).join('');
}

function createDialog(){
  const dialog=document.createElement('dialog');
  dialog.className='check-chat-dialog';
  dialog.setAttribute('aria-labelledby','check-chat-title');
  dialog.innerHTML=`<header><div><h2 id="check-chat-title">История чата</h2><p data-chat-player></p></div>
    <form method="dialog"><button class="close-button" aria-label="Закрыть" autofocus>×</button></form></header>
    <div class="call-messages" data-chat-log tabindex="0" aria-label="Переписка проверки"></div>
    <footer><p data-chat-notice role="status"></p><button class="button" type="button" data-chat-older hidden>Загрузить более ранние сообщения</button></footer>`;
  document.body.append(dialog);
  dialog.addEventListener('click',event=>{
    if(event.target===dialog){
      const box=dialog.getBoundingClientRect();
      if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();
    }
  });
  return dialog;
}

export function bindCheckChat(){
  let dialog,active;
  async function load(archive,before=null){
    const log=dialog.querySelector('[data-chat-log]'),notice=dialog.querySelector('[data-chat-notice]');
    const more=dialog.querySelector('[data-chat-older]');
    more.disabled=true;
    notice.textContent='Загрузка…';
    try{
      const query=new URLSearchParams({id:archive.id});
      if(before!==null)query.set('before',before);
      const response=await fetch('/api/work/checks/chat?'+query,{cache:'no-store',signal:archive.request.signal});
      const result=await response.json();
      if(!response.ok)throw Error(result.error);
      if(active!==archive||!dialog.open)return;
      const {check,messages,older}=result;
      dialog.querySelector('[data-chat-player]').textContent=check.player+' · '+day.format(check.created);
      const formerHeight=log.scrollHeight,top=log.scrollTop;
      archive.messages.unshift(...messages);
      log.innerHTML=chatMessages(check,archive.messages);
      log.scrollTop=before===null?log.scrollHeight:top+log.scrollHeight-formerHeight;
      archive.older=older;
      notice.textContent=archive.messages.length?'':'В этой проверке сообщений не было.';
      more.hidden=older===null;
    }catch(error){
      if(!archive.request.signal.aborted&&active===archive)notice.textContent=error.message||'Не удалось открыть чат.';
    }finally{
      if(active===archive)more.disabled=false;
    }
  }

  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-check-chat]');
    if(!button?.dataset.checkChat)return;
    if(!dialog){
      dialog=createDialog();
      dialog.querySelector('[data-chat-older]').addEventListener('click',()=>{
        if(active?.older!=null)load(active,active.older);
      });
      dialog.addEventListener('close',()=>{
        active?.request.abort();
        active=undefined;
      });
    }
    active?.request.abort();
    active={id:button.dataset.checkChat,request:new AbortController(),messages:[]};
    dialog.querySelector('[data-chat-log]').replaceChildren();
    dialog.querySelector('[data-chat-player]').textContent='';
    dialog.querySelector('[data-chat-older]').hidden=true;
    dialog.showModal();
    load(active);
  });
  window.addEventListener('hashchange',()=>{if(dialog?.open)dialog.close();});
}
