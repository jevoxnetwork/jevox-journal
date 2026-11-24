import {json} from './security.mjs';
import {ticketArt} from './discord-ticket-art.mjs';
import {discordGuild,discordRoles,discordIdValid,discordRequest} from './discord-api.mjs';

export const ticketPanelChannel='1573750022762401943';
export const ticketCategory='1574293079656103976';
const selection='jt:topic';
const topicButton='jt:topic:';
const panelVersion=4;
const ticketColor=0x313338;
const ownerRole=discordRoles['Владелец'];
const commandVersion=2;
const commandDefinitions=[
  {name:'close',description:'Закрыть тикет (Саппорт и выше)'},
  {name:'force-close',description:'Закрыть тикет и сразу удалить канал (Менеджер и выше)'},
  {name:'add',description:'Дать участнику доступ к текущему тикету',options:[{type:6,name:'user',description:'Участник сервера',required:true}]},
];
export const isTicketCommand=name=>commandDefinitions.some(command=>command.name===name);
const timeoutHour=3600;
const supportBanner='https://jevox-discord-presence.1pirs.workers.dev/skins/discord-ticket-support-v3.jpg';
const ticketName=ticket=>'💥・'+ticket.nickname.toLowerCase();
const emojiName=key=>'jevox_tk_'+key;
const ticketEmoji=(icons,key,fallback)=>icons[key]?{id:icons[key],name:emojiName(key)}:{name:fallback};
const emojiText=(icons,key,fallback)=>icons[key]?`<:${emojiName(key)}:${icons[key]}>`:fallback;
async function ticketEmojis(db){
  const row=await db.prepare('SELECT emoji_json FROM discord_ticket_setup WHERE id=1').first();
  return row?.emoji_json?JSON.parse(row.emoji_json):{};
}
const supportRole=discordRoles['Саппорт'];
const managerRole=discordRoles['Менеджер'];
const leaders=[managerRole,discordRoles['Младший Администратор'],discordRoles['Администратор']];
const generalStaff=[supportRole,...leaders];
const nicknameField={id:'nickname',label:'Ваш никнейм',min:3,max:16,style:1};
const details=(id,label,placeholder)=>({id,label,placeholder,min:3,max:900,style:2});
const categories={
  support:{label:'Техническая поддержка',icon:'🛠️',roles:generalStaff,pings:[supportRole,discordRoles['Младший Администратор']],
    fields:[nicknameField,details('problem','Что случилось?','Опишите проблему и когда она появилась')]},
  complaint:{label:'Жалобы',icon:'⚖️',roles:leaders,pings:[managerRole],
    fields:[nicknameField,{id:'target',label:'Никнейм нарушителя',min:3,max:32,style:1},details('report','Суть жалобы','Расскажите, что произошло'),details('evidence','Доказательства','Вставьте ссылки на скриншоты или видео')]},
  other:{label:'Прочее',icon:'💬',roles:generalStaff,pings:[supportRole],
    fields:[nicknameField,details('question','Чем можем вам помочь?','Опишите ваш вопрос')]},
};

const known=key=>typeof key==='string'&&Object.hasOwn(categories,key);
const noMentions={parse:[]};
const ephemeral=content=>json({type:4,data:{content,flags:64,allowed_mentions:noMentions}});
const defer=()=>json({type:5,data:{flags:64}});
const panelMarker=(message,botId)=>message?.author?.id===botId&&message.components?.some(row=>row.components?.some(component=>component.custom_id===selection||component.custom_id?.startsWith(topicButton)));
const topicMarker=id=>'Jevox Support · Ticket '+id;
const viewChannel=1n<<10n;
const sendMessages=1n<<11n;
const embedLinks=1n<<14n;
const attachFiles=1n<<15n;
const readHistory=1n<<16n;
const createPublicThreads=1n<<35n;
const createPrivateThreads=1n<<36n;
const sendInThreads=1n<<38n;
const openBits=String(viewChannel|sendMessages|embedLinks|attachFiles|readHistory);
const readBits=String(viewChannel|readHistory);
const writeDeny=String(sendMessages|createPublicThreads|createPrivateThreads|sendInThreads);

