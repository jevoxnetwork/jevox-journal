import {json} from './security.mjs';

import {discordGuild,discordLog,discordRoles,discordIdValid,discordRequest} from './discord-api.mjs';
import {ticketInteraction,isTicketCommand} from './discord-tickets.mjs';

export {discordGuild,discordLog,discordRoles,discordIdValid} from './discord-api.mjs';
export {discordRosterChannel} from './discord-roster.mjs';

async function logDiscord(token,title,description,color) {
  const response=await discordRequest(token,'/channels/'+discordLog+'/messages','POST',{
    allowed_mentions:{parse:[]},
    embeds:[{title,description,color,footer:{text:'Jevox Journal • Discord'},timestamp:new Date().toISOString()}],
  });
  if(!response.ok)throw Error('Discord log '+response.status);
}

export async function logStaffRemoval(env,{nickname,position,removedBy}) {
  if(!env.DISCORD_BOT_TOKEN)return;
  const escapeMarkdown=value=>String(value).replace(/[\\*_~`|]/g,'\\$&');
  await logDiscord(env.DISCORD_BOT_TOKEN,'Снятие с должности в журнале',
    `Сотрудник: **${escapeMarkdown(nickname)}**\nДолжность: **${escapeMarkdown(position)}**\nКто снял: **${escapeMarkdown(removedBy)}**`,0xc87464);
}

async function reconcile(env,job) {
  const account=await env.DB.prepare('SELECT nickname,position FROM moderators WHERE discord_id=?').bind(job.discord_id).first();
  const wanted=account?discordRoles[account.position]:null;
  if(account&&!wanted)throw Error('Unknown Discord staff position');
  const token=env.DISCORD_BOT_TOKEN;
  const member='/guilds/'+discordGuild+'/members/'+job.discord_id;
  const response=await discordRequest(token,member);
  if(response.status===404){
    const error=await response.json();
    if(error.code===10007){
      if(account)await logDiscord(token,'Участник не найден',`**${account.nickname}** • <@${job.discord_id}>\nДолжность: **${account.position}**. Бот проверит роль при вступлении на сервер.`,0xc99a54);
      return account?'missing':'unchanged';
    }
  }
  if(!response.ok)throw Error('Discord member '+response.status);
  const {roles,nick}=await response.json();
  if(!Array.isArray(roles))throw Error('Discord member response has no roles');
  const managedRoles=Object.values(discordRoles);
  const allowedRanks=[wanted,discordRoles[job.previous_position]].map(role=>managedRoles.indexOf(role)).filter(rank=>rank>=0);
  const threshold=allowedRanks.length?Math.min(...allowedRanks):managedRoles.length;
  const removed=roles.filter(role=>role!==wanted&&managedRoles.indexOf(role)>=threshold);
  const resetNickname=!account&&job.reason==='Сотрудник снят в журнале';
  const nextNickname=account?.nickname??null;
  const rename=(account||resetNickname)&&(nick??null)!==nextNickname;
  if(roles.some(role=>managedRoles.includes(role)&&managedRoles.indexOf(role)<threshold)){
    await logDiscord(token,'Роли требуют проверки',`**${job.nickname}** • <@${job.discord_id}>\nВ Discord уже есть более высокая роль. Проверьте привязку к журналу.`,0xc99a54);
    return 'blocked';
  }
  const added=wanted&&!roles.includes(wanted)?wanted:null;
  if(!removed.length&&!added&&!rename)return 'unchanged';
  for(const role of removed){
    const result=await discordRequest(token,member+'/roles/'+role,'DELETE');
    if(!result.ok)throw Error('Discord role removal '+result.status);
    await logDiscord(token,'Роль снята',`**${job.nickname}** • <@${job.discord_id}>\nСнята роль <@&${role}>.\n${job.reason}.`,0xc87464);
  }
  if(added){
    const result=await discordRequest(token,member+'/roles/'+added,'PUT');
    if(!result.ok)throw Error('Discord role assignment '+result.status);
    await logDiscord(token,'Роль выдана',`**${account.nickname}** • <@${job.discord_id}>\nВыдана роль <@&${added}>.\n${job.reason}.`,0x93b779);
  }
  if(rename){
    const result=await discordRequest(token,member,'PATCH',{nick:nextNickname});
    if(result.status===403){
      await logDiscord(token,'Ник требует проверки',`<@${job.discord_id}> • **${job.nickname}**\nDiscord запретил смену ника. Проверьте право «Управлять никнеймами» и порядок ролей.`,0xc99a54);
      return 'blocked';
    }
    if(!result.ok)throw Error('Discord nickname '+result.status);
    await logDiscord(token,resetNickname?'Ник сброшен':'Ник синхронизирован',`<@${job.discord_id}> • **${job.nickname}**\n${job.reason}.`,0x93b779);
  }
  return 'updated';
}

export async function syncDiscordJoin(env,member) {
  const id=member?.user?.id;
  if(member?.guild_id!==discordGuild||!discordIdValid(id))return;
  const job=await env.DB.prepare(`INSERT INTO discord_role_jobs (discord_id,nickname,reason)
    SELECT discord_id,nickname,'Вступление на сервер Discord' FROM moderators WHERE discord_id=?
    ON CONFLICT(discord_id) DO UPDATE SET nickname=excluded.nickname,reason=excluded.reason,revision=excluded.revision
    RETURNING discord_id`).bind(id).first();
  if(job)await drainDiscordJobs(env,1,{memberId:id});
}

export async function drainDiscordJobs(env,limit=6,{memberId=null,newest=false}={}) {
  const counts={updated:0,unchanged:0,missing:0,blocked:0,failed:0};
  if(!env.DISCORD_BOT_TOKEN)return counts;
  const db=env.DB;
  const order=newest?'queued_at DESC,rowid DESC':'queued_at,rowid';
  for(let n=0;n<limit;n++){
    const job=await db.prepare(`UPDATE discord_role_jobs SET leased_until=unixepoch()+90
      WHERE discord_id=(SELECT discord_id FROM discord_role_jobs WHERE leased_until<=unixepoch()
        AND (? IS NULL OR discord_id=?) ORDER BY ${order} LIMIT 1)
      RETURNING discord_id,nickname,reason,previous_position,revision`).bind(memberId,memberId).first();
    if(!job)break;
    try{
      const status=await reconcile(env,job);
      counts[status]++;
      const result=await db.prepare('DELETE FROM discord_role_jobs WHERE discord_id=? AND revision=?').bind(job.discord_id,job.revision).run();
      if(!(result.meta?.changes??result.changes))await db.prepare('UPDATE discord_role_jobs SET leased_until=0 WHERE discord_id=?').bind(job.discord_id).run();
    }catch(error){
      counts.lastError=String(error?.message||error?.name||'Error').replace(/https?:\/\/\S+/g,'[URL]').replace(/\d{16,20}/g,'[ID]').replaceAll(env.DISCORD_BOT_TOKEN,'[secret]').slice(0,180);
      console.error('Discord role job failed',counts.lastError);
      counts.failed++;
      await db.prepare('UPDATE discord_role_jobs SET leased_until=unixepoch()+30 WHERE discord_id=?').bind(job.discord_id).run();
    }
  }
  return counts;
}

const bytes=hex=>Uint8Array.from(hex.match(/../g),part=>parseInt(part,16));
async function signedInteraction(request,key) {
  const signature=request.headers.get('x-signature-ed25519')||'';
  const timestamp=request.headers.get('x-signature-timestamp')||'';
  if(!/^[a-f0-9]{64}$/i.test(key||'')||!/^\d{10}$/.test(timestamp)||!/^[a-f0-9]{128}$/i.test(signature)||Math.abs(Date.now()/1000-Number(timestamp))>300)return null;
  const body=await request.text();
  if(body.length>65536)return null;
  try {
    const publicKey=await crypto.subtle.importKey('raw',bytes(key),'Ed25519',false,['verify']);
    if(!await crypto.subtle.verify('Ed25519',publicKey,bytes(signature),new TextEncoder().encode(timestamp+body)))return null;
    return JSON.parse(body);
  }catch{return null}
}

const ephemeral=content=>json({type:4,data:{content,flags:64,allowed_mentions:{parse:[]}}});
export async function discordInteraction(request,env,ctx) {
  const data=await signedInteraction(request,env.DISCORD_PUBLIC_KEY);
  if(!data)return json({error:'Invalid Discord signature'},401);
  if(data.type===1)return json({type:1});
  if(data.type===2&&isTicketCommand(data.data?.name))return ticketInteraction(data,env,ctx);
  if((data.type===3||data.type===5)&&data.data?.custom_id?.startsWith?.('jt:'))return ticketInteraction(data,env,ctx);
  if(data.type!==2||data.guild_id!==discordGuild||data.data?.name!=='sync')return ephemeral('Команда доступна только на сервере Jevox.');
  const userId=data.member?.user?.id;
  if(!discordIdValid(userId)||!data.member?.roles?.includes(discordRoles['Владелец']))return ephemeral('Команда /sync доступна только владельцам.');
  if(!env.DISCORD_BOT_TOKEN)return ephemeral('Подключение Discord ещё не настроено.');
  try{
    const db=env.DB;
    const {linked}=await db.prepare('SELECT COUNT(*) AS linked FROM moderators WHERE discord_id IS NOT NULL').first();
    if(!linked)return ephemeral('В журнале пока нет сотрудников с привязанным Discord ID. Добавьте ID в «Управлении составом».');
    await db.prepare(`INSERT INTO discord_role_jobs (discord_id,nickname,reason)
      SELECT discord_id,nickname,'Синхронизация по команде /sync' FROM moderators WHERE discord_id IS NOT NULL
      ON CONFLICT(discord_id) DO NOTHING`).run();
    ctx.waitUntil(reportSync(env,userId).catch(()=>console.error('Discord sync report failed')));
    return ephemeral(`Синхронизация запущена. Сотрудников с Discord ID: **${linked}**. Итог появится в <#${discordLog}>.`);
  }catch{
    return ephemeral('Не удалось поставить синхронизацию в очередь. Попробуйте снова.');
  }
}

async function reportSync(env,userId) {
  const counts=await drainDiscordJobs(env,8);
  const {pending}=await env.DB.prepare('SELECT COUNT(*) AS pending FROM discord_role_jobs').first();
  const {unlinked}=await env.DB.prepare('SELECT COUNT(*) AS unlinked FROM moderators WHERE discord_id IS NULL').first();
  let content=`Обновлено: **${counts.updated}** • Уже актуально: **${counts.unchanged}** • Нет на сервере: **${counts.missing}** • Требуют проверки: **${counts.blocked}** • Ошибок: **${counts.failed}** • Без Discord ID: **${unlinked}**.`;
  if(pending)content+=` Осталось в очереди: **${pending}**. Бот продолжит обработку автоматически.`;
  await logDiscord(env.DISCORD_BOT_TOKEN,'Синхронизация состава',`Запустил <@${userId}>.\n${content}`,0x9caabd);
}
