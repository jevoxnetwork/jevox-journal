import { staffPositions as positions, canViewStaff, canViewStaffChecks, canDeleteStaffChecks, canEditRoster, canEditMember, canAssignPosition, canDeleteFormerRecord, canDiscipline, canManageManuals, isSanctionImmune } from '../worker/staff-positions.mjs';
import { profileBanners, canUseBanner } from '../worker/profile-banners.mjs';
import { manualMarkupPrefix, readFormattedManual, saveFormattedManual, manualLink, observeManualImages } from './manual-content.mjs';
import { createCursorWeb } from './cursor-web.mjs';
import { createBackgroundParticles, normalizeParticles, particleSliders, particleStyles } from './background-particles.mjs';
import { enableSkinRotation } from './skin-rotation.mjs';
import { bundledMemberSkins } from '../worker/minecraft-skins.mjs';
import { checksPage, loadChecks, bindCheckWork } from './check-work.mjs';
const $=(s,el=document)=>el.querySelector(s), $$=(s,el=document)=>[...el.querySelectorAll(s)];
const account=JSON.parse($('#auth-session').textContent);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={book:'<path d="M2 4l8 3v14l-8-3zM22 4l-8 3v14l8-3z"/>',chevron:'<path d="m6 9 6 6 6-6"/>',users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3c0-6 12-6 12 0v3m1-17c5 0 5 7 0 7m3 4c3 1 3 4 3 6"/>',scan:'<circle cx="11" cy="11" r="6"/><path d="m16 16 5 5"/>',shield:'<path d="m12 2 8 4v6c0 6-8 10-8 10S4 18 4 12V6z"/>',trend:'<path d="m3 17 6-6 4 4 8-10m-6 0h6v6"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>'};
paths.document='<path d="M6 3h8l5 5v13H6zM14 3v5h5M9 13h7m-7 4h5"/>';
paths.settings='<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="8" cy="7" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="10" cy="17" r="2"/>';
paths.check='<path d="m5 12 4 4L19 6"/>';
paths.image='<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="9" r="1.5"/><path d="m3 16 5-4 4 3 4-5 5 6"/>';
paths.bell='<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>';
paths.calendar='<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18"/>';
paths.archive='<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v12h14V8m-9 4h4"/>';
const icon=n=>`<svg viewBox="0 0 24 24" aria-hidden="true">${paths[n]||paths.book}</svg>`;
const pages={settings:['Настройки','settings'],profile:['Личный профиль','users'],overview:['Ваш журнал','book'],logs:['Логи действий','book'],team:['Команда проекта','users'],management:['Управление составом','shield'],former:['Бывший состав','users'],stats:['Статистика','trend'],manuals:['Мануалы','book'],top:['Топ состава','trend']};
const myPosition=account.user.position;
pages.checks=['Мои проверки','scan'];
if(canViewStaffChecks(myPosition))pages['staff-checks']=['Проверки персонала','scan'];
bindCheckWork({
  csrf:account.csrf,
  showDelete:body=>showModal(modalHeader('Удалить проверку?')+body),
});
const isOwner=myPosition==='Владелец';
const canClearStaffWork=canDeleteFormerRecord(myPosition);
const canReadLogs=canViewStaff(myPosition);
const mayManageManuals=canManageManuals(myPosition);
const groups=[
  {label:'Журнал',routes:['overview','team','checks']},
  {label:'Управление',routes:[...(rosterEditor()?['management','former']:[]),...(canReadLogs?['logs']:[]),...(canViewStaffChecks(myPosition)?['staff-checks']:[])]},
  {label:'Ресурсы',routes:['manuals']},
  {label:'Активности',routes:['stats','top']},
].filter(group=>group.routes.length||group.placeholder);
if(!canReadLogs)delete pages.logs;
if(!rosterEditor()){delete pages.management;delete pages.former;}
let route='overview',staff=[],moderators=[],formerModerators=[];
function rosterEditor(){return canEditRoster(myPosition)}
function assignablePositions(){return positions.filter(position=>canAssignPosition(myPosition,position))}
function assignableFor(member){return member?.position==='Владелец'?[member.position]:positions.filter(position=>canAssignPosition(myPosition,position))}
function toast(text){const box=$('#toast');box.textContent=text;box.classList.add('visible');setTimeout(()=>box.classList.remove('visible'),3000)}
function closeMenus(){$$('#nav-popover,#profile-popover,#notifications-popover').forEach(x=>x.hidden=true);$$('.nav-button,#profile-button,#notifications-button').forEach(x=>x.setAttribute('aria-expanded','false'))}
window.addEventListener('resize',()=>{if(!$('#nav-popover').hidden)closeMenus();});
function modalHeader(title,description=''){return `<div class="modal-heading"><h2>${esc(title)}</h2><button class="close-button" data-action="close-modal" aria-label="Закрыть">×</button></div>${description?`<p class="modal-description">${esc(description)}</p>`:''}`}
function showModal(html, profile=false){$('#modal').classList.toggle('staff-dialog',profile);closeMenus();$('#modal-body').innerHTML=html;if(!$('#modal').open)$('#modal').showModal()}
const modal=$('#modal');
let pressedBackdrop=false;
function onModalBackdrop(event){
  if(event.target!==modal)return false;
  const {left,right,top,bottom}=modal.getBoundingClientRect();
  return event.clientX<left||event.clientX>right||event.clientY<top||event.clientY>bottom;
}
modal.addEventListener('pointerdown',event=>{pressedBackdrop=onModalBackdrop(event);});
modal.addEventListener('click',event=>{
  if(pressedBackdrop&&onModalBackdrop(event))modal.close();
  pressedBackdrop=false;
});
function navigate(next){
  const from=route;
  const manualRoute=/^manuals\/(?:new|view\/[a-f0-9-]+|edit\/[a-f0-9-]+)$/.test(next);
  const staffProfile=canViewStaff(myPosition)&&/^profile\/[a-f0-9-]+$/i.test(next);
  route=(Object.hasOwn(pages,next)||manualRoute||staffProfile)?next:'overview';
  closeMenus();
  if(location.hash.slice(1)!==route){
    const state=from!==route&&(staffProfile||route==='profile')?{profileFrom:from}:null;
    history.pushState(state,'','#'+route);
  }
  render();
  window.scrollTo({top:0,behavior:'instant'});
}
function navigation(){
  $('#navigation').innerHTML=groups.map((group,index)=>{
    if(!group.routes.length)return `<button type="button" class="nav-button" disabled>${group.label}</button>`;
    const active=group.routes.includes(route)||(route.startsWith('manuals/')&&group.routes.includes('manuals'));
    return `<button type="button" class="nav-button${active?' active':''}" data-nav="${index}" aria-expanded="false" aria-haspopup="menu">${group.label}${icon('chevron')}</button>`;
  }).join('');
}
function title(k,desc){return `<div class="page-title"><div><div class="eyebrow">JEVOX JOURNAL</div><h1>${esc(pages[k][0])}</h1><p>${esc(desc)}</p></div></div>`}
const journalThemes={black:'Чёрное',red:'Красное',monolith:'Монолитовое',green:'Зелёное',blue:'Синее'};
const themeStorageKey='jevox.journal.theme.'+account.user.id;
function readJournalTheme(){
  try{
    const saved=localStorage.getItem(themeStorageKey);
    if(Object.hasOwn(journalThemes,saved))return saved;
  }catch{}
  return 'black';
}
let journalTheme=readJournalTheme();
document.documentElement.dataset.journalTheme=journalTheme;
const cursorWebKey='jevox.journal.cursorWeb.'+account.user.id;
let cursorWebEnabled=false;
try{cursorWebEnabled=localStorage.getItem(cursorWebKey)==='on';}catch{}
const themeAccent=()=>getComputedStyle(document.documentElement).getPropertyValue('--theme-accent').trim()||'#d0d0d0';
const toggleCursorWeb=createCursorWeb(themeAccent);
toggleCursorWeb(cursorWebEnabled);

const particlesKey='jevox.journal.particles.'+account.user.id;
let particleSettings=normalizeParticles();
try{particleSettings=normalizeParticles(JSON.parse(localStorage.getItem(particlesKey)));}catch{}
const updateParticles=createBackgroundParticles(themeAccent);
updateParticles(particleSettings);

function settingsPage(){
  return `<section class="journal-settings">
    ${title('settings','Настройте тему и эффекты журнала.')}
    <div class="panel journal-theme-panel">
      <h2>Оформление</h2>
      <div class="journal-theme-grid" role="group" aria-label="Цветовое оформление">
        ${Object.entries(journalThemes).map(([theme,label])=>`<button class="journal-theme-card" type="button" data-set-theme="${theme}" aria-pressed="${theme===journalTheme}">
          <span class="theme-swatch" data-theme-swatch="${theme}" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="theme-card-label">${label}<span class="theme-selected" aria-hidden="true">${icon('check')}</span></span>
        </button>`).join('')}
      </div>
      <p class="journal-theme-message" role="status"></p>
    </div>
    <div class="panel journal-effect-panel">
      <label class="journal-effect-switch"><strong>Паутина под курсором</strong><input type="checkbox" data-cursor-web ${cursorWebEnabled?'checked':''}></label>
    </div>
    <section class="panel journal-effect-panel particle-settings" aria-labelledby="particle-settings-title">
      <div class="particle-settings-header">
        <h2 id="particle-settings-title">Фоновые частицы</h2>
        <label class="journal-effect-switch"><strong>Показывать</strong><input type="checkbox" data-particle-setting="enabled" ${particleSettings.enabled?'checked':''}></label>
      </div>
      <fieldset class="particle-controls" aria-labelledby="particle-settings-title" ${particleSettings.enabled?'':'disabled'}>
        <label class="particle-field">Эффект
          <select class="input" data-particle-setting="style">
            ${Object.entries(particleStyles).map(([key,label])=>`<option value="${key}" ${key===particleSettings.style?'selected':''}>${label}</option>`).join('')}
          </select>
        </label>
        <div class="particle-field">
          <label for="particle-color">Цвет</label>
          <div class="particle-color-options">
            <label><input type="checkbox" data-particle-setting="useThemeColor" ${particleSettings.useThemeColor?'checked':''}> По теме</label>
            <input id="particle-color" type="color" data-particle-setting="color" value="${particleSettings.useThemeColor?themeAccent():particleSettings.color}" ${particleSettings.useThemeColor?'disabled':''}>
          </div>
        </div>
        ${Object.entries(particleSliders).map(([key,{label,min,max}])=>`
          <div class="particle-field">
            <div class="particle-slider-label"><label for="particle-${key}">${label}</label><output for="particle-${key}" data-particle-value>${particleSettings[key]}%</output></div>
            <input id="particle-${key}" type="range" data-particle-setting="${key}" min="${min}" max="${max}" value="${particleSettings[key]}">
          </div>`).join('')}
      </fieldset>
    </section>
  </section>`;
}

function setJournalTheme(theme){
  if(!Object.hasOwn(journalThemes,theme))return;
  journalTheme=theme;
  document.documentElement.dataset.journalTheme=theme;
  if(particleSettings.useThemeColor){
    updateParticles(particleSettings);
    $('#particle-color').value=themeAccent();
  }
  for(const button of document.querySelectorAll('[data-set-theme]')){
    button.setAttribute('aria-pressed',String(button.dataset.setTheme===theme));
  }
  const notice=$('.journal-theme-message');
  try{
    localStorage.setItem(themeStorageKey,theme);
    notice.textContent='';
  }catch{
    notice.textContent='Тема применена до перезагрузки страницы.';
  }
}

document.addEventListener('change',event=>{
  if(!event.target.matches('[data-cursor-web]'))return;
  cursorWebEnabled=event.target.checked;
  toggleCursorWeb(cursorWebEnabled);
  try{localStorage.setItem(cursorWebKey,cursorWebEnabled?'on':'off');}catch{}
});

document.addEventListener('input',event=>{
  const control=event.target;
  const key=control.dataset.particleSetting;
  if(!key)return;
  const value=control.type==='checkbox'?control.checked:control.type==='range'?control.valueAsNumber:control.value;
  particleSettings=normalizeParticles({...particleSettings,[key]:value});
  updateParticles(particleSettings);

  if(key==='enabled')$('.particle-controls').disabled=!particleSettings.enabled;
  if(key==='useThemeColor'){
    const color=$('#particle-color');
    color.disabled=particleSettings.useThemeColor;
    color.value=particleSettings.useThemeColor?themeAccent():particleSettings.color;
  }
  if(control.type==='range')control.parentElement.querySelector('output').value=particleSettings[key]+'%';
});

document.addEventListener('change',event=>{
  if(!event.target.dataset.particleSetting)return;
  try{localStorage.setItem(particlesKey,JSON.stringify(particleSettings));}catch{}
});

function empty(message){return `<div class="panel empty">${icon('scan')}<p>${esc(message)}</p></div>`}

let ownSanctions;
let latestNotifications;
let notificationVersion=0;
let serverSummary;
const overviewNumber=new Intl.NumberFormat('ru-RU');
const overviewDate=new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Moscow'});
const overviewTime=new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Moscow'});

function membershipDate(value){if(!value)return 'Дата вступления в команду проекта не указана';const date=new Date(value+'T00:00:00Z');return 'В команде проекта с '+date.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});}