function panelPayload(icons){
  const options=Object.entries(categories);
  return {
    allowed_mentions:noMentions,
    embeds:[{color:ticketColor,image:{url:supportBanner}},{title:'Поддержка Jevox Network',color:ticketColor,
      description:'Выберите тему обращения и заполните форму. Бот откроет приватный канал, где команда ответит вам.\n\nДля технической проблемы укажите, когда она появилась и как её повторить. К жалобе приложите скриншоты или видео.'}],
    components:[{type:1,components:options.map(([key,option])=>({
      type:2,style:2,custom_id:topicButton+key,label:option.label,emoji:ticketEmoji(icons,key,option.icon),
    }))}],
  };
}

export async function publishTicketPanel(env){
  if(!env.DISCORD_BOT_TOKEN)return;
  const db=env.DB;
  const row=await db.prepare(`UPDATE discord_ticket_panel SET lease_until=unixepoch()+60,attempts=attempts+1
    WHERE id=1 AND (message_id IS NULL OR layout_version<?) AND lease_until<=unixepoch()
    RETURNING attempts,message_id`).bind(panelVersion).first();
  if(!row)return;
  try{
    const token=env.DISCORD_BOT_TOKEN,base='/channels/'+ticketPanelChannel;
    const payload=panelPayload(await ticketEmojis(db));
    let message;
    if(row.message_id){
      const edited=await discordRequest(token,base+'/messages/'+row.message_id,'PATCH',payload);
      if(edited.ok)message=await edited.json();
      else if(edited.status!==404)throw Error('Panel edit HTTP '+edited.status);
    }
    if(!message){
      const [channel,parent]=await Promise.all([discordRequest(token,base),discordRequest(token,'/channels/'+ticketCategory)]);
      if(!channel.ok)throw Error('Channel HTTP '+channel.status);
      if(!parent.ok)throw Error('Category HTTP '+parent.status);
      const target=await channel.json(),category=await parent.json();
      if(category.guild_id!==discordGuild||category.type!==4)throw Error('Invalid ticket category');
      if(target.guild_id!==discordGuild||![0,5].includes(target.type))throw Error('Invalid ticket panel channel');
      if(row.attempts>1){
        const [recent,profile]=await Promise.all([
          discordRequest(token,base+'/messages?limit=50'),discordRequest(token,'/users/@me'),
        ]);
        if(recent.ok&&profile.ok){
          const {id}=await profile.json();
          if(discordIdValid(id))message=(await recent.json()).find(item=>panelMarker(item,id));
        }
      }
      const response=message
        ?await discordRequest(token,base+'/messages/'+message.id,'PATCH',payload)
        :await discordRequest(token,base+'/messages','POST',{...payload,nonce:'jevox-tickets-panel-v1',enforce_nonce:true});
      if(!response.ok)throw Error('Panel HTTP '+response.status);
      message=await response.json();
    }
    if(!discordIdValid(message.id))throw Error('Invalid ticket panel message');
    const buttons=message.components?.[0]?.components;
    if(!Object.keys(categories).every(key=>buttons?.some(button=>button.type===2&&button.custom_id===topicButton+key)))
      throw Error('Discord did not return the ticket buttons');
    await db.prepare('UPDATE discord_ticket_panel SET message_id=?,layout_version=?,last_error=NULL,lease_until=0 WHERE id=1 AND attempts=?').bind(message.id,panelVersion,row.attempts).run();
    return true;
  }catch(error){
    await db.prepare('UPDATE discord_ticket_panel SET last_error=?,lease_until=unixepoch()+60 WHERE id=1 AND attempts=?')
      .bind(error.message,row.attempts).run();
  }
}

function modal(key){
  const category=categories[key];
  return json({type:9,data:{custom_id:'jt:open:'+key,title:category.label,components:category.fields.map(field=>({
    type:18,label:field.label,component:{type:4,custom_id:field.id,style:field.style,min_length:field.min,max_length:field.max,
      required:true,...(field.placeholder?{placeholder:field.placeholder}:{})},
  }))}});
}

