import {headPirs,headCvasolir,ownerIcon,adminIcon,juniorAdminIcon,managerIcon,spectatorIcon,supportIcon,sheriffIcon,juniorIcon} from './discord-roster-art.mjs';
import {discordGuild,discordIdValid,discordRequest} from './discord-api.mjs';
import {staffPositions} from './staff-positions.mjs';

export const discordRosterChannel='1573744488415756450';
const bannerBase='https://jevox-discord-presence.1pirs.workers.dev/skins/discord-roster-banner';
const bannerFilename='jevox-team-153c5885.png';
const banner='attachment://'+bannerFilename;
const endpoint='/channels/'+discordRosterChannel;
const noMentions={parse:[]};
const legacyMarker='Команда проекта · Jevox Network';
const roleStyles=[
  ['owner','💎',0xb095f5,ownerIcon,'Определяют развитие Jevox Network и отвечают за работу проекта.'],
  ['admin','🛡️',0xef739f,adminIcon,'Следят за работой сервера и координируют старший состав.'],
  ['junior_admin','🔰',0xf4cf58,juniorAdminIcon,'Помогают администраторам с сервером и командой.'],
  ['manager','🧭',0xa18aec,managerIcon,'Координируют сотрудников и помогают решать вопросы состава.'],
  ['spectator','👁️',0x7db6ee,spectatorIcon,'Следят за честной игрой и проводят проверки.'],
  ['support','🛟',0x71d7bc,supportIcon,'Отвечают на обращения и помогают игрокам.'],
  ['sheriff','⭐',0xe7b760,sheriffIcon,'Следят за порядком и соблюдением правил сервера.'],
  ['junior','🌱',0x91cd8b,juniorIcon,'Знакомятся с работой команды и помогают на сервере.'],
];
const nameFor=nick=>/^[A-Za-z0-9_]{3,16}$/.test(nick)?'jhead_'+nick.toLowerCase():'jhead_steve';
const roleName=style=>'jrole_'+style[0];
const escapeNickname=value=>String(value).replace(/[\\*_~`|<>[\]#]/g,'\\$&').replaceAll('@','@\u200b');

async function api(token,path,method,body){
  const response=await discordRequest(token,path,method,body);
  if(!response.ok)throw Error('Discord roster '+method+' HTTP '+response.status);
  return response.status===204?null:response.json();
}

async function headSource(nick){
  const key=nameFor(nick);
  if(key==='jhead_1pirs')return headPirs;
  if(key==='jhead_cvasolir')return headCvasolir;
  const source=key==='jhead_steve'?'MHF_Steve':nick;
  const response=await fetch('https://mc-heads.net/head/'+encodeURIComponent(source)+'/128',{signal:AbortSignal.timeout(4500)});
  if(!response.ok||!response.headers.get('content-type')?.startsWith('image/png'))throw Error('Minecraft head unavailable');
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length>256*1024)throw Error('Minecraft head too large');
  let binary='';
  for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return 'data:image/png;base64,'+btoa(binary);
}

async function syncEmojis(env,roster,emojis){
  const desired=new Map(roster.map(({nickname})=>[nameFor(nickname),()=>headSource(nickname)]));
  for(const style of roleStyles)desired.set(roleName(style),()=>style[3]);
  const missing=[...desired.keys()].filter(name=>!emojis.has(name)).slice(0,12);
  if(!missing.length)return false;
  const token=env.DISCORD_BOT_TOKEN;
  const app=await api(token,'/applications/@me','GET');
  if(!discordIdValid(app?.id))throw Error('Discord app unavailable');
  const path='/applications/'+app.id+'/emojis';
  const {items}=await api(token,path,'GET');
  const existing=new Map(items.map(item=>[item.name,item.id]));
  let failed=false;
  for(let offset=0;offset<missing.length;offset+=4){
    const results=await Promise.allSettled(missing.slice(offset,offset+4).map(async name=>{
      let id=existing.get(name);
      if(!discordIdValid(id)){
        const image=await desired.get(name)();
        id=(await api(token,path,'POST',{name,image})).id;
      }
      if(!discordIdValid(id))throw Error('Invalid roster emoji');
      await env.DB.prepare('INSERT INTO discord_roster_emojis(name,emoji_id) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET emoji_id=excluded.emoji_id').bind(name,id).run();
      emojis.set(name,id);
    }));
    failed||=results.some(result=>result.status==='rejected');
  }
  return failed||[...desired.keys()].some(name=>!emojis.has(name));
}

function emoji(emojis,name,fallback){
  const id=emojis.get(name);
  return id?`<:${name}:${id}>`:fallback;
}

export function rosterPayload(staff,emojis){
  const groups=staffPositions.map((position,i)=>({position,style:roleStyles[i],members:staff.filter(person=>person.position===position)}));
  const embeds=[{color:0xc971a7,image:{url:banner}}];
  let budget=5000;
  for(const {position,style,members} of groups){
    if(!members.length)continue;
    const [name,icon,color,,description]=style;
    const title=`${emoji(emojis,'jrole_'+name,icon)} ${position}`;
    const lines=[];
    let size=description.length+64;
    for(const {nickname} of members){
      const line=`> ${emoji(emojis,nameFor(nickname),'🧱')} **${escapeNickname(nickname)}**`;
      if(size+line.length>Math.min(4000,budget))break;
      lines.push(line);
      size+=line.length+1;
    }
    if(lines.length<members.length)lines.push(`… и ещё ${members.length-lines.length}`);
    embeds.push({title,color,description:description+'\n\n'+lines.join('\n')});
    budget-=size+title.length;
  }
  if(embeds.length===1)embeds[0].description='В составе пока нет сотрудников.';
  embeds.at(-1).footer={text:'Jevox Network · Состав обновляется автоматически'};
  return {allowed_mentions:noMentions,embeds};
}

function hasRosterBanner(message){
  const image=message?.embeds?.[0]?.image?.url;
  if(!image)return false;
  if(image===banner)return true;
  try{
    const url=new URL(image);
    const [,kind,channel,attachment,filename]=url.pathname.split('/');
    return url.protocol==='https:'&&['cdn.discordapp.com','media.discordapp.net'].includes(url.hostname)&&
      kind==='attachments'&&channel===discordRosterChannel&&discordIdValid(attachment)&&filename===bannerFilename;
  }catch{return false;}
}

async function writeBoard(token,path,method,payload,bytes){
  const form=new FormData();
  form.append('payload_json',JSON.stringify({...payload,attachments:[{id:0,filename:bannerFilename}]}));
  form.append('files[0]',new Blob([bytes],{type:'image/png'}),bannerFilename);
  let message=await api(token,path,method,form);
  if(!hasRosterBanner(message)&&discordIdValid(message?.id)){
    await new Promise(resolve=>setTimeout(resolve,250));
    message=await api(token,endpoint+'/messages/'+message.id,'GET');
  }
  if(!hasRosterBanner(message))throw Error('Discord did not display the roster banner');
  return message;
}

export async function refreshDiscordRoster(env,bytes){
  if(!env.DISCORD_BOT_TOKEN)return;
  const db=env.DB,token=env.DISCORD_BOT_TOKEN,lease=crypto.randomUUID();
  const state=await db.prepare(`UPDATE discord_roster_board SET lease_until=unixepoch()+45,lease_key=?
    WHERE id=1 AND lease_until<=unixepoch() RETURNING *`).bind(lease).first();
  if(!state)return;
  let messageId=state.message_id,fingerprint=state.fingerprint,verified=state.verified_at,lastError=null,backoff=0;
  try{
    const [staff,art]=await Promise.all([
      db.prepare('SELECT nickname,position FROM moderators ORDER BY nickname COLLATE NOCASE').all(),
      db.prepare('SELECT name,emoji_id FROM discord_roster_emojis').all(),
    ]);
    const emojis=new Map(art.results.map(row=>[row.name,row.emoji_id]));
    try{
      if(await syncEmojis(env,staff.results,emojis))lastError='Some roster emojis are pending';
    }catch(error){lastError=error.message;}
    const payload=rosterPayload(staff.results,emojis);
    const checksum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)))),n=>n.toString(16).padStart(2,'0')).join('');
    const timestamp=Math.floor(Date.now()/1000);
    if(messageId&&checksum===fingerprint&&timestamp-verified<180)return;
    payload.embeds.at(-1).timestamp=new Date().toISOString();
    if(messageId){
      const path=endpoint+'/messages/'+messageId;
      const response=await discordRequest(token,path,'GET');
      if(response.ok){
        const message=await response.json();
        if(checksum!==fingerprint||!hasRosterBanner(message))await writeBoard(token,path,'PATCH',payload,bytes);
        fingerprint=checksum;
        verified=timestamp;
        return;
      }
      if(response.status!==404)throw Error('Discord roster GET HTTP '+response.status);
      messageId=null;
    }
    const target=await api(token,endpoint,'GET');
    if(target?.guild_id!==discordGuild||![0,5].includes(target.type))throw Error('Invalid Discord roster channel');
    const recent=await discordRequest(token,endpoint+'/messages?limit=50');
    let posted;
    if(recent.ok){
      const bot=await api(token,'/users/@me','GET');
      posted=(await recent.json()).find(message=>message.author?.id===bot.id&&
        (hasRosterBanner(message)||message.embeds?.[0]?.image?.url?.startsWith(bannerBase)||message.embeds?.[0]?.author?.name===legacyMarker));
    }
    posted=posted
      ?await writeBoard(token,endpoint+'/messages/'+posted.id,'PATCH',payload,bytes)
      :await writeBoard(token,endpoint+'/messages','POST',{...payload,nonce:'jevox-roster-board-v1',enforce_nonce:true},bytes);
    if(!discordIdValid(posted?.id))throw Error('Invalid Discord roster message');
    messageId=posted.id;
    fingerprint=checksum;
    verified=timestamp;
  }catch(error){
    lastError=error.message;
    backoff=30;
    console.error('Discord roster board update failed',lastError);
  }finally{
    await db.prepare(`UPDATE discord_roster_board SET message_id=?,fingerprint=?,verified_at=?,last_error=?,
      lease_until=unixepoch()+?,lease_key=NULL WHERE id=1 AND lease_key=?`)
      .bind(messageId,fingerprint,verified,lastError,backoff,lease).run();
  }
}