function overviewDiscipline(){
  if(ownSanctions===undefined)return 'Загружаем данные о взысканиях…';
  if(ownSanctions===null)return 'Сведения о взысканиях недоступны.';
  return `<span>Предупреждения <strong>${overviewNumber.format(ownSanctions.warnings)}</strong></span>
    <span>Выговоры <strong>${overviewNumber.format(ownSanctions.reprimands)}</strong></span>`;
}

function renderServerActivity(data,profile=false){
  const synced=kind=>data?.sync.some(source=>source.kind===kind);
  const period=profile?'За всё время':'Сегодня';
  const metrics=[
    { label:'Наказания', value:profile?data?.punishments:data?.punishmentsToday, kind:'punishments', symbol:'shield' },
    { label:'Проверки', value:profile?data?.checks:data?.today, kind:'checks', symbol:'scan' },
  ];
  const recorded=metric=>data?.linked&&Number.isFinite(metric.value)&&(synced(metric.kind)||metric.value>0||(profile&&data.adjusted?.includes(metric.kind)));
  let status='';
  if(data===undefined)status='Загружаем статистику…';
  else if(data===null)status='Не удалось загрузить статистику.';
  else if(!data.linked)status='Для статистики привяжите игровой ник через администратора журнала.';
  else if(!metrics.some(recorded))status='Данные с игрового сервера пока не поступали.';
  else if(!metrics.every(recorded))status='Часть статистики ещё не поступила с игрового сервера.';
  const cards=metrics.map(metric=>{
    const value=recorded(metric)?overviewNumber.format(metric.value):'—';
    if(profile)return personalMetric(metric.label+' за всё время',value);
    return `<div class="overview-metric">
      <span class="overview-metric-icon">${icon(metric.symbol)}</span>
      <div>
        <span class="overview-metric-label">${metric.label}</span>
        <strong>${value}</strong>
        <span class="overview-metric-period">${period}</span>
      </div>
    </div>`;
  });
  return `<div class="${profile?'personal-metrics personal-work':'overview-metrics'}">${cards.join('')}</div>
    ${status?`<p class="${profile?'personal-empty':'overview-state overview-activity-state'}">${status}</p>`:''}`;
}

function overviewNotifications(){
  if(!latestNotifications?.length){
    const message=latestNotifications===undefined?'Загружаем уведомления…':latestNotifications===null?'Не удалось загрузить уведомления.':'Уведомлений пока нет.';
    return `<div class="overview-notice-empty">${icon('bell')}<p class="overview-state">${message}</p></div>`;
  }
  return `<ul class="overview-notices">${latestNotifications.slice(0,3).map(item=>`<li>
    <span class="overview-notice-mark" ${item.read_at?'aria-hidden="true"':'role="img" aria-label="Непрочитанное" data-unread'}></span>
    <div><p>${esc(item.message)}</p><time>${overviewTime.format(item.created_at*1000)}</time></div>
  </li>`).join('')}</ul>`;
}

function overview(){
  const links=['team','manuals',...(rosterEditor()?['management']:[]),...(canReadLogs?['logs']:[]),'settings'];
  return `<div class="overview">
    <section class="panel overview-cover" aria-labelledby="overview-title">
      <div class="overview-intro">
        <span class="overview-date">${icon('calendar')}${overviewDate.format(new Date())}</span>
        <h1 id="overview-title">Ваш журнал</h1>
        <p class="overview-member"><strong>${esc(account.user.displayName)}</strong> <span>${esc(myPosition||'Должность не указана')}</span></p>
        <p class="overview-membership">${esc(membershipDate(account.user.staffSince))}</p>
        <button class="button primary overview-profile-link" data-route="profile">Личный профиль ${icon('arrow')}</button>
        ${isSanctionImmune(myPosition)?'':`<div id="overview-discipline" class="overview-discipline">${overviewDiscipline()}</div>`}
      </div>
      <div class="overview-image" aria-hidden="true"></div>
    </section>

    <section class="panel overview-activity" aria-labelledby="overview-activity-title">
      <header class="overview-panel-heading"><h2 id="overview-activity-title">Моя работа на сервере</h2></header>
      <div id="overview-activity">${renderServerActivity(serverSummary)}</div>
    </section>

    <div class="overview-bottom">
      <section class="panel overview-inbox" aria-labelledby="overview-inbox-title">
        <header class="overview-panel-heading">
          <h2 id="overview-inbox-title">Уведомления</h2>
          <button type="button" class="overview-inbox-link" data-overview-notifications>Все уведомления ${icon('arrow')}</button>
        </header>
        <div id="overview-notifications">${overviewNotifications()}</div>
      </section>
      <section class="panel overview-shortcuts" aria-labelledby="overview-shortcuts-title">
        <header class="overview-panel-heading"><h2 id="overview-shortcuts-title">Быстрый доступ</h2></header>
        <ul>${links.map(link=>`<li><button type="button" data-route="${link}"><span class="overview-shortcut-icon">${icon(pages[link][1])}</span><span>${pages[link][0]}</span>${icon('arrow')}</button></li>`).join('')}</ul>
      </section>
    </div>
  </div>`;
}

function updateOverview(id,html){
  const element=document.getElementById(id);
  if(element)element.innerHTML=html;
}

async function loadOwnSanctions(){
  if(isSanctionImmune(myPosition))return;
  try{
    const response=await window.journalFetch('/api/me/sanctions',{cache:'no-store'});
    if(!response.ok)throw Error();
    ownSanctions=(await response.json()).sanctions;
  }catch{
    ownSanctions=null;
  }
  updateOverview('overview-discipline',overviewDiscipline());
}
function vkLink(id){return id?`<a href="https://vk.ru/id${esc(id)}" target="_blank" rel="noopener noreferrer">vk.ru/id${esc(id)} ↗</a>`:'<span class="muted">Не указан</span>'}
function staffProfileName(member){return canViewStaff(myPosition)?`<button class="roster-name" data-route="profile/${esc(member.id)}">${esc(member.nickname)} <span>↗</span></button>`:`<strong>${esc(member.nickname)}</strong>`;}
function teamTable(results,query=''){return results.length?`<table class="roster"><thead><tr><th>Ник</th><th>Должность</th><th>ВКонтакте</th></tr></thead><tbody>${positions.map(position=>{const list=results.filter(m=>m.position===position);return list.length?`<tr class="roster-group"><th colspan="3">${esc(position)} <span>${list.length}</span></th></tr>${list.map(m=>`<tr><td>${staffProfileName(m)}</td><td>${esc(m.position)}</td><td>${vkLink(m.vk_id)}</td></tr>`).join('')}`:''}).join('')}</tbody></table>`:`<div class="roster-empty">${query.trim()?'Ничего не найдено.':'Сотрудники пока не добавлены.'}</div>`}
const voxelFaces=['front','right','top','back','left','bottom'];
function voxelSurface(face='',textures){
  return voxelFaces.map(side=>{
    const style=textures?` style="${textures[side]}"`:'';
    return `<i class="voxel-${side}"${style}>${side==='front'?face:''}</i>`;
  }).join('');
}
function voxelPart(name,face=''){
  return `<span class="voxel-part ${name}">${voxelSurface(face)}</span>`;
}
function voxelStage(parts,full,variant){
  const attributes=full?'data-rotate-skin tabindex="0" role="group" aria-label="Модель скина. Перетащите или используйте стрелки для вращения."':'aria-hidden="true"';
  return `<div class="voxel-stage ${full?'voxel-full':'voxel-icon'} ${variant}" ${attributes}><div class="voxel-model" aria-hidden="true">${parts}</div></div>`;
}
function pixelFace(variant){
  const designs={
    steve:['hhhhhhhh','hhhhhhhh','hssssssh','ssssssss','swessews','ssssssss','sshsshss','sshhhhss'],
    ash:['hhhhhhhh','hhhhhhhh','hhhsshhh','hhsssssh','hsessesh','hssssssh','hssmmssh','hssssssh'],
    dusk:['hhhhhhhh','hhmmmhhh','hmsssmmh','hmsssmmh','hmesemmh','hmsssmmh','hmsmsmmh','hhhmmhhh']
  };
  return `<span class="voxel-pixels">${designs[variant].join('').split('').map(pixel=>`<b class="pixel-${pixel}"></b>`).join('')}</span>`;
}
function staffModel(full=false,variant='steve'){
  const torso='<span class="voxel-shirt"></span>';
  const head=voxelPart('voxel-head',pixelFace(variant));
  const body=full?voxelPart('voxel-torso',torso)+voxelPart('voxel-arm arm-left')+voxelPart('voxel-arm arm-right')+voxelPart('voxel-leg leg-left')+voxelPart('voxel-leg leg-right'):'';
  return voxelStage(head+body,full,variant);
}
function atlasFaces(x,y,width,depth){
  return {
    top:[x+depth,y],bottom:[x+depth+width,y],
    right:[x,y+depth],front:[x+depth,y+depth],
    left:[x+depth+width,y+depth],back:[x+2*depth+width,y+depth],
  };
}
function atlasedPart(name,base,overlay,width,height,depth,atlasHeight){
  const pixel=6;
  const expansion=name==='voxel-head'?6:3;
  const textures=(origin,inflation)=>{
    const coordinates=atlasFaces(...origin,width,depth);
    return Object.fromEntries(voxelFaces.map(side=>{
      const sideWidth=(side==='right'||side==='left'?depth:width)*pixel;
      const sideHeight=(side==='top'||side==='bottom'?depth:height)*pixel;
      const scaleX=(sideWidth+inflation)/sideWidth;
      const scaleY=(sideHeight+inflation)/sideHeight;
      const [x,y]=coordinates[side];
      return [side,`background-position:${-x*pixel*scaleX}px ${-y*pixel*scaleY}px;background-size:${64*pixel*scaleX}px ${atlasHeight*pixel*scaleY}px`];
    }));
  };
  const inner=voxelSurface('',textures(base,0));
  const outer=overlay?`<span class="voxel-layer" style="--w:${width*pixel+expansion}px;--h:${height*pixel+expansion}px;--d:${depth*pixel+expansion}px">${voxelSurface('',textures(overlay,expansion))}</span>`:'';
  return `<span class="voxel-part ${name}">${inner}${outer}</span>`;
}
function texturedModel(full,slim,height=64){
  const legacy=height===32;
  const part=(name,base,overlay,w,h,d)=>atlasedPart(name,base,legacy&&name!=='voxel-head'?null:overlay,w,h,d,height);
  const arm=slim?3:4;
  const parts=[part('voxel-head',[0,0],[32,0],8,8,8)];
  if(full)parts.push(
    part('voxel-torso',[16,16],[16,32],8,12,4),
    part('voxel-arm arm-left',[40,16],[40,32],arm,12,4),
    part(`voxel-arm arm-right${legacy?' legacy-limb':''}`,legacy?[40,16]:[32,48],[48,48],arm,12,4),
    part('voxel-leg leg-left',[0,16],[0,32],4,12,4),
    part(`voxel-leg leg-right${legacy?' legacy-limb':''}`,legacy?[0,16]:[16,48],[0,48],4,12,4),
  );
  return voxelStage(parts.join(''),full,`pirs-skin${slim?' slim-skin':''}`);
}
enableSkinRotation();
const loadedSkins=new Map();
function memberSkin(nickname,full=false,variant='steve'){
  if(!nickname)return staffModel(full,variant);
  const name=nickname.toLowerCase();
  if(name==='1pirs')return texturedModel(full,true);
  const bundled=Object.hasOwn(bundledMemberSkins,name)?bundledMemberSkins[name]:null;
  const style=bundled?` style="--minecraft-skin:url(${bundled.path})"`:'';
  const model=bundled?texturedModel(full,bundled.slim):staffModel(full,variant);
  return `<div class="skin-slot" data-official-skin="${esc(name)}" data-full="${full}"${style}>${model}</div>`;
}
async function resolveSkin(name){
  const response=await window.journalFetch('/api/minecraft-skin/'+encodeURIComponent(name));
  if(!response.ok)return null;
  const {skin,slim}=await response.json();
  const hash=skin?.match(/^https:\/\/textures\.minecraft\.net\/texture\/([a-f0-9]{32,64})$/)?.[1];
  if(!hash)return null;
  const texture='/assets/minecraft-textures/'+hash+'.png';
  const image=new Image();
  image.src=texture;
  try{
    await image.decode();
  }catch{
    image.src=skin;
    await image.decode();
  }
  if(image.naturalWidth!==64||![32,64].includes(image.naturalHeight))return null;
  return {skin:image.src,slim:slim&&image.naturalHeight===64,height:image.naturalHeight};
}
function loadMemberSkins(){
  for(const slot of $$('[data-official-skin]')){
    const name=slot.dataset.officialSkin;
    delete slot.dataset.officialSkin;
    if(!loadedSkins.has(name)){
      const request=resolveSkin(name).catch(()=>{
        loadedSkins.delete(name);
        return null;
      });
      loadedSkins.set(name,request);
    }
    loadedSkins.get(name).then(result=>{
      if(!result||!slot.isConnected)return;
      slot.style.setProperty('--minecraft-skin',`url("${result.skin}")`);
      slot.innerHTML=texturedModel(slot.dataset.full==='true',result.slim,result.height);
    });
  }
}
new MutationObserver(loadMemberSkins).observe($('#main'),{childList:true,subtree:true});
const leaderboardMetrics={checks:'Проверки',punishments:'Наказания'};
const leaderboardPeriods={month:'Топ месяца',all:'За всё время'};
let leaderboardMetric='checks';
let leaderboardPeriod='all';
let leaderboardData;
let leaderboardVersion=0;