function parseAnswers(data,category){
  const components=(data.data.components||[]).flatMap(row=>row.component?[row.component]:row.components||[]);
  const fields=Object.fromEntries(components.map(field=>[field.custom_id,typeof field.value==='string'?field.value.trim():'']));
  if(!/^[A-Za-z0-9_]{3,16}$/.test(fields.nickname||''))return null;
  const answer={};
  for(const expected of category.fields){
    const value=fields[expected.id];
    if(!value||value.length<expected.min||value.length>expected.max)return null;
    answer[expected.id]=value;
  }
  return answer;
}

function permissions(ticket,guests=[],closed=false){
  const category=categories[ticket.kind];
  return [
    {id:discordGuild,type:0,allow:'0',deny:String(viewChannel)},
    ...[ownerRole,...category.roles].map(id=>({id,type:0,allow:closed?readBits:openBits,deny:closed?writeDeny:'0'})),
    ...[ticket.author_id,...guests].map(id=>({id,type:1,allow:closed?readBits:openBits,deny:closed?writeDeny:'0'})),
    {id:ticket.bot_id,type:1,allow:openBits,deny:'0'},
  ];
}

function ticketMessage(ticket,icons,initial=false){
  const category=categories[ticket.kind];
  const answers=JSON.parse(ticket.answers);
  const closed=!!ticket.closed_at;
  const color=ticketColor;
  const state=closed?`Закрыл <@${ticket.closed_by}>`:ticket.assignee_id?`Принял <@${ticket.assignee_id}>`:'Ожидает сотрудника';
  const safe=value=>value.replace(/@/g,'@\u200b');
  const fields=[
    {name:'Автор',value:`<@${ticket.author_id}>`,inline:true},
    {name:'Никнейм',value:safe(ticket.nickname),inline:true},
    {name:'Статус',value:state,inline:true},
    ...category.fields.filter(field=>field.id!=='nickname').map(field=>({name:field.label,value:safe(answers[field.id])})),
  ];
  return {
    ...(initial?{content:`<@${ticket.author_id}> ${category.pings.map(id=>`<@&${id}>`).join(' ')}`,nonce:'jt-'+ticket.id,enforce_nonce:true}:{}),
    allowed_mentions:initial?{parse:[],users:[ticket.author_id],roles:category.pings}:noMentions,
    embeds:[{color,image:{url:supportBanner}},{title:category.label,color,
      description:closed?(ticket.delete_after?`Канал удалится <t:${ticket.delete_after}:R>.`:'Переписка доступна для чтения.'):'Если нужно, добавьте детали или скриншоты прямо в этом канале.',fields,
      footer:{text:'Jevox Network · Поддержка'},timestamp:new Date(ticket.created_at*1000).toISOString()}],
    components:[{type:1,components:[
      {type:2,style:3,label:ticket.assignee_id?'Принят':'Принять',emoji:ticketEmoji(icons,'claim','✅'),custom_id:'jt:claim:'+ticket.id,disabled:closed||!!ticket.assignee_id},
      {type:2,style:4,label:closed?'Закрыт':'Закрыть тикет',emoji:ticketEmoji(icons,'close','🔒'),custom_id:'jt:close:'+ticket.id,disabled:closed},
    ]}],
  };
}

async function discordData(token,path,method,body){
  const response=await discordRequest(token,path,method,body);
  if(!response.ok)throw Error('Ticket HTTP '+response.status);
  return response.status===204?null:response.json();
}