function leaderboardPage(){
  leaderboardData=undefined;
  return `<section class="rank-page" aria-labelledby="rank-title">
    <header class="rank-header">
      <h1 id="rank-title">Топ состава</h1>
      <p>Активность действующего состава</p>
      <div class="rank-switch" role="group" aria-label="Период рейтинга">
        ${Object.entries(leaderboardPeriods).map(([key,label])=>`<button type="button" data-rank-period="${key}" aria-pressed="${leaderboardPeriod===key}">${label}</button>`).join('')}
      </div>
      <div class="rank-switch" role="group" aria-label="Показатель рейтинга">
        ${Object.entries(leaderboardMetrics).map(([key,label])=>`<button type="button" data-rank-metric="${key}" aria-pressed="${leaderboardMetric===key}">
          ${icon(key==='checks'?'scan':'shield')}${label}
        </button>`).join('')}
      </div>
    </header>
    <div id="rank-board" aria-live="polite"><p class="panel rank-state">Загружаем рейтинг…</p></div>
  </section>`;
}

function renderLeaderboard(board){
  if(!leaderboardData){
    board.innerHTML=`<p class="panel rank-state">${leaderboardData===null?'Не удалось загрузить рейтинг.':'Загружаем рейтинг…'}</p>`;
    return;
  }
  const metric=leaderboardMetric;
  const staff=leaderboardData.staff;
  const ordered=[...staff].sort((a,b)=>b[metric]-a[metric]||a.nickname.localeCompare(b.nickname,'ru'));
  const available=leaderboardData.synced.includes(metric)||ordered[0]?.[metric]>0;
  let lastPlace=0;
  const ranked=ordered.map((member,index)=>{
    const total=member[metric];
    if(index===0||total!==ordered[index-1][metric])lastPlace=index+1;
    return {...member,total,place:total>0?lastPlace:null};
  });
  const leaders=ranked.filter(member=>member.place!==null).slice(0,3);
  const others=ranked.slice(leaders.length);
  const displayTotal=total=>available?overviewNumber.format(total):'—';
  let note='';
  if(!staff.length)note='В составе пока нет сотрудников.';
  else if(!available)note=metric==='checks'?'Данные о проверках ещё не поступали.':'Данные о наказаниях ещё не поступали.';
  else if(!leaders.length)note=metric==='checks'?'Проверок пока нет.':'Наказаний пока нет.';

  board.innerHTML=`
    ${leaders.length?`<div class="rank-podium" data-size="${leaders.length}" aria-label="Лидеры рейтинга">
      ${leaders.map((member,index)=>`<article class="panel rank-card" data-slot="${index+1}" data-place="${member.place}">
        <div class="rank-model">
          <span class="rank-medal" aria-label="Место ${member.place}">${member.place}</span>
          ${memberSkin(member.nickname,true,['ash','dusk','steve'][index])}
        </div>
        <div class="rank-card-body">
          <div><h2>${staffProfileName(member)}</h2><p>${esc(member.position)}</p></div>
          <div class="rank-score"><strong>${displayTotal(member.total)}</strong><span>${leaderboardMetrics[metric]}</span></div>
        </div>
      </article>`).join('')}
    </div>`:''}
    ${note?`<p class="panel rank-state">${note}</p>`:''}
    ${others.length?`<section class="panel rank-directory" aria-label="Места в рейтинге">
      <ul>${others.map(member=>`<li class="rank-row">
        <span class="rank-row-place" aria-label="${member.place?'Место '+member.place:'Без места'}">${member.place??'—'}</span>
        <div class="rank-row-person">
          <div class="rank-avatar">${memberSkin(member.nickname)}</div>
          <div><span class="rank-row-name">${staffProfileName(member)}</span><span class="rank-row-position">${esc(member.position)}</span></div>
        </div>
        <strong class="rank-row-total" aria-label="${leaderboardMetrics[metric]}: ${displayTotal(member.total)}">${displayTotal(member.total)}</strong>
      </li>`).join('')}</ul>
    </section>`:''}`;
}

async function loadLeaderboard(){
  const board=$('#rank-board');
  if(!board)return;
  const version=++leaderboardVersion;
  leaderboardData=undefined;
  renderLeaderboard(board);
  try{
    const response=await window.journalFetch('/api/server/leaderboard?period='+leaderboardPeriod,{cache:'no-store'});
    if(!response.ok)throw Error();
    const data=await response.json();
    if(!board.isConnected||version!==leaderboardVersion)return;
    leaderboardData=data;
  }catch{
    if(!board.isConnected||version!==leaderboardVersion)return;
    leaderboardData=null;
  }
  renderLeaderboard(board);
}

document.addEventListener('click',event=>{
  const button=event.target.closest('button[data-rank-metric]');
  if(!button||button.dataset.rankMetric===leaderboardMetric)return;
  leaderboardMetric=button.dataset.rankMetric;
  for(const choice of $$('[data-rank-metric]'))choice.setAttribute('aria-pressed',String(choice===button));
  renderLeaderboard($('#rank-board'));
});
document.addEventListener('click',event=>{
  const button=event.target.closest('button[data-rank-period]');
  if(!button||button.dataset.rankPeriod===leaderboardPeriod)return;
  leaderboardPeriod=button.dataset.rankPeriod;
  for(const choice of $$('[data-rank-period]'))choice.setAttribute('aria-pressed',String(choice===button));
  loadLeaderboard();
});
function staffModalHeader(title,description){
  return `<div class="staff-dialog-profile">${staffModel()}${modalHeader(title,description)}</div>`;
}
function staffSection(title,content,wide=false){
  return `<section class="staff-info-card ${wide?'staff-info-wide':''}"><h3>${esc(title)}</h3><div class="staff-info-fields">${content}</div></section>`;
}
function staffFacts(title,entries,wide=false){
  return staffSection(title,entries.map(([label,value])=>`<dl><dt>${esc(label)}</dt><dd>${value}</dd></dl>`).join(''),wide);
}
function staffPersonal(m){
  return staffFacts('Личные данные',[
    ['Имя и фамилия',esc(m.real_name)],
    ['Дата рождения',formatDate(m.birth_date)]
  ]);
}
function staffContacts(m){
  return staffFacts('Контакты',[
    ['ВКонтакте',vkLink(m.vk_id)],
    ['Telegram ID',esc(m.telegram_id||'Не указан')]
  ]);
}
function featuredOwners(people){return people.filter(person=>person.position==='Владелец').slice(0,2)}
function rosterWithoutOwnerCards(people){
  const featured=new Set(featuredOwners(people).map(person=>person.id));
  return people.filter(person=>!featured.has(person.id));
}
function ownerCards(people){
  const owners=featuredOwners(people);
  return `<section id="team-owners" class="team-owners" aria-label="Владельцы">${[0,1].map(index=>{
    const owner=owners[index];
    const model=memberSkin(owner?.nickname,true,index===0?'dusk':'ash');
    return `<article class="panel owner-card"><span class="owner-label">Владелец</span>${model}<h2>${owner?staffProfileName(owner):'Свободное место'}</h2>${owner?.vk_id?vkLink(owner.vk_id):''}</article>`;
  }).join('')}</section>`;
}
function team(){return title('team','Команда Jevox Network')+ownerCards(staff)+`<div class="team-search"><span aria-hidden="true">${icon('scan')}</span><input id="team-search" class="input" type="search" maxlength="120" autocomplete="off" aria-label="Поиск по нику или имени и фамилии" placeholder="Поиск по нику или имени и фамилии"></div><section class="panel roster-wrap" id="team-results">${teamTable(rosterWithoutOwnerCards(staff))}</section>`}
let teamSearchTimer,teamSearchVersion=0;
async function searchTeam(query){const version=++teamSearchVersion;try{const r=await window.journalFetch('/api/staff?q='+encodeURIComponent(query),{cache:'no-store'});if(!r.ok)throw Error();const results=(await r.json()).users;if(version!==teamSearchVersion||route!=='team'||$('#team-search')?.value!==query)return;$('#team-results').innerHTML=teamTable(query.trim()?results:rosterWithoutOwnerCards(results),query)}catch{if(version===teamSearchVersion)toast('Не удалось выполнить поиск.') }}
document.addEventListener('input',e=>{if(e.target.id!=='team-search')return;const query=e.target.value;++teamSearchVersion;clearTimeout(teamSearchTimer);teamSearchTimer=setTimeout(()=>searchTeam(query),180)});
function manualPage(){
  return `<section class="manual-directory">
    ${title('manuals','Материалы для сотрудников сервера.')}
    ${mayManageManuals?'<div class="manual-directory-actions"><button class="button primary" data-action="new-manual">Создать мануал</button></div>':''}
    <div id="manual-list" class="panel manual-directory-panel" aria-live="polite">
      <p class="manual-directory-state">Загрузка…</p>
    </div>
  </section>`;
}

async function refreshNotifications(open=false){
  const version=++notificationVersion;
  try{
    const response=await window.journalFetch('/api/notifications',{cache:'no-store'});
    if(!response.ok)throw Error();
    const {notifications}=await response.json();
    if(version!==notificationVersion)return;
    latestNotifications=notifications;
    updateOverview('overview-notifications',overviewNotifications());

    const unread=notifications.filter(item=>!item.read_at).length;
    const badge=$('#notify-count');
    badge.hidden=!unread;
    badge.textContent=unread>99?'99+':String(unread);
    if(!open)return;

    const panel=$('#notifications-popover');
    panel.innerHTML=`<div class="notification-heading"><span id="notification-list-heading">Уведомления</span>
      ${notifications.length?'<button type="button" class="notification-clear" data-clear-notifications>Очистить</button>':''}</div>
      ${notifications.length?`<div class="notification-scroll" role="region" aria-labelledby="notification-list-heading" tabindex="0">
        ${notifications.map(n=>`<div class="notification-item ${n.read_at?'':'unread'}"><p>${esc(n.message)}</p><time>${formatTimestamp(n.created_at)}</time></div>`).join('')}
      </div>`:'<div class="notification-empty">Уведомлений пока нет.</div>'}`;
    panel.hidden=false;
    $('#notifications-button').setAttribute('aria-expanded','true');
    if(unread){
      const marked=await window.journalFetch('/api/notifications/read',{method:'POST',headers:{'X-CSRF-Token':account.csrf}});
      if(!marked.ok||version!==notificationVersion)return;
      const readAt=Math.floor(Date.now()/1000);
      const readIds=new Set(notifications.map(item=>item.id));
      latestNotifications=latestNotifications.map(item=>readIds.has(item.id)?{...item,read_at:item.read_at||readAt}:item);
      badge.hidden=latestNotifications.every(item=>item.read_at);
      updateOverview('overview-notifications',overviewNotifications());
    }
  }catch{
    if(version!==notificationVersion)return;
    latestNotifications??=null;
    updateOverview('overview-notifications',overviewNotifications());
    if(open)toast('Не удалось загрузить уведомления.');
  }
}