export async function setupTicketCommands(env){
  if(!env.DISCORD_BOT_TOKEN)return;
  const {DB:db,DISCORD_BOT_TOKEN:token}=env;
  const row=await db.prepare(`UPDATE discord_ticket_setup SET commands_lease=unixepoch()+60
    WHERE id=1 AND commands_lease<=unixepoch() AND (command_version<? OR emoji_json IS NULL)
    RETURNING command_version,emoji_json`).bind(commandVersion).first();
  if(!row)return;
  try{
    const app=await discordData(token,'/applications/@me','GET');
    if(!discordIdValid(app?.id))throw Error('Discord ticket app unavailable');
    if(row.command_version<commandVersion){
      const path=`/applications/${app.id}/guilds/${discordGuild}/commands`;
      const commands=await Promise.all(commandDefinitions.map(command=>discordData(token,path,'POST',command)));
      if(!commandDefinitions.every(command=>commands.some(item=>item.name===command.name&&discordIdValid(item.id))))
        throw Error('Discord ticket commands not confirmed');
      const registered=await discordData(token,path,'GET');
      const priority=registered.find(command=>command.name==='priority'&&command.type===1);
      if(priority&&discordIdValid(priority.id))await discordData(token,path+'/'+priority.id,'DELETE');
      await db.batch([
        db.prepare('UPDATE discord_ticket_setup SET command_version=? WHERE id=1').bind(commandVersion),
        db.prepare('UPDATE discord_tickets SET revision=revision+1 WHERE deleted_at IS NULL'),
      ]);
    }
    if(!row.emoji_json){
      const path=`/applications/${app.id}/emojis`;
      const {items}=await discordData(token,path,'GET');
      const icons={};
      for(const [key,image] of Object.entries(ticketArt)){
        const name=emojiName(key);
        const icon=items.find(item=>item.name===name)||await discordData(token,path,'POST',{name,image});
        if(!discordIdValid(icon?.id))throw Error('Discord ticket emoji not confirmed');
        icons[key]=icon.id;
      }
      await db.batch([
        db.prepare('UPDATE discord_ticket_setup SET emoji_json=? WHERE id=1').bind(JSON.stringify(icons)),
        db.prepare('UPDATE discord_ticket_panel SET layout_version=0 WHERE id=1'),
        db.prepare('UPDATE discord_tickets SET revision=revision+1 WHERE closed_at IS NULL'),
      ]);
    }
    await db.prepare('UPDATE discord_ticket_setup SET commands_lease=0,last_error=NULL WHERE id=1').run();
  }catch(error){
    await db.prepare('UPDATE discord_ticket_setup SET last_error=? WHERE id=1').bind(error.message).run();
  }
}

async function announceTransitions(env,ticket,icons,channel){
  const {DB:db,DISCORD_BOT_TOKEN:token}=env;
  if(ticket.assignee_id&&!ticket.claim_announced){
    await discordData(token,channel+'/messages','POST',{
      content:`${emojiText(icons,'claim','✅')} <@${ticket.assignee_id}> принял тикет и ответит в этом канале.`,
      allowed_mentions:noMentions,nonce:'jc-'+ticket.id,enforce_nonce:true,
    });
    await db.prepare('UPDATE discord_tickets SET claim_announced=1 WHERE id=?').bind(ticket.id).run();
  }
  if(ticket.closed_at&&!ticket.close_announced){
    await discordData(token,channel+'/messages','POST',{
      content:`${emojiText(icons,'close','🔒')} <@${ticket.closed_by}> закрыл тикет. Канал удалится <t:${ticket.delete_after}:R>.`,
      allowed_mentions:noMentions,nonce:'jx-'+ticket.id,enforce_nonce:true,
    });
    await db.prepare('UPDATE discord_tickets SET close_announced=1 WHERE id=?').bind(ticket.id).run();
  }
}

async function syncTicket(env,id=null){
  const db=env.DB,token=env.DISCORD_BOT_TOKEN;
  const ticket=await db.prepare(`UPDATE discord_tickets SET leased_until=unixepoch()+60,attempts=attempts+1
    WHERE id=(SELECT id FROM discord_tickets WHERE deleted_at IS NULL AND synced_revision<revision AND leased_until<=unixepoch()
    AND (delete_after IS NULL OR delete_after>unixepoch())
    AND (? IS NULL OR id=?) ORDER BY (closed_at IS NOT NULL AND delete_after IS NULL),created_at,id LIMIT 1) RETURNING *`).bind(id,id).first();
  if(!ticket)return null;
  try{
    const guildChannels='/guilds/'+discordGuild+'/channels';
    const [guestRows,icons]=await Promise.all([
      db.prepare('SELECT user_id FROM discord_ticket_guests WHERE ticket_id=?').bind(ticket.id).all(),
      ticketEmojis(db),
    ]);
    const guests=guestRows.results.map(row=>row.user_id);
    let created=false;
    if(!ticket.channel_id){
      let channel;
      if(ticket.attempts>1){
        const channels=await discordData(token,guildChannels,'GET');
        channel=channels.find(item=>item.topic===topicMarker(ticket.id));
      }
      if(!channel)channel=await discordData(token,guildChannels,'POST',{
        name:ticketName(ticket),type:0,
        parent_id:ticketCategory,topic:topicMarker(ticket.id),permission_overwrites:permissions(ticket,guests),
      });
      if(!discordIdValid(channel.id))throw Error('Invalid created ticket channel');
      ticket.channel_id=channel.id;
      created=true;
      await db.prepare('UPDATE discord_tickets SET channel_id=? WHERE id=? AND attempts=?').bind(channel.id,ticket.id,ticket.attempts).run();
    }
    const channel='/channels/'+ticket.channel_id;
    if(!created||ticket.closed_at)await discordData(token,channel,'PATCH',{permission_overwrites:permissions(ticket,guests,!!ticket.closed_at)});
    if(!ticket.message_id){
      const message=await discordData(token,channel+'/messages','POST',ticketMessage(ticket,icons,true));
      if(!discordIdValid(message.id))throw Error('Invalid ticket message');
      await db.prepare('UPDATE discord_tickets SET message_id=? WHERE id=? AND attempts=?').bind(message.id,ticket.id,ticket.attempts).run();
    }else{
      await discordData(token,channel+'/messages/'+ticket.message_id,'PATCH',ticketMessage(ticket,icons));
    }
    await announceTransitions(env,ticket,icons,channel);
    await db.prepare('UPDATE discord_tickets SET synced_revision=?,leased_until=0 WHERE id=? AND attempts=?')
      .bind(ticket.revision,ticket.id,ticket.attempts).run();
    return {channel:ticket.channel_id};
  }catch(error){
    console.error('Discord ticket update failed',error.message);
    await db.prepare('UPDATE discord_tickets SET leased_until=unixepoch()+30 WHERE id=? AND attempts=?').bind(ticket.id,ticket.attempts).run();
    return {error:true};
  }
}

async function deleteDueTicket(env,id=null){
  const {DB:db,DISCORD_BOT_TOKEN:token}=env;
  const ticket=await db.prepare(`UPDATE discord_tickets SET leased_until=unixepoch()+60,attempts=attempts+1
    WHERE id=(SELECT id FROM discord_tickets WHERE closed_at IS NOT NULL AND delete_after<=unixepoch()
      AND deleted_at IS NULL AND channel_id IS NOT NULL AND leased_until<=unixepoch()
      AND (? IS NULL OR id=?) ORDER BY delete_after LIMIT 1)
    RETURNING id,channel_id,attempts`).bind(id,id).first();
  if(!ticket)return null;
  try{
    const path='/channels/'+ticket.channel_id;
    const response=await discordRequest(token,path);
    if(response.ok){
      const channel=await response.json();
      if(channel.guild_id!==discordGuild||channel.type!==0||channel.topic!==topicMarker(ticket.id))
        throw Error('Ticket channel identity mismatch');
      const removal=await discordRequest(token,path,'DELETE');
      if(!removal.ok&&removal.status!==404)throw Error('Ticket deletion HTTP '+removal.status);
    }else if(response.status!==404)throw Error('Ticket lookup HTTP '+response.status);
    await db.batch([
      db.prepare("UPDATE discord_tickets SET deleted_at=unixepoch(),answers='{}',leased_until=0 WHERE id=? AND attempts=?").bind(ticket.id,ticket.attempts),
      db.prepare('DELETE FROM discord_ticket_guests WHERE ticket_id=?').bind(ticket.id),
    ]);
    return 'deleted';
  }catch(error){
    console.error('Discord ticket deletion failed',error.message);
    await db.prepare('UPDATE discord_tickets SET leased_until=unixepoch()+120 WHERE id=? AND attempts=?').bind(ticket.id,ticket.attempts).run();
    return 'pending';
  }
}