document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-clear-notifications]');
  if(!button||button.disabled)return;
  button.disabled=true;
  try{
    const response=await window.journalFetch('/api/notifications/clear',{method:'POST',headers:{'X-CSRF-Token':account.csrf}});
    if(!response.ok)throw Error();
    await refreshNotifications(!$('#notifications-popover').hidden);
    toast('Уведомления очищены');
  }catch{
    button.disabled=false;
    toast('Не удалось очистить уведомления.');
  }
});

document.addEventListener('click',event=>{
  if(!event.target.closest('[data-overview-notifications]'))return;
  const button=$('#notifications-button');
  button.scrollIntoView({block:'nearest'});
  button.focus({preventScroll:true});
  button.click();
});

let sanctionsList=[],selectedStaffProfile=null;
function newStaffSanction(){
  const id=route.split('/')[1];
  if(!id||!selectedStaffProfile||selectedStaffProfile.id!==id)return;
  showModal(modalHeader('Выдать наказание',selectedStaffProfile.nickname)+`<form data-staff-sanction class="ban-create">
    <input type="hidden" name="moderatorId" value="${esc(id)}">
    <label>Вид наказания<select class="input" name="type"><option value="warning">Предупреждение</option><option value="reprimand">Выговор</option></select></label>
    <label>Причина<textarea class="input" name="reason" rows="3" minlength="3" maxlength="500" required placeholder="Укажите причину"></textarea></label>
    <button class="button primary" type="submit">Выдать</button>
  </form>`);
}
function confirmSanctionRevoke(id){const item=sanctionsList.find(x=>x.id===id);if(!item)return;showModal(modalHeader('Снять наказание',`Снять ${item.type==='warning'?'предупреждение':'выговор'} сотруднику ${selectedStaffProfile?.nickname||''}?`)+`<div class="detail-actions"><button class="button primary" data-confirm-sanction-revoke="${esc(id)}">Снять наказание</button><button class="button" data-action="close-modal">Отмена</button></div>`)}
async function revokeSanction(button){button.disabled=true;try{const r=await window.journalFetch(`/api/staff-sanctions/${encodeURIComponent(button.dataset.confirmSanctionRevoke)}/revoke`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':account.csrf},body:'{}'}),data=await r.json();if(!r.ok)throw Error(data.error);$('#modal').close();toast('Наказание снято');loadPersonalProfile();loadOwnSanctions()}catch(e){button.disabled=false;toast(e.message||'Не удалось снять наказание.')}}
document.addEventListener('submit',async e=>{const form=e.target.closest('form[data-staff-sanction]');if(!form)return;e.preventDefault();const button=form.querySelector('[type=submit]'),data=Object.fromEntries(new FormData(form));button.disabled=true;try{const r=await window.journalFetch('/api/staff-sanctions',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':account.csrf},body:JSON.stringify(data)}),result=await r.json();if(!r.ok)throw Error(result.error);$('#modal').close();toast('Наказание выдано');loadPersonalProfile();loadOwnSanctions()}catch(error){button.disabled=false;toast(error.message||'Не удалось выдать наказание.')}});
function management(){
  const addButton=assignablePositions().length?'<button class="button primary" data-action="add-moderator">Добавить модератора</button>':'';
  return title('management','Сотрудники и доступ к журналу.')+`<section class="panel">
    <div class="panel-head"><h2>${icon('users')}Команда проекта</h2>${addButton}</div>
    <div class="staff-form-error management-add-error" id="management-add-error" role="alert"></div>
    <div id="management-list" class="roster-wrap">Загрузка…</div>
  </section>`;
}
function formerArchive(){
  return `<section class="former-archive" aria-labelledby="former-title">
    <header class="former-page-heading">
      <span class="former-page-icon">${icon('archive')}</span>
      <h1 id="former-title">Бывший состав</h1>
      <p>Сотрудники, снятые с должности в Jevox Network.</p>
    </header>
    <div class="panel former-directory">
      <div class="former-toolbar">
        <label class="former-search">
          ${icon('scan')}
          <input id="former-search" type="search" aria-label="Поиск по нику или должности" placeholder="Поиск по нику или должности" disabled>
        </label>
        <span id="former-count" role="status"></span>
      </div>
      <div id="former-list"><p class="former-state" role="status">Загружаем архив…</p></div>
    </div>
  </section>`;
}

function renderFormerList(){
  const search=$('#former-search');
  const query=search.value.trim().toLocaleLowerCase('ru');
  const matches=formerModerators.filter(({nickname,position})=>
    [nickname,position].some(value=>value.toLocaleLowerCase('ru').includes(query))
  );
  $('#former-count').textContent='Записей '+matches.length;
  $('#former-list').innerHTML=matches.length?`<ul class="former-records">${matches.map(member=>`
    <li>
      <button type="button" class="former-record" data-former-id="${esc(member.id)}" aria-haspopup="dialog">
        <span class="former-record-avatar" aria-hidden="true">${esc(member.nickname.slice(0,2).toUpperCase())}</span>
        <span class="former-record-identity"><strong>${esc(member.nickname)}</strong><span>${esc(member.position)}</span></span>
        <span class="former-record-meta former-record-date"><small>Дата снятия</small><span>${formatTimestamp(member.removed_at)}</span></span>
        <span class="former-record-meta former-record-actor"><small>Кто снял</small><span>${esc(member.removed_by_name||'Неизвестно')}</span></span>
        <span class="former-record-arrow">${icon('arrow')}</span>
      </button>
    </li>`).join('')}</ul>`:
    `<p class="former-state">${query&&formerModerators.length?'По вашему запросу ничего не найдено.':'Бывших сотрудников пока нет.'}</p>`;
}

async function loadFormerArchive(){
  const list=$('#former-list');
  if(!list)return;
  try{
    const response=await window.journalFetch('/api/admin/former-moderators',{cache:'no-store'});
    if(!response.ok)throw Error();
    const {moderators}=await response.json();
    if(!list.isConnected)return;
    formerModerators=moderators;
    $('#former-search').disabled=!moderators.length;
    renderFormerList();
  }catch{
    if(list.isConnected)list.innerHTML='<p class="former-state" role="alert">Не удалось загрузить архив сотрудников.</p>';
  }
}

document.addEventListener('input',event=>{
  if(event.target.id==='former-search')renderFormerList();
});
function render(){navigation();let html=route==='settings'?settingsPage():route.startsWith('manuals/')?manualSubpage():(route==='profile'||route.startsWith('profile/'))?profilePage():route==='logs'?actionLogsPage():route==='checks'||route==='staff-checks'?checksPage(route==='staff-checks',icon,canDeleteStaffChecks(myPosition)):route==='top'?leaderboardPage():route==='overview'?overview():route==='team'?team():route==='former'?formerArchive():route==='management'?management():route==='stats'?title('stats','Активность модерации.')+empty('Статистика появится после подключения сервера.'):manualPage();$('#main').innerHTML=`<div class="route-content ${['team','management','former','logs'].includes(route)?'staff-route':''}">${html}</div>`;document.title=(pages[route]?.[0]||(route.startsWith('profile/')?'Профиль сотрудника':'Мануал'))+' — Jevox Journal';if(route.startsWith('manuals/'))loadManualSubpage(route);if(route==='management')loadManagement();if(route==='former')loadFormerArchive();if(route==='logs')loadActionLogs();if(route==='manuals')loadManuals();if(route==='overview')loadServerSummary();if(route==='top')loadLeaderboard();if(route==='checks'||route==='staff-checks')loadChecks();if(route==='profile'||route.startsWith('profile/'))loadPersonalProfile();}
async function loadStaff(){try{const r=await window.journalFetch('/api/staff',{cache:'no-store'});if(!r.ok)throw Error();staff=(await r.json()).users;const owners=$('#team-owners');if(owners)owners.outerHTML=ownerCards(staff);if(route==='team'){const input=$('#team-search');if(input)searchTeam(input.value);else render()}}catch{toast('Не удалось загрузить состав.') }}
async function loadManagement(){const box=$('#management-list');if(!box)return;try{const r=await window.journalFetch('/api/admin/moderators',{cache:'no-store'});if(!r.ok)throw Error();const payload=await r.json(),result=payload.moderators;if(!box.isConnected)return;moderators=result;box.innerHTML=result.length?`<table class="roster"><thead><tr><th>Ник</th><th>Должность</th><th>ВКонтакте</th><th></th></tr></thead><tbody>${positions.map(position=>{const list=result.filter(m=>m.position===position);return list.length?`<tr class="roster-group"><th colspan="4">${esc(position)} <span>${list.length}</span></th></tr>${list.map(m=>`<tr><td><button class="roster-name" data-moderator-id="${esc(m.id)}">${esc(m.nickname)} <span>↗</span></button></td><td>${esc(m.position)}</td><td>${vkLink(m.vk_id)}</td><td class="roster-actions"><div class="management-actions"><button class="button" data-route="profile/${esc(m.id)}">Профиль</button>${canEditMember(myPosition,m.position)?`<button class="button" data-edit-moderator="${esc(m.id)}">Изменить</button>`:''}${canAssignPosition(myPosition,m.position)?`<button class="button danger-button" data-remove-moderator="${esc(m.id)}">Снять</button>`:''}</div></td></tr>`).join('')}`:''}).join('')}</tbody></table>`:'<div class="roster-empty">Пока никого нет в составе.</div>'}catch{if(box.isConnected)box.textContent='Не удалось загрузить состав.'}}
function formatDate(date){return date?esc(date.split('-').reverse().join('.')):'Не указана'}
function formatTimestamp(timestamp){return timestamp?esc(new Date(timestamp*1000).toLocaleDateString('ru-RU')):'Неизвестно'}
function formerDetails(id){
  const m=formerModerators.find(person=>person.id===id);
  if(!m)return;
  const service=staffFacts('Служба на сервере',[
    ['В команде проекта с',formatDate(m.staff_since)],
    ['Назначен на должность',formatDate(m.appointment_date)],
    ['Добавлен в журнал',formatTimestamp(m.joined_at)]
  ],true);
  showModal(`<div class="former-profile">
    <div class="former-profile-heading">
      ${staffModel()}
      ${modalHeader(m.nickname,m.position)}
    </div>
    <section class="former-removal">
      <h3>${icon('archive')}Снятие с должности</h3>
      <dl>
        <div><dt>Дата снятия</dt><dd>${formatTimestamp(m.removed_at)}</dd></div>
        <div><dt>Кто снял</dt><dd>${esc(m.removed_by_name||'Неизвестно')}</dd></div>
      </dl>
      <div class="former-reason"><span>Причина снятия</span><p>${esc(m.removal_reason||'Не указана')}</p></div>
    </section>
    <div class="staff-info-grid">${service}${staffPersonal(m)}${staffContacts(m)}</div>
    <div class="detail-actions former-actions">
      ${canAssignPosition(myPosition,m.position)?`<button class="button primary" data-former-action="restore" data-record-id="${esc(m.id)}">Восстановить сотрудника</button>`:''}
      ${canDeleteFormerRecord(myPosition)?`<button class="button danger-button" data-former-action="delete" data-record-id="${esc(m.id)}">Удалить историю</button>`:''}
    </div>
  </div>`,true);
}
function confirmRemoval(id){const m=moderators.find(x=>x.id===id);if(!m)return;showModal(modalHeader('Снять сотрудника',`Снять ${m.nickname} с должности «${m.position}»?`)+`<p class="form-hint">Сотрудник переместится в бывший состав и потеряет доступ к журналу.</p><form data-removal-form="${esc(id)}" class="removal-form"><label>Причина снятия<textarea class="input" name="reason" required minlength="3" maxlength="500" rows="3" placeholder="Укажите причину снятия"></textarea></label><div class="detail-actions"><button class="button danger-button" type="submit">Снять сотрудника</button><button class="button" type="button" data-action="close-modal">Отмена</button></div></form>`)}
async function removeModerator(form){const button=form.querySelector('button[type=submit]'),reason=form.elements.reason.value.trim();if(reason.length<3){toast('Укажите причину снятия.');return}button.disabled=true;try{const r=await window.journalFetch(`/api/admin/moderators/${encodeURIComponent(form.dataset.removalForm)}/remove`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':account.csrf},body:JSON.stringify({reason})});const result=await r.json();if(!r.ok)throw Error(result.error);$('#modal').close();toast('Сотрудник снят');await loadManagement();loadStaff()}catch(error){toast(error.message||'Не удалось снять сотрудника.');button.disabled=false}}
function confirmFormerAction(id,action){
  const member=formerModerators.find(person=>person.id===id);
  const deleting=action==='delete';
  if(!member||!(deleting?canDeleteFormerRecord(myPosition):canAssignPosition(myPosition,member.position)))return;
  const heading=deleting?'Удалить историю':'Восстановить сотрудника';
  const question=deleting?`Удалить запись о сотруднике ${member.nickname} из бывшего состава?`:`Вернуть ${member.nickname} на должность «${member.position}»?`;
  showModal(`<div class="former-profile">
    <div class="former-profile-heading">${staffModel()}${modalHeader(heading,question)}</div>
    <p class="form-hint">${deleting?'Вместе с записью исчезнут сведения о снятии и возможность восстановить сотрудника из архива.':'Сотрудник снова сможет войти в журнал через привязанные аккаунты.'}</p>
    <p class="staff-form-error" data-former-error role="alert"></p>
    <div class="detail-actions">
      <button class="button" data-former-id="${esc(id)}">Назад</button>
      <button class="button ${deleting?'danger-button':'primary'}" data-confirm-former-action="${action}" data-record-id="${esc(id)}">${deleting?'Удалить историю':'Восстановить'}</button>
    </div>
  </div>`,true);
}

async function submitFormerAction(button,action){
  const notice=$('[data-former-error]');
  const deleting=action==='delete';
  notice.textContent='';
  button.disabled=true;
  try{
    const response=await window.journalFetch(`/api/admin/former-moderators/${encodeURIComponent(button.dataset.recordId)}/${action}`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':account.csrf},body:'{}'});
    const result=await response.json();
    if(!response.ok)throw Error(result.error);
    if(button.isConnected)$('#modal').close();
    toast(deleting?'Запись удалена из бывшего состава':'Сотрудник восстановлен');
    await loadFormerArchive();
    if(!deleting)loadStaff();
  }catch(error){
    notice.textContent=error.message||(deleting?'Не удалось удалить историю.':'Не удалось восстановить сотрудника.');
    button.disabled=false;
  }
}
document.addEventListener('click',event=>{
  const button=event.target.closest('button[data-former-action],button[data-confirm-former-action]');
  if(!button||button.disabled)return;
  if(button.dataset.confirmFormerAction)submitFormerAction(button,button.dataset.confirmFormerAction);
  else confirmFormerAction(button.dataset.recordId,button.dataset.formerAction);
});
function confirmManualDeletion(id){const heading=$('.manual-page-header h1');showModal(modalHeader('Удалить мануал',`Удалить «${heading?.textContent||'мануал'}»?`)+`<p class="form-hint">Мануал будет удалён из журнала.</p><div class="detail-actions"><button class="button danger-button" data-confirm-manual-delete="${esc(id)}">Удалить мануал</button><button class="button" data-action="close-modal">Отмена</button></div>`)}
async function deleteManual(button){button.disabled=true;try{const r=await window.journalFetch(`/api/manuals/${encodeURIComponent(button.dataset.confirmManualDelete)}/delete`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':account.csrf},body:'{}'}),result=await r.json();if(!r.ok)throw Error(result.error);$('#modal').close();toast('Мануал удалён');navigate('manuals')}catch(error){toast(error.message||'Не удалось удалить мануал.');button.disabled=false}}
document.addEventListener('submit',e=>{const form=e.target.closest('form[data-removal-form]');if(!form)return;e.preventDefault();removeModerator(form)});
function addModerator(){const notice=$('#management-add-error');if(notice)notice.textContent='';showModal(staffModalHeader('Добавить модератора','Укажите данные сотрудника и хотя бы один ID для входа.')+`<form data-add-moderator novalidate class="moderator-form staff-edit-grid"><p class="staff-form-error" data-add-error role="alert"></p><section class="staff-info-card"><h3>Служба на сервере</h3><div class="staff-info-fields"><label>Ник в Minecraft<input class="input" name="nickname" required minlength="3" maxlength="16" pattern="[A-Za-z0-9_]+" placeholder="Например, Player_123"></label><label>Должность<select class="input" name="position" required>${assignableFor().map(x=>`<option ${x==='Джуниор'?'selected':''}>${esc(x)}</option>`).join('')}</select></label><label>В команде проекта с<input class="input" type="date" name="staffSince" max="${new Date().toISOString().slice(0,10)}"></label><label>Дата назначения<input class="input" type="date" name="appointmentDate" value="${new Date().toISOString().slice(0,10)}" max="${new Date().toISOString().slice(0,10)}"></label></div></section><section class="staff-info-card"><h3>Личные данные</h3><div class="staff-info-fields"><label>Имя и фамилия<input class="input" name="realName" required minlength="2" maxlength="120" autocomplete="off" placeholder="Имя Фамилия"></label><label>Дата рождения<input class="input" type="date" name="birthDate" max="${new Date().toISOString().slice(0,10)}" required></label></div></section><section class="staff-info-card staff-info-wide"><h3>Вход в журнал</h3><div class="staff-info-fields"><label>ID ВКонтакте<input class="input" name="vkId" inputmode="numeric" pattern="[0-9]{1,30}" placeholder="Только цифры"></label><label>ID Telegram<input class="input" name="telegramId" inputmode="numeric" pattern="[0-9]{1,30}" placeholder="Только цифры"></label><label>ID Discord<input class="input" name="discordId" inputmode="numeric" pattern="[1-9][0-9]{16,19}" maxlength="20" required placeholder="ID пользователя Discord"></label></div></section><button class="button primary form-save" type="submit">Добавить в состав</button></form>`,true)}
function moderatorDetails(id){
  const m=moderators.find(person=>person.id===id);
  if(!m)return;
  const service=staffFacts('Служба на сервере',[
    ['В команде проекта с',formatDate(m.staff_since)],
    ['Назначен на должность',formatDate(m.appointment_date)],
    ['Добавлен в журнал',formatTimestamp(m.created_at)]
  ]);
  showModal(staffModalHeader(m.nickname,m.position)+
    `<div class="staff-info-grid">${service}${staffPersonal(m)}${staffContacts(m)}</div>`,true);
}
function editModerator(id){const m=moderators.find(x=>x.id===id);if(!m)return;showModal(staffModalHeader('Изменить сотрудника',m.nickname)+`<form data-edit-form="${esc(id)}" class="moderator-form staff-edit-grid"><section class="staff-info-card"><h3>Служба на сервере</h3><div class="staff-info-fields"><label>Ник в Minecraft<input class="input" name="nickname" value="${esc(m.nickname)}" required minlength="3" maxlength="16" pattern="[A-Za-z0-9_]+"></label><label>Должность<select class="input" name="position" data-original-position="${esc(m.position)}">${assignableFor(m).map(x=>`<option ${x===m.position?'selected':''}>${esc(x)}</option>`).join('')}</select></label><label>В команде проекта с<input class="input" type="date" name="staffSince" value="${esc(m.staff_since||'')}" max="${new Date().toISOString().slice(0,10)}"></label><label>Дата назначения<input class="input" type="date" name="appointmentDate" value="${esc(m.appointment_date||'')}" max="${new Date().toISOString().slice(0,10)}"></label></div></section><section class="staff-info-card"><h3>Личные данные</h3><div class="staff-info-fields"><label>Имя и фамилия<input class="input" name="realName" value="${esc(m.real_name)}" minlength="2" maxlength="120" required></label><label>Дата рождения<input class="input" type="date" name="birthDate" value="${esc(m.birth_date)}" max="${new Date().toISOString().slice(0,10)}" required></label></div></section><section class="staff-info-card staff-info-wide"><h3>Контакты</h3><div class="staff-info-fields"><label>ID ВКонтакте<input class="input" name="vkId" value="${esc(m.vk_id||'')}" pattern="[0-9]{1,30}" inputmode="numeric"></label><label>ID Telegram<input class="input" name="telegramId" value="${esc(m.telegram_id||'')}" pattern="[0-9]{1,30}" inputmode="numeric"></label><label>ID Discord<input class="input" name="discordId" value="${esc(m.discord_id||'')}" inputmode="numeric" pattern="[1-9][0-9]{16,19}" maxlength="20" placeholder="ID пользователя Discord"></label></div></section><button class="button primary form-save">Сохранить данные</button></form>`,true)}
async function loadManuals(){
  const box=$('#manual-list');
  if(!box)return;
  try{
    const response=await window.journalFetch('/api/manuals',{cache:'no-store'});
    if(!response.ok)throw Error();
    const {manuals}=await response.json();
    if(!box.isConnected)return;
    if(!manuals.length){
      box.innerHTML='<p class="manual-directory-state">Мануалов пока нет.</p>';
      return;
    }
    box.innerHTML=`<ul class="manual-directory-list">${manuals.map(manual=>{
      const updated=new Date(manual.updated_at*1000).toLocaleDateString('ru-RU');
      return `<li><a class="manual-directory-row" href="#manuals/view/${encodeURIComponent(manual.id)}">
        <span class="manual-row-document">${icon('document')}</span>
        <span class="manual-row-main"><strong>${esc(manual.title)}</strong><span>${esc(manual.description)}</span></span>
        <span class="manual-row-meta"><span>${esc(manual.author_name||'Неизвестен')}</span><span>${esc(updated)}</span></span>
        <span class="manual-row-arrow">${icon('chevron')}</span>
      </a></li>`;
    }).join('')}</ul>`;
  }catch{
    if(box.isConnected)box.innerHTML='<p class="manual-directory-state">Не удалось загрузить мануалы.</p>';
  }
}
function manualSubpage(){return `<div class="manual-page"><button class="back-link" data-route="manuals">← Все мануалы</button><div id="manual-page-content"><div class="panel manual-loading">Загрузка…</div></div></div>`}
async function loadManualSubpage(current){const box=$('#manual-page-content');if(!box)return;const parts=current.split('/'),mode=parts[1],id=parts[2];if((mode==='new'||mode==='edit')&&!mayManageManuals){box.innerHTML=empty('Нет доступа к редактору.');return}let m={title:'',description:'',content:''};if(mode!=='new'){try{const r=await window.journalFetch('/api/manuals/'+encodeURIComponent(id),{cache:'no-store'});if(!r.ok)throw Error();m=(await r.json()).manual}catch{if(box.isConnected)box.innerHTML=empty('Не удалось загрузить мануал.');return}}if(!box.isConnected||route!==current)return;if(mode==='view'){document.title=m.title+' — Jevox Journal';box.innerHTML=`<header class="manual-page-header"><div><div class="eyebrow">МАНУАЛ</div><h1>${esc(m.title)}</h1><p>${esc(m.description)}</p><p class="manual-author">Автор: <strong>${esc(m.author_name||'Неизвестен')}</strong></p></div>${mayManageManuals?`<div class="management-actions"><button class="button" data-edit-manual="${esc(id)}">Редактировать</button><button class="button danger-button" data-delete-manual="${esc(id)}">Удалить</button></div>`:''}</header><article class="panel manual-document manual-content">${renderManual(m.content)}</article>`;return}box.innerHTML=`<header class="manual-page-header"><div><div class="eyebrow">МАНУАЛЫ</div><h1>${mode==='new'?'Новый мануал':'Редактирование мануала'}</h1><p>Создайте понятный материал для сотрудников.</p></div></header><form data-manual-form="${esc(id||'new')}" class="panel manual-form manual-editor-page"><label>Название<input class="input" name="title" maxlength="120" required value="${esc(m.title)}" placeholder="Например, как провести проверку"></label><label>Описание<textarea class="input" name="description" maxlength="500" rows="2" required placeholder="Коротко о содержимом">${esc(m.description)}</textarea></label><fieldset class="visibility-options"><legend>Кому виден мануал</legend><label class="visibility-radio"><input type="radio" name="visibility" value="all" ${!m.allowed_positions?'checked':''}> Всем сотрудникам</label><label class="visibility-radio"><input type="radio" name="visibility" value="selected" ${m.allowed_positions?'checked':''}> Выбранным должностям</label><div class="visibility-positions" ${m.allowed_positions?'':'hidden'}>${positions.map(position=>`<label><input type="checkbox" name="allowedPosition" value="${esc(position)}" ${m.allowed_positions?.includes(position)?'checked':''}> ${esc(position)}</label>`).join('')}</div><p>Администратор и Владелец всегда имеют доступ.</p></fieldset><label id="editor-label">Содержимое</label>${manualToolbar()}<div class="image-controls" hidden><span>Размер фото</span><input type="range" min="15" max="100" step="1" value="100" aria-label="Размер фото"><output>100%</output><div class="editor-tool-group" role="group" aria-label="Выравнивание фото"><button type="button" data-image-align="left" aria-label="Фото слева">${alignmentIcon('left')}</button><button type="button" data-image-align="center" aria-label="Фото по центру">${alignmentIcon('center')}</button><button type="button" data-image-align="right" aria-label="Фото справа">${alignmentIcon('right')}</button></div><button type="button" data-image-move="up" title="Переместить выше">↑</button><button type="button" data-image-move="down" title="Переместить ниже">↓</button><button type="button" data-image-remove title="Удалить фото">Удалить</button></div><div class="manual-editor visual-editor manual-content" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="editor-label" data-placeholder="Напишите мануал…">${m.content?renderManual(m.content):''}</div><article class="manual-content manual-preview" id="manual-preview" aria-label="Предпросмотр мануала" hidden></article><input type="file" id="manual-photo" accept="image/png,image/jpeg,image/webp,image/gif" hidden><p class="form-hint">Выберите фото, чтобы изменить размер, или перетащите его в нужное место.</p><div class="editor-actions"><button class="button primary" type="submit">Сохранить мануал</button><button class="button" type="button" data-route="manuals">Отмена</button></div></form>`}
function renderManual(content){if(content.startsWith(manualMarkupPrefix))return readFormattedManual(content);return esc(content).split('\n').map(line=>{const image=line.match(/^!\[Фото\]\((data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+|\/api\/manual-images\/[a-f0-9-]{36})\)(?:\{width=(\d{1,3})\})?$/);if(image){const width=image[2]?Math.max(15,Math.min(100,Number(image[2]))):null;return `<img ${image[1].startsWith('/')?'data-journal-image':'src'}="${image[1]}" alt="Фото из мануала" loading="lazy" draggable="true"${width?` data-width="${width}" style="width:${width}%"`:''}>`};const inline=line.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>');if(inline.startsWith('### '))return '<h3>'+inline.slice(4)+'</h3>';if(inline.startsWith('## '))return '<h2>'+inline.slice(3)+'</h2>';if(inline.startsWith('- '))return '<div class="manual-item">• '+inline.slice(2)+'</div>';return inline?'<p>'+inline+'</p>':'<br>'}).join('')}
function manualEditor(id){navigate(id?'manuals/edit/'+id:'manuals/new')}
observeManualImages($('#main'));
let manualSelection=null, selectedManualImage=null, draggedManualImage=null;
function rememberManualSelection(){const el=$('.visual-editor'),selection=window.getSelection();if(el&&selection?.rangeCount&&el.contains(selection.anchorNode))manualSelection=selection.getRangeAt(0).cloneRange()}
function restoreManualSelection(){const el=$('.visual-editor');if(!el)return false;el.focus();const sel=window.getSelection();if(manualSelection&&el.contains(manualSelection.commonAncestorContainer)){sel.removeAllRanges();sel.addRange(manualSelection)}else{const range=document.createRange();range.selectNodeContents(el);range.collapse(false);sel.removeAllRanges();sel.addRange(range)}return true}
function manualToolbar(){
  const button=(action,label,text)=>`<button type="button" data-format="${action}" aria-label="${label}" title="${label}">${text}</button>`;
  const group=(label,buttons)=>`<div class="editor-tool-group" role="group" aria-label="${label}">${buttons.join('')}</div>`;
  return `<div class="editor-toolbar" role="toolbar" aria-label="Форматирование">
    ${group('Блок',[
      button('paragraph','Абзац','¶'),button('heading','Заголовок','H2'),button('subheading','Подзаголовок','H3'),
      button('quote','Цитата','❝'),button('separator','Разделитель','―')
    ])}
    ${group('Текст',[
      button('bold','Полужирный','<b>Ж</b>'),button('italic','Курсив','<i>К</i>'),
      button('underline','Подчеркнуть','<u>Ч</u>'),button('strikeThrough','Зачеркнуть','<s>З</s>'),
      button('removeFormat','Очистить форматирование','Tx')
    ])}
    ${group('Выравнивание',[
      button('justifyLeft','По левому краю',alignmentIcon('left')),button('justifyCenter','По центру',alignmentIcon('center')),
      button('justifyRight','По правому краю',alignmentIcon('right')),button('justifyFull','По ширине',alignmentIcon('justify'))
    ])}
    ${group('Списки и вложения',[
      button('insertUnorderedList','Маркированный список','• ≡'),button('insertOrderedList','Нумерованный список','1. ≡'),
      button('link','Вставить ссылку','Ссылка'),'<button type="button" data-action="manual-photo">Фото</button>'
    ])}
    ${group('Просмотр',[
      button('undo','Отменить','↶'),button('redo','Повторить','↷'),
      '<button type="button" data-action="manual-preview" aria-pressed="false">Предпросмотр</button>'
    ])}
  </div>`;
}

function alignmentIcon(alignment){
  const lines={left:'M3 7h14m-14 5h9m-9 5h14',center:'M3 7h14M6 12h8M3 17h14',right:'M3 7h14m0 5H8m9 5H3',justify:'M3 7h14M3 12h14M3 17h14'};
  return `<svg viewBox="0 0 20 24" aria-hidden="true"><path d="${lines[alignment]}"/></svg>`;
}

function formatManual(format){
  const editor=$('.visual-editor');
  if(!editor||editor.hidden||!restoreManualSelection())return;
  if(format==='link'){
    const label=window.getSelection().toString();
    showModal(modalHeader('Вставить ссылку')+`<form data-manual-link class="manual-link-form">
      <label>Адрес<input class="input" name="href" type="url" required placeholder="https://example.com"></label>
      <label>Текст ссылки<input class="input" name="label" value="${esc(label)}"></label>
      <p class="staff-form-error" role="alert"></p><button class="button primary" type="submit">Вставить</button>
    </form>`);
    return;
  }
  const blocks={paragraph:'p',heading:'h2',subheading:'h3',quote:'blockquote'};
  if(blocks[format])document.execCommand('formatBlock',false,blocks[format]);
  else if(format==='separator')document.execCommand('insertHorizontalRule');
  else document.execCommand(format);
  rememberManualSelection();
}

function toggleManualPreview(button){
  const editor=$('.visual-editor'),preview=$('#manual-preview');
  if(!editor||!preview)return;
  const viewing=preview.hidden;
  if(viewing){
    const content=saveFormattedManual(editor);
    preview.innerHTML=content?readFormattedManual(content):'<p class="muted">Мануал пока пуст.</p>';
    selectManualImage(null);
  }
  editor.hidden=viewing;
  preview.hidden=!viewing;
  button.setAttribute('aria-pressed',String(viewing));
  button.textContent=viewing?'Вернуться к тексту':'Предпросмотр';
  $$('[data-format],[data-action="manual-photo"]',button.closest('.editor-toolbar')).forEach(tool=>tool.disabled=viewing);
}

document.addEventListener('submit',event=>{
  const form=event.target.closest('[data-manual-link]');
  if(!form)return;
  event.preventDefault();
  const href=manualLink(form.elements.href.value.trim());
  if(!href){
    $('[role="alert"]',form).textContent='Укажите ссылку с http:// или https://.';
    return;
  }
  const label=form.elements.label.value.trim()||href;
  $('#modal').close();
  if(!restoreManualSelection())return;
  document.execCommand('insertHTML',false,`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`);
  rememberManualSelection();
});

document.addEventListener('click',e=>{const t=e.target.closest('button,a');if(!t){if(!e.target.closest('.popover'))closeMenus();return}if(t.dataset.nav!==undefined){const group=groups[Number(t.dataset.nav)],popup=$('#nav-popover'),was=t.getAttribute('aria-expanded')==='true';closeMenus();if(!was){popup.innerHTML=group.routes.map(r=>`<button role="menuitem" data-route="${r}">${icon(pages[r][1])}${esc(pages[r][0])}</button>`).join('');popup.style.left=Math.min(t.offsetLeft,$('.topbar').clientWidth-245)+'px';popup.hidden=false;t.setAttribute('aria-expanded','true')}return}if(t.id==='notifications-button'){const was=$('#notifications-popover').hidden;closeMenus();if(was)refreshNotifications(true);return}if(t.id==='profile-button'){const was=$('#profile-popover').hidden;closeMenus();$('#profile-popover').hidden=!was;t.setAttribute('aria-expanded',String(was));return}if(t.dataset.route){navigate(t.dataset.route);return}if(t.dataset.setTheme){setJournalTheme(t.dataset.setTheme);return}if(t.dataset.action==='new-staff-sanction'){newStaffSanction();return}if(t.dataset.revokeSanction){confirmSanctionRevoke(t.dataset.revokeSanction);return}if(t.dataset.confirmSanctionRevoke){revokeSanction(t);return}if(t.dataset.formerId){formerDetails(t.dataset.formerId);return}if(t.dataset.removeModerator){confirmRemoval(t.dataset.removeModerator);return}if(t.dataset.deleteManual){confirmManualDeletion(t.dataset.deleteManual);return}if(t.dataset.confirmManualDelete){deleteManual(t);return}if(t.dataset.action==='new-manual'){manualEditor();return}if(t.dataset.action==='manual-photo'){rememberManualSelection();$('#manual-photo').click();return}if(t.dataset.imageAlign){if(selectedManualImage?.isConnected)selectedManualImage.dataset.align=t.dataset.imageAlign;return}if(t.dataset.imageMove){moveImage(t.dataset.imageMove);return}if(t.hasAttribute('data-image-remove')){if(selectedManualImage?.isConnected)selectedManualImage.remove();selectManualImage(null);return}if(t.dataset.format){formatManual(t.dataset.format);return}if(t.dataset.action==='manual-preview'){toggleManualPreview(t);return}if(t.dataset.editManual){manualEditor(t.dataset.editManual);return}if(t.dataset.editModerator){editModerator(t.dataset.editModerator);return}if(t.dataset.action==='add-moderator'){addModerator();return}if(t.dataset.moderatorId){moderatorDetails(t.dataset.moderatorId);return}if(t.dataset.action==='close-modal')$('#modal').close();if(!e.target.closest('.popover,.nav-button,#profile-button'))closeMenus()});
document.addEventListener('submit', async event => {
  const form = event.target.closest('form[data-add-moderator]');
  if (!form) return;
  event.preventDefault();

  const button = form.querySelector('[type=submit]');
  const notice = form.querySelector('[data-add-error]');
  const dialog = form.closest('dialog');
  const data = Object.fromEntries(new FormData(form));
  const showError = message => {
    if (form.isConnected && dialog.open) {
      notice.textContent = message;
      notice.scrollIntoView({block:'nearest'});
      return;
    }
    const pageNotice = $('#management-add-error');
    if (pageNotice) {
      pageNotice.textContent = message;
      if (!$('#modal').open) pageNotice.scrollIntoView({block:'nearest'});
    }
  };
  const fallback = 'Не удалось добавить сотрудника. Попробуйте ещё раз.';
  notice.textContent = '';

  const invalidField = form.querySelector('input:invalid, select:invalid');
  if (invalidField) {
    const label = invalidField.labels[0].firstChild.textContent.trim();
    invalidField.focus({preventScroll:true});
    showError('Проверьте поле «' + label + '». ' + invalidField.validationMessage);
    return;
  }

  if (!data.vkId.trim() && !data.telegramId.trim()) {
    showError('Укажите ID ВКонтакте или Telegram.');
    return;
  }

  button.disabled = true;
  try {
    const response = await window.journalFetch('/api/admin/moderators', {
      method:'POST',
      headers:{'Content-Type':'application/json','X-CSRF-Token':account.csrf},
      body:JSON.stringify(data)
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      showError(result?.error || fallback);
      return;
    }
  } catch {
    showError(fallback);
    return;
  } finally {
    button.disabled = false;
  }

  if (form.isConnected && dialog.open) dialog.close();
  toast('Модератор добавлен');
  await loadManagement();
  await loadStaff();
});
function selectManualImage(image){if(selectedManualImage)selectedManualImage.classList.remove('image-selected');selectedManualImage=image;const controls=$('.image-controls');if(!controls)return;controls.hidden=!image;if(image){image.classList.add('image-selected');const value=Number(image.dataset.width)||100;$('input[type=range]',controls).value=value;$('output',controls).textContent=value+'%'}}
function moveImage(direction){const img=selectedManualImage,editor=$('.visual-editor');if(!img||!editor?.contains(img))return;let block=img;while(block.parentNode!==editor)block=block.parentNode;if(block!==img){editor.insertBefore(img,direction==='up'?block:block.nextSibling);return}const neighbor=direction==='up'?img.previousElementSibling:img.nextElementSibling;if(!neighbor)return;if(direction==='up')editor.insertBefore(img,neighbor);else editor.insertBefore(img,neighbor.nextSibling)}
document.addEventListener('click',e=>{const image=e.target.closest('.visual-editor img');if(image)selectManualImage(image);else if(e.target.closest('.visual-editor')&&!e.target.closest('.image-controls'))selectManualImage(null)});
document.addEventListener('input',e=>{if(!e.target.matches('.image-controls input[type=range]')||!selectedManualImage?.isConnected)return;const value=Math.max(15,Math.min(100,Number(e.target.value)||100));selectedManualImage.dataset.width=value;selectedManualImage.style.width=value+'%';$('.image-controls output').textContent=value+'%'});
document.addEventListener('dragstart',e=>{const image=e.target.closest('.visual-editor img');if(!image)return;draggedManualImage=image;selectManualImage(image);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain','manual-image')});
document.addEventListener('dragover',e=>{if(draggedManualImage&&e.target.closest('.visual-editor')){e.preventDefault();e.dataTransfer.dropEffect='move'}});
document.addEventListener('drop',e=>{const editor=e.target.closest('.visual-editor'),img=draggedManualImage;if(!editor||!img||!editor.contains(img))return;e.preventDefault();let range=document.caretRangeFromPoint?.(e.clientX,e.clientY);if(!range||!editor.contains(range.startContainer)||img.contains(range.startContainer)){range=document.createRange();range.selectNodeContents(editor);range.collapse(false)}range.insertNode(img);selectManualImage(img);draggedManualImage=null});
document.addEventListener('dragend',()=>{draggedManualImage=null});
document.addEventListener('change',e=>{if(e.target.matches('form[data-edit-form] select[name=position]')){const date=e.target.form.elements.appointmentDate;const m=moderators.find(x=>x.id===e.target.form.dataset.editForm);if(date)date.value=e.target.value===e.target.dataset.originalPosition?(m?.appointment_date||''):new Date().toISOString().slice(0,10)}if(e.target.name==='visibility'){const box=$('.visibility-positions');if(box)box.hidden=e.target.value!=='selected'}});
document.addEventListener('mousedown',e=>{if(e.target.closest('.editor-toolbar button')){rememberManualSelection();e.preventDefault()}});
document.addEventListener('paste',e=>{if(!e.target.closest('.visual-editor'))return;e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain'));rememberManualSelection()});
async function uploadManualImage(file,image){
  const post=async(url,data)=>{const r=await window.journalFetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':account.csrf},body:JSON.stringify(data)}),result=await r.json();if(!r.ok)throw Error(result.error||'Ошибка загрузки');return result};
  try{
    const {id,chunkCount}=await post('/api/manual-images/start',{type:file.type,size:file.size});
    for(let index=0;index<chunkCount;index++){
      const part=file.slice(index*524288,(index+1)*524288);
      const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('Не удалось прочитать файл.'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(part)});
      await post(`/api/manual-images/${id}/chunk`,{index,data:encoded});
    }
    await post(`/api/manual-images/${id}/finish`,{});
    if(image.isConnected){image.dataset.journalImage='/api/manual-images/'+id;delete image.dataset.uploading;toast('Фото загружено')}
  }catch(error){if(image.isConnected){delete image.dataset.uploading;image.dataset.uploadError='true';toast(error.message||'Не удалось загрузить фото. Удалите его и попробуйте снова.')}}
}
document.addEventListener('change',e=>{if(e.target.id!=='manual-photo'||!e.target.files[0])return;const file=e.target.files[0];if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)||!file.size){toast('Выберите изображение PNG, JPG, GIF или WebP.');e.target.value='';return}if(!restoreManualSelection())return;const image=document.createElement('img');image.src=URL.createObjectURL(file);image.alt='Фото из мануала';image.draggable=true;image.dataset.uploading='true';const sel=window.getSelection(),range=sel.getRangeAt(0);range.deleteContents();range.insertNode(image);range.setStartAfter(image);range.collapse(true);sel.removeAllRanges();sel.addRange(range);rememberManualSelection();selectManualImage(image);e.target.value='';toast('Фото загружается…');uploadManualImage(file,image)});
document.addEventListener('submit',async e=>{const form=e.target.closest('form[data-edit-form],form[data-manual-form]');if(!form)return;e.preventDefault();const button=form.querySelector('button[type=submit],button:not([type])'),data=Object.fromEntries(new FormData(form));let url,success;if(form.dataset.editForm){if(!data.vkId.trim()&&!data.telegramId.trim()){toast('Укажите ID ВКонтакте или Telegram.');return}url=`/api/admin/moderators/${encodeURIComponent(form.dataset.editForm)}/edit`;success='Данные сохранены'}else{if($('.visual-editor img[data-uploading]')){toast('Дождитесь загрузки фотографии.');return}if($('.visual-editor img[data-upload-error]')){toast('Удалите незагруженное фото и попробуйте снова.');return}data.allowedPositions=data.visibility==='selected'?new FormData(form).getAll('allowedPosition'):null;delete data.visibility;delete data.allowedPosition;if(Array.isArray(data.allowedPositions)&&!data.allowedPositions.length){toast('Выберите хотя бы одну должность.');return}data.content=saveFormattedManual($('.visual-editor'));if(!data.content){toast('Добавьте содержимое мануала.');return}if(data.content.length>9000000){toast('Текст мануала слишком большой.');return}url='/api/manuals'+(form.dataset.manualForm==='new'?'':'/'+encodeURIComponent(form.dataset.manualForm));success='Мануал сохранён'}button.disabled=true;try{const r=await window.journalFetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':account.csrf},body:JSON.stringify(data)}),result=await r.json();if(!r.ok)throw Error(result.error);if(form.dataset.manualForm){toast(success);navigate('manuals');return}$('#modal').close();toast(success);if(route==='management'){await loadManagement();loadStaff()}if(route==='manuals')loadManuals();}catch(err){toast(err.message||'Не удалось сохранить.');button.disabled=false}});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenus()});window.addEventListener('popstate',()=>navigate(location.hash.slice(1)||'overview'));window.addEventListener('hashchange',()=>{const next=location.hash.slice(1)||'overview';if(next!==route)navigate(next)});$$('[data-icon]').forEach(e=>e.innerHTML=icon(e.dataset.icon));navigate(location.hash.slice(1)||'overview');loadStaff();loadOwnSanctions();refreshNotifications();setInterval(()=>{refreshNotifications();loadOwnSanctions()},30000);

function serverTime(ms){return ms?esc(new Date(ms).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',dateStyle:'short',timeStyle:'short'})):'—'}

async function loadServerSummary(){
  try{
    const response=await window.journalFetch('/api/server/summary',{cache:'no-store'});
    if(!response.ok)throw Error();
    serverSummary=await response.json();
  }catch{
    serverSummary=null;
  }
  updateOverview('overview-activity',renderServerActivity(serverSummary));
}
setInterval(()=>{if(route==='overview')loadServerSummary()},60000);

function profileBannerAttribute(id, position){
  return canUseBanner(id,position) ? ' data-profile-banner="'+esc(id)+'"' : '';
}

function openProfileBanners(){
  const {position,profileBanner,canSetProfileBanner}=account.user;
  if(!canSetProfileBanner)return;
  const choices=profileBanners.map(banner=>{
    const locked=!canUseBanner(banner.id,position);
    const selected=profileBanner===banner.id;
    return `<button class="profile-banner-option" type="button" data-select-profile-banner="${banner.id}" aria-pressed="${selected}" ${locked?'disabled':''}>
      <span class="profile-banner-preview" data-profile-banner="${banner.id}"></span>
      <strong>${banner.name}</strong>
      ${locked?'<small>Только для владельцев</small>':selected?'<small>Выбран</small>':''}
    </button>`;
  }).join('');
  showModal(modalHeader('Баннер профиля')+`<div class="profile-banner-picker">${choices}</div>
    <p class="staff-form-error" data-profile-banner-error role="alert"></p>
    ${profileBanner?'<button class="button profile-banner-reset" type="button" data-select-profile-banner="">Сбросить баннер</button>':''}`);
}

async function saveProfileBanner(button){
  const modal=$('#modal');
  const origin=$('#own-profile-hero');
  const trigger=$('[data-action="profile-banner"]',origin);
  const notice=$('[data-profile-banner-error]',modal);
  const options=$$('[data-select-profile-banner]:enabled',modal);
  if(trigger)trigger.disabled=true;
  options.forEach(option=>option.disabled=true);
  notice.textContent='';
  try{
    const response=await window.journalFetch('/api/me/profile/banner',{
      method:'POST',
      headers:{'Content-Type':'application/json','X-CSRF-Token':account.csrf},
      body:JSON.stringify({banner:button.dataset.selectProfileBanner||null})
    });
    const result=await response.json();
    if(!response.ok)throw Error(result.error||'Не удалось сохранить баннер.');
    account.user.profileBanner=result.banner;
    const hero=$('#own-profile-hero');
    if(hero){
      if(result.banner)hero.dataset.profileBanner=result.banner;
      else delete hero.dataset.profileBanner;
    }
    if(button.isConnected&&modal.open)modal.close();
    if(origin?.isConnected)toast('Баннер сохранён');
  }catch(error){
    if(button.isConnected&&modal.open){
      notice.textContent=error.message||'Не удалось сохранить баннер.';
      notice.scrollIntoView({block:'nearest'});
    }
  }finally{
    if(trigger)trigger.disabled=false;
    options.forEach(option=>option.disabled=false);
  }
}

document.addEventListener('click',event=>{
  const button=event.target.closest('button[data-action="profile-banner"],button[data-select-profile-banner]');
  if(!button||button.disabled)return;
  if(button.dataset.action==='profile-banner')openProfileBanners();
  else saveProfileBanner(button);
});

function profileBackButton(){
  const from=history.state?.profileFrom;
  return `<button type="button" class="button personal-profile-back" data-profile-back>← ${esc(pages[from]?.[0]||'Назад')}</button>`;
}
document.addEventListener('click',event=>{
  if(!event.target.closest('[data-profile-back]'))return;
  if(history.state?.profileFrom)history.back();
  else navigate('team');
});

function profilePage(){
  if(route.startsWith('profile/'))return `<div class="personal-profile staff-route">
    ${profileBackButton()}
    <div id="personal-content" aria-live="polite"><p class="personal-empty">Загрузка профиля…</p></div>
  </div>`;
  const user=account.user;
  return `<div class="personal-profile staff-route">
    ${history.state?.profileFrom?profileBackButton():''}
    ${title('profile','')}
    <header id="own-profile-hero" class="panel personal-hero${user.canSetProfileBanner?' personal-hero-editable':''}"${profileBannerAttribute(user.profileBanner,user.position)}>
      ${user.canSetProfileBanner?`<button class="button profile-banner-trigger" type="button" data-action="profile-banner" aria-haspopup="dialog">${icon('image')} Баннер</button>`:''}
      ${memberSkin(user.displayName)}
      <h2>${esc(user.displayName)}</h2>
      <div class="personal-chips"><span class="chip role">${esc(user.position||'Должность не указана')}</span><span class="chip">${esc(membershipDate(user.staffSince))}</span></div>
    </header>
    <div id="personal-content" aria-live="polite"><p class="personal-empty">Загрузка профиля…</p></div>
  </div>`;
}
function personalMetric(label,value,tone=''){
  return `<div class="personal-metric ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}
function personalSection(title,iconName,content){
  return `<section class="panel personal-section"><header><h2>${icon(iconName)}${esc(title)}</h2></header><div class="personal-section-body">${content}</div></section>`;
}
function personalSanctionList(sanctions,managed=false){
  if(!sanctions.length)return '<p class="personal-empty">Записей о наказаниях нет.</p>';
  return `<ul class="personal-events">${sanctions.map(item=>`<li>
    <div class="personal-event-title"><strong>${item.type==='warning'?'Предупреждение':'Выговор'}</strong>
    <span class="form-status ${item.revoked_at?'status-approved':'status-rejected'}">${item.revoked_at?'Снято':'Действует'}</span></div>
    <p>${esc(item.reason)}</p>
    <small>${formatTimestamp(item.issued_at)} · Выдал: ${esc(item.issued_by_name)}${item.revoked_at?' · Снято '+formatTimestamp(item.revoked_at):''}</small>
    ${managed&&!item.revoked_at?`<div class="detail-actions"><button class="button" data-revoke-sanction="${esc(item.id)}">Снять наказание</button></div>`:''}
  </li>`).join('')}</ul>`;
}
function personalPositionList(records){
  if(!records.length)return '<p class="personal-empty">Изменений должности пока нет.</p>';
  return `<ol class="personal-events personal-timeline">${records.map(item=>{
    const parts=item.message.match(/^Должность изменена: (.+?) → (.+?)\. Изменил: (.+)\.$/);
    return `<li><small>${formatTimestamp(item.created_at)}${parts?' · '+esc(parts[3]):''}</small>
      <p>${parts?`<span>${esc(parts[1])}</span> <span aria-hidden="true">→</span> <strong>${esc(parts[2])}</strong>`:esc(item.message)}</p></li>`;
  }).join('')}</ol>`;
}

const staffControls={
  activity:{label:'Изменить счётчики',success:'Счётчики обновлены'},
  'clear-logs':{label:'Очистить логи',confirm:'Предыдущие записи о действиях этого сотрудника исчезнут из списка логов.',success:'Логи очищены'},
  'clear-positions':{label:'Очистить историю должностей',confirm:'Предыдущие изменения должности исчезнут из профиля сотрудника.',success:'История должностей очищена'},
  'clear-activity':{label:'Очистить работы',confirm:'Счётчики сотрудника обнулятся, а прежние работы исчезнут из рейтингов. Новые работы будут учитываться с нуля.',success:'Работы сотрудника очищены'},
};

function staffControlButtons(id,work){
  if(!canClearStaffWork||!id)return '';
  return personalSection('Управление профилем','settings',`<div class="staff-profile-actions">
    ${isOwner?`<button type="button" class="button" data-staff-control="activity" data-member-id="${esc(id)}" data-checks="${work?.checks??0}" data-punishments="${work?.punishments??0}" ${work?'':'disabled'}>Изменить счётчики</button>
    <button type="button" class="button danger-button" data-staff-control="clear-logs" data-member-id="${esc(id)}">Очистить логи</button>`:''}
    <button type="button" class="button danger-button" data-staff-control="clear-positions" data-member-id="${esc(id)}">Очистить историю должностей</button>
    ${route.startsWith('profile/')?`<button type="button" class="button danger-button" data-staff-control="clear-activity" data-member-id="${esc(id)}">Очистить работы</button>`:''}
  </div>`);
}

document.addEventListener('click',event=>{
  const button=event.target.closest('button[data-staff-control]');
  if(!canClearStaffWork||!button)return;
  const {staffControl:operation,memberId,checks,punishments}=button.dataset;
  const control=staffControls[operation];
  const activity=operation==='activity';
  const dated=operation==='clear-logs'||operation==='clear-positions';
  showModal(modalHeader(control.label,control.confirm)+`<form data-staff-control-form="${operation}" data-member-id="${esc(memberId)}" class="staff-control-form">
    ${activity?`<p class="form-hint">Укажите итоговые числа за всё время. Новые проверки и наказания будут прибавляться автоматически.</p>
      <label>Проверки<input class="input" name="checks" type="number" min="0" max="2147483647" step="1" value="${esc(checks)}" required></label>
      <label>Наказания<input class="input" name="punishments" type="number" min="0" max="2147483647" step="1" value="${esc(punishments)}" required></label>`:''}
    ${dated?`<label class="staff-period">Период<select class="input" name="period" data-history-period>
      <option value="today">Сегодня</option><option value="month">За последний месяц</option>
      <option value="quarter">За последние 3 месяца</option><option value="all">За всё время</option>
      <option value="custom">Выбрать даты</option>
    </select></label><div class="staff-range" hidden>
      <label>С<input class="input" type="date" name="from" required disabled></label>
      <label>По включительно<input class="input" type="date" name="to" required disabled></label>
    </div><p class="form-hint">Даты указаны по московскому времени.</p>`:''}
    <p class="staff-form-error" role="alert"></p>
    <div class="detail-actions"><button type="submit" class="button ${activity?'primary':'danger-button'}">${activity?'Сохранить':'Очистить'}</button>
    <button type="button" class="button" data-action="close-modal">Отмена</button></div>
  </form>`);
});
document.addEventListener('change',event=>{
  if(!event.target.matches('[data-history-period]'))return;
  const range=event.target.form.querySelector('.staff-range');
  range.hidden=event.target.value!=='custom';
  for(const input of range.querySelectorAll('input'))input.disabled=range.hidden;
});

document.addEventListener('submit',async event=>{
  const form=event.target.closest('form[data-staff-control-form]');
  if(!form)return;
  event.preventDefault();
  const {staffControlForm:operation,memberId}=form.dataset;
  const submit=form.querySelector('[type=submit]');
  if(submit.disabled)return;
  const notice=form.querySelector('[role=alert]');
  notice.textContent='';
  submit.disabled=true;
  const payload=operation==='activity'
    ?{checks:form.elements.checks.valueAsNumber,punishments:form.elements.punishments.valueAsNumber}
    :Object.fromEntries(new FormData(form));
  try{
    const response=await window.journalFetch(`/api/staff/${encodeURIComponent(memberId)}/profile/${operation}`,{
      method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':account.csrf},body:JSON.stringify(payload),
    });
    const result=await response.json();
    if(!response.ok)throw Error(result.error);
    if(form.isConnected&&modal.open)modal.close();
    toast(staffControls[operation].success);
    await loadPersonalProfile();
  }catch(error){
    notice.textContent=error.message||'Не удалось применить изменения.';
    submit.disabled=false;
  }
});

async function loadPersonalProfile(){
  const box=$('#personal-content');
  if(!box)return;
  const read=async path=>{
    const response=await window.journalFetch(path,{cache:'no-store'});
    if(!response.ok)throw Error('Profile request failed');
    return response.json();
  };
  const memberId=route.split('/')[1];
  let data,work,heading='',mayIssue=false,immune=isSanctionImmune(myPosition);
  try{
    if(memberId){
      const {member,history,activity}=await read('/api/staff/'+encodeURIComponent(memberId)+'/profile');
      if(!box.isConnected)return;
      selectedStaffProfile=member;
      immune=isSanctionImmune(member.position);
      mayIssue=canDiscipline(myPosition,member.position);
      sanctionsList=history.sanctions;
      data=history;
      work=activity;
      heading=`<header class="panel personal-hero"${profileBannerAttribute(member.profile_banner,member.position)}>${memberSkin(member.nickname)}<h2>${esc(member.nickname)}</h2>
        <div class="personal-chips"><span class="chip role">${esc(member.position)}</span>
        <span class="chip">${esc(membershipDate(member.staff_since))}</span></div></header>`;
    }else{
      const [profile,activity]=await Promise.allSettled([read('/api/me/profile'),read('/api/server/summary')]);
      if(profile.status==='rejected')throw profile.reason;
      data=profile.value;
      work=activity.status==='fulfilled'?activity.value:null;
    }
  }catch{
    if(box.isConnected)box.innerHTML='<p class="personal-empty">Не удалось загрузить профиль.</p>';
    return;
  }
  if(!box.isConnected)return;
  const active=data.sanctions.filter(item=>!item.revoked_at);
  const staffNote=data.linked?'':'<p class="personal-empty">Данные появятся, когда аккаунт будет привязан к записи в составе.</p>';
  box.innerHTML=heading+staffNote+
    personalSection('Моя работа на сервере','scan',renderServerActivity(work,true))+
    staffControlButtons(memberId||data.staffId,work)+
    `<div class="personal-columns${immune?' personal-columns-single':''}">
      ${immune?'':personalSection('Предупреждения и выговоры','shield',`<div class="personal-metrics">
        ${personalMetric('Активные предупреждения',data.linked?active.filter(item=>item.type==='warning').length:'—','warning')}
        ${personalMetric('Активные выговоры',data.linked?active.filter(item=>item.type==='reprimand').length:'—','reprimand')}
      </div>${mayIssue?'<div class="detail-actions"><button class="button primary" data-action="new-staff-sanction">Выдать наказание</button></div>':''}${personalSanctionList(data.sanctions,mayIssue)}`)}
      ${personalSection('История должностей','trend',personalPositionList(data.positions))}
    </div>`;
}

function actionLogsPage(){
  return title('logs','История действий сотрудников журнала')+`<section class="panel">
    <div class="panel-head"><h2>${icon('book')}Логи действий</h2></div>
    <div class="action-log-toolbar"><label for="action-log-actor">Сотрудник</label>
    <select class="input" id="action-log-actor"><option value="">Все действующие сотрудники</option></select></div>
    <div id="action-log-list" aria-live="polite">Загрузка…</div>
    <div class="detail-actions action-log-footer"><button class="button" id="action-log-more" hidden>Показать ещё</button></div>
  </section>`;
}
function actionLabel(row){
  const labels={
    'login:telegram':'Вход через Telegram','login:vk':'Вход через ВКонтакте',logout:'Выход из журнала',
    moderator_added:'Добавил сотрудника',moderator_edited:'Изменил данные сотрудника',moderator_removed:'Снял сотрудника',
    moderator_restored:'Восстановил сотрудника',former_record_deleted:'Удалил запись из бывшего состава',moderator_admin_granted:'Выдал права администратора',
    'moderator_role:admin':'Выдал права администратора','moderator_role:moderator':'Назначил права модератора',
    staff_sanction_issued:row.sanction_type==='warning'?'Выдал предупреждение':'Выдал выговор',
    staff_sanction_revoked:row.sanction_type==='warning'?'Снял предупреждение':'Снял выговор',
    manual_saved:'Сохранил инструкцию',manual_deleted:'Удалил инструкцию',
    staff_activity_adjusted:'Изменил счётчики сотрудника',staff_logs_cleared:'Очистил логи сотрудника',server_check_deleted:'Удалил проверку',staff_positions_cleared:'Очистил историю должностей сотрудника',staff_activity_cleared:'Очистил работы сотрудника'
  };
  if(row.action.startsWith('rollback:'))return 'Откатил действие';
  if(row.action.startsWith('access:'))return 'Изменил доступ к журналу';
  if(row.action.startsWith('login_failed:'))return 'Неудачная попытка входа';
  return Object.hasOwn(labels,row.action)?labels[row.action]:row.action;
}
async function loadActionLogs(before=0){
  const list=$('#action-log-list'),select=$('#action-log-actor'),more=$('#action-log-more');
  if(!list||!select||!more)return;
  const actor=select.value;
  more.hidden=true;
  if(!before)list.textContent='Загрузка…';
  try{
    const query=new URLSearchParams({actor,before:String(before)});
    const response=await window.journalFetch('/api/action-logs?'+query,{cache:'no-store'});
    if(!response.ok)throw Error();
    const data=await response.json();
    if(!list.isConnected||select.value!==actor)return;
    select.innerHTML='<option value="">Все действующие сотрудники</option>'+data.actors.map(person=>`<option value="${esc(person.id)}">${esc(person.name)}</option>`).join('');
    select.value=actor;
    const markup=data.entries.map(row=>`<article class="action-log-entry">
      <div><small>${esc(serverTime(row.created_at*1000))}</small><strong>${esc(actionLabel(row))}</strong></div>
      <div><span>${esc(row.actor)}${row.target?' → '+esc(row.target):''}</span>${row.reason?`<small>${esc(row.reason)}</small>`:''}</div>
    </article>`).join('');
    if(before)list.insertAdjacentHTML('beforeend',markup);
    else list.innerHTML=markup||'<p class="personal-empty">Действий пока нет.</p>';
    more.hidden=!data.next;
    more.dataset.cursor=data.next||'';
  }catch{if(list.isConnected)list.textContent='Не удалось загрузить логи.'}
}
document.addEventListener('change',event=>{
  if(event.target.id==='action-log-actor')loadActionLogs();
});
document.addEventListener('click',event=>{
  const button=event.target.closest('#action-log-more');
  if(button?.dataset.cursor)loadActionLogs(Number(button.dataset.cursor));
});