export async function drainTickets(env){
  if(!env.DISCORD_BOT_TOKEN)return;
  for(let i=0;i<8;i++)if(!await deleteDueTicket(env))break;
  for(let i=0;i<4;i++)if(!await syncTicket(env))break;
}

async function resolveInteraction(env,interaction,task){
  let content;
  try{content=await task();}
  catch(error){
    console.error('Discord ticket interaction failed',error?.name||'Error');
    content='Не удалось обработать тикет. Попробуйте ещё раз.';
  }
  try{
    const path=`/webhooks/${interaction.application_id}/${encodeURIComponent(interaction.token)}/messages/@original`;
    const payload={content,allowed_mentions:noMentions};
    let response=await discordRequest(null,path,'PATCH',payload);
    if(response.status===404){
      await new Promise(resolve=>setTimeout(resolve,350));
      response=await discordRequest(null,path,'PATCH',payload);
    }
    if(!response.ok)throw Error();
  }catch{console.error('Discord ticket response update failed');}
}

const staffAccess=(ticket,roles)=>roles.includes(ownerRole)||categories[ticket.kind].roles.some(role=>roles.includes(role));

async function closeTicket(env,id,user){
  const changed=await env.DB.prepare(`UPDATE discord_tickets SET closed_by=?,closed_at=unixepoch(),
    delete_after=unixepoch()+?,revision=revision+1 WHERE id=? AND closed_at IS NULL RETURNING id`).bind(user,timeoutHour,id).first();
  if(!changed)return 'Тикет уже закрыт.';
  const result=await syncTicket(env,id);
  return result?.channel?'Тикет закрыт. Канал удалится через час.':'Закрытие тикета поставлено в очередь.';
}

async function runTicketCommand(env,data,channel,user){
  const db=env.DB,name=data.data.name,roles=data.member.roles||[];
  const ticket=await db.prepare('SELECT * FROM discord_tickets WHERE channel_id=? AND deleted_at IS NULL').bind(channel).first();
  if(!ticket)return 'Эта команда работает внутри тикета.';
  if(name==='close'){
    if(!roles.includes(ownerRole)&&!generalStaff.some(role=>roles.includes(role))&&!roles.includes(discordRoles['Спектатор']))
      return 'Команда доступна с роли «Саппорт».';
    return closeTicket(env,ticket.id,user);
  }
  if(name==='force-close'){
    if(!roles.includes(ownerRole)&&!leaders.some(role=>roles.includes(role)))return 'Команда доступна с роли «Менеджер».';
    const updated=await db.prepare(`UPDATE discord_tickets SET closed_at=COALESCE(closed_at,unixepoch()),
      closed_by=COALESCE(closed_by,?),delete_after=unixepoch(),revision=revision+1
      WHERE id=? AND deleted_at IS NULL RETURNING id`).bind(user,ticket.id).first();
    if(!updated)return 'Канал тикета уже удалён.';
    const status=await deleteDueTicket(env,ticket.id);
    return status==='deleted'?'Тикет закрыт, канал удалён.':'Тикет закрыт. Бот повторит удаление канала.';
  }
  if(!staffAccess(ticket,roles))return 'У вас нет прав на это действие.';
  if(ticket.closed_at)return 'Тикет уже закрыт.';
  const option=data.data.options?.find(item=>item.name==='user')?.value;
  if(!discordIdValid(option)||option===ticket.bot_id||option===ticket.author_id)return 'Выберите другого участника сервера.';
  const membership=await discordRequest(env.DISCORD_BOT_TOKEN,`/guilds/${discordGuild}/members/${option}`);
  if(!membership.ok)return membership.status===404?'Участник не найден на сервере.':'Не удалось проверить участника.';
  const guest=await db.prepare(`INSERT INTO discord_ticket_guests(ticket_id,user_id)
    SELECT id,? FROM discord_tickets WHERE id=? AND closed_at IS NULL
    ON CONFLICT(ticket_id,user_id) DO NOTHING RETURNING user_id`).bind(option,ticket.id).first();
  if(!guest)return 'Участник уже добавлен или тикет закрыт.';
  const result=await syncTicket(env,ticket.id);
  if(!result?.channel)return 'Изменение сохранено, бот применит его при следующей синхронизации.';
  return `<@${option}> получил доступ к тикету.`;
}

export async function ticketInteraction(data,env,ctx){
  const user=data.member?.user?.id;
  if(data.guild_id!==discordGuild||!discordIdValid(user))return ephemeral('Поддержка доступна на сервере Jevox.');
  if(!env.DISCORD_BOT_TOKEN)return ephemeral('Поддержка пока недоступна.');
  const customId=data.data.custom_id,channel=data.channel_id??data.channel?.id;
  if(data.type===2&&isTicketCommand(data.data.name)){
    if(!discordIdValid(data.application_id)||!discordIdValid(channel)||typeof data.token!=='string'||!data.token)
      return ephemeral('Команда доступна внутри тикета.');
    ctx.waitUntil(resolveInteraction(env,data,()=>runTicketCommand(env,data,channel,user)));
    return defer();
  }
  if(data.type===3&&(customId===selection||customId.startsWith(topicButton))){
    const key=customId===selection?data.data.values?.[0]:customId.slice(topicButton.length);
    if(channel!==ticketPanelChannel||!known(key))return ephemeral('Выберите тему в панели поддержки.');
    return modal(key);
  }
  if(!discordIdValid(data.application_id)||typeof data.token!=='string'||!data.token)return ephemeral('Не удалось открыть действие.');
  const match=customId.match(/^jt:(open|claim|close):([a-z0-9]+)$/);
  if(!match)return ephemeral('Действие не найдено.');
  const [,action,key]=match;
  if(data.type===5&&action==='open'){
    if(channel!==ticketPanelChannel||!known(key)||!discordIdValid(data.id))return ephemeral('Откройте форму заново из панели поддержки.');
    const answers=parseAnswers(data,categories[key]);
    if(!answers)return ephemeral('Проверьте никнейм и заполните все поля формы.');
    ctx.waitUntil(resolveInteraction(env,data,async()=>{
      await env.DB.prepare(`INSERT INTO discord_tickets (id,author_id,bot_id,kind,nickname,answers)
        VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).bind(data.id,user,data.application_id,key,answers.nickname,JSON.stringify(answers)).run();
      const result=await syncTicket(env,data.id);
      const created=result?.channel??(await env.DB.prepare('SELECT channel_id FROM discord_tickets WHERE id=?').bind(data.id).first())?.channel_id;
      return created?`Тикет создан. Перейдите в <#${created}>.`:'Тикет принят. Канал появится после обработки ботом.';
    }));
    return defer();
  }
  if(data.type!==3||!['claim','close'].includes(action)||!discordIdValid(key)||!discordIdValid(channel))
    return ephemeral('Действие не найдено.');
  ctx.waitUntil(resolveInteraction(env,data,async()=>{
    const db=env.DB;
    const ticket=await db.prepare('SELECT * FROM discord_tickets WHERE id=? AND channel_id=? AND message_id=?')
      .bind(key,channel,data.message?.id??null).first();
    if(!ticket)return 'Тикет не найден.';
    const staff=staffAccess(ticket,data.member.roles||[]);
    if(!(staff||action==='close'&&ticket.author_id===user))return 'У вас нет прав на это действие.';
    if(action==='close')return closeTicket(env,key,user);
    const claimed=await db.prepare(`UPDATE discord_tickets SET assignee_id=?,revision=revision+1
      WHERE id=? AND closed_at IS NULL AND assignee_id IS NULL RETURNING id`).bind(user,key).first();
    if(!claimed)return 'Тикет уже принят или закрыт.';
    await syncTicket(env,key);
    return 'Вы приняли тикет.';
  }));
  return defer();
}
