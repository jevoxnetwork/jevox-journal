import {equal,json} from './security.mjs';
import {hasStaffRank,staffPositions} from './staff-positions.mjs';
import {serverData} from './server-data.mjs';

const error=(message,status=400)=>json({error:message},status);
const nickname=/^[A-Za-z0-9_]{3,16}$/;
const checkId=/^[a-f0-9-]{36}$/;
const field=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
const activeRanks=staffPositions.slice(0,6);
const terminal=['released','banned','left','stopped','failed'];

async function body(request){
  const data=await request.text();
  if(data.length>65000)throw Error();
  return JSON.parse(data);
}

export async function checkChatHistory(request,env,session,url){
  if(session?.status!=='active'||!session.journal_moderator_id)return error('Нет доступа.',403);
  if(request.method!=='GET')return error('Недопустимый метод.',405);
  const id=url.searchParams.get('id')||'',before=url.searchParams.get('before');
  const cursor=before===null?null:Number(before);
  if(!checkId.test(id)||(before!==null&&(!/^\d+$/.test(before)||!Number.isSafeInteger(cursor)||cursor<1)))
    return error('Некорректная проверка.');
  const owner=session.journal_moderator_id,db=env.DB;
  const check=await db.prepare(`SELECT w.id,w.player,w.moderator,w.created
    FROM web_checks w LEFT JOIN server_checks s ON s.id='fastfreeze-'||w.id
    WHERE w.id=? AND w.staff_id=?
    AND COALESCE(s.started,w.created)>COALESCE((SELECT activity_reset_at FROM staff_journal_controls WHERE moderator_id=?),-1)
    AND COALESCE(s.started,w.created)>COALESCE((SELECT cutoff FROM server_retention WHERE kind='checks'),-1)`).bind(id,owner,owner).first();
  if(!check)return error('Чат проверки не найден.',404);
  const pageSize=100;
  const rows=(await db.prepare(`SELECT rowid AS sequence,id,side,body,created FROM web_check_messages
    WHERE check_id=?${cursor===null?'':' AND rowid<?'} ORDER BY rowid DESC LIMIT ?`)
    .bind(...(cursor===null?[id,pageSize+1]:[id,cursor,pageSize+1])).all()).results;
  const page=rows.slice(0,pageSize);
  const older=rows.length>pageSize?page.at(-1).sequence:null;
  const messages=page.reverse().map(({id,side,body,created})=>({id,side,body,created}));
  return json({check,messages,older});
}

export async function webChecks(request,env,session,csrf){
  if(session?.status!=='active'||!hasStaffRank(session.journal_position,'Саппорт')||!session.journal_moderator_id)
    return error('Нет доступа.',403);
  const db=env.DB,owner=session.journal_moderator_id;
  const seen=await db.prepare('SELECT seen FROM web_check_bridge WHERE id=1').first();
  const connected=!!env.CHECK_BRIDGE_TOKEN&&Date.now()-(seen?.seen??0)<18000;
  if(request.method==='GET'){
    const check=await db.prepare("SELECT w.*,s.started,s.ended FROM web_checks w LEFT JOIN server_checks s ON s.id='fastfreeze-'||w.id WHERE w.staff_id=? ORDER BY (w.state IN ('queued','active')) DESC,w.created DESC,w.rowid DESC LIMIT 1").bind(owner).first();
    if(!check)return json({connected,check:null,messages:[],action:null});
    const [messages,action]=await Promise.all([
      db.prepare('SELECT id,side,body,created FROM (SELECT rowid,id,side,body,created FROM web_check_messages WHERE check_id=? ORDER BY rowid DESC LIMIT 150) ORDER BY rowid').bind(check.id).all(),
      db.prepare("SELECT kind,state,detail FROM web_check_jobs WHERE check_id=? AND kind!='chat' ORDER BY id DESC LIMIT 1").bind(check.id).first(),
    ]);
    return json({connected,check,messages:messages.results,action});
  }
  if(request.method!=='POST'||!csrf)return error('Нет доступа.',403);
  if(!connected)return error('Игровой сервер сейчас не связан с журналом.',503);
  let input;try{input=await body(request)}catch{return error('Некорректный запрос.')}
  const time=Date.now();
  if(input?.kind==='start'){
    const player=field(input.player,17),reason=field(input.reason,301),seconds=input.seconds;
    const moderator=session.journal_nickname;
    if(!nickname.test(player)||!nickname.test(moderator)||player.toLowerCase()===moderator.toLowerCase()||
       reason.length<3||reason.length>300||!Number.isInteger(seconds)||seconds<30||seconds>900)
      return error('Укажите ник игрока, причину и время от 30 до 900 секунд.');
    const id=crypto.randomUUID();
    try{
      await db.batch([
        db.prepare('INSERT INTO web_checks (id,staff_id,moderator,player,reason,seconds,created) VALUES (?,?,?,?,?,?,?)').bind(id,owner,moderator,player,reason,seconds,time),
        db.prepare("INSERT INTO web_check_jobs (check_id,kind,body,created) VALUES (?,'start','{}',?)").bind(id,time),
      ]);
    }catch(e){if(/unique/i.test(String(e)))return error('У вас или у игрока уже есть активная проверка.',409);throw e;}
    return json({id},201);
  }
  const {id,kind}=input??{};
  if(!checkId.test(id)||!['chat','release','ban'].includes(kind))return error('Некорректное действие.');
  const check=await db.prepare("SELECT id FROM web_checks WHERE id=? AND staff_id=? AND state='active'").bind(id,owner).first();
  if(!check)return error('Активная проверка не найдена.',404);
  const message=field(input.message,501);
  const reason=field(input.reason,301).replace(/[\r\n\t\x00-\x1f]/g,' ');
  const duration=field(input.duration,9);
  if(kind==='chat'&&(!message||message.length>500))return error('Введите сообщение до 500 символов.');
  if(kind==='ban'&&(reason.length<3||reason.length>300||! /^(?:perm|[1-9]\d{0,3}[mhdw])$/.test(duration)))
    return error('Укажите причину и срок, например 1d, 7d, 30d или perm.');
  try{
    const result=await db.prepare("INSERT INTO web_check_jobs (check_id,kind,body,created) SELECT id,?,?,? FROM web_checks WHERE id=? AND staff_id=? AND state='active'")
      .bind(kind,JSON.stringify({message,reason,duration}),time,id,owner).run();
    if(!(result.meta?.changes??result.changes))return error('Проверка завершена.',409);
  }catch(e){if(/unique/i.test(String(e)))return error('Завершение проверки уже выполняется.',409);throw e;}
  return json({ok:true},202);
}

export async function checkBridge(request,env){
  if(request.method!=='POST'||!env.CHECK_BRIDGE_TOKEN||!equal(request.headers.get('authorization'),'Bearer '+env.CHECK_BRIDGE_TOKEN))
    return error('Нет доступа.',403);
  const db=env.DB,time=Date.now();
  let input;try{input=await body(request)}catch{return error('Некорректный запрос.')}
  if(input?.op==='poll'){
    if(Array.isArray(input.active)&&input.active.length<=500&&input.active.every(id=>typeof id==='string'&&checkId.test(id))){
      const active=JSON.stringify(input.active);
      const stale="SELECT id FROM web_checks WHERE state='active' AND missing_since>0 AND missing_since<?";
      await db.batch([
        db.prepare("UPDATE web_checks SET missing_since=0 WHERE state='active' AND missing_since>0 AND id IN (SELECT value FROM json_each(?))").bind(active),
        db.prepare("UPDATE web_checks SET missing_since=? WHERE state='active' AND missing_since=0 AND id NOT IN (SELECT value FROM json_each(?))").bind(time,active),
        db.prepare(`UPDATE server_checks SET active=0,ended=?,result='Связь прервана'
          WHERE active=1 AND id IN (SELECT 'fastfreeze-'||id FROM (${stale}))`).bind(time,time-30000),
        db.prepare(`UPDATE web_checks SET state='stopped',detail='Связь прервана' WHERE id IN (${stale})`).bind(time-30000),
      ]);
    }
    await db.batch([
      db.prepare("UPDATE web_check_jobs SET state='failed',detail='Сервер не подтвердил действие' WHERE (state='claimed' AND claimed<?) OR (state='queued' AND created<?)").bind(time-30000,time-30000),
      db.prepare("UPDATE web_checks SET state='failed',detail='Сервер не подтвердил вызов' WHERE state='queued' AND created<?").bind(time-30000),
      db.prepare('INSERT INTO web_check_bridge VALUES (1,?) ON CONFLICT(id) DO UPDATE SET seen=excluded.seen WHERE seen<excluded.seen-10000').bind(time),
    ]);
    const jobs=await db.prepare(`UPDATE web_check_jobs SET state='claimed',claimed=?
        WHERE id IN (SELECT j.id FROM web_check_jobs j JOIN web_checks c ON c.id=j.check_id
          JOIN moderators m ON m.id=c.staff_id WHERE j.state='queued' AND j.created>? AND c.state IN ('queued','active')
          AND m.position IN (?,?,?,?,?,?) ORDER BY j.id LIMIT 12)
        RETURNING id,check_id,kind,body`).bind(time,time-30000,...activeRanks).all();
    if(!jobs.results.length)return json({jobs:[]});
    const ids=[...new Set(jobs.results.map(job=>job.check_id))];
    const {results}=await db.prepare('SELECT * FROM web_checks WHERE id IN ('+ids.map(()=>'?').join(',')+')').bind(...ids).all();
    return json({jobs:jobs.results.sort((a,b)=>a.id-b.id).map(job=>({...job,body:JSON.parse(job.body),check:results.find(c=>c.id===job.check_id)}))});
  }
  if(input?.op==='sync'){
    const forwarded=new Request(new URL('/api/server/sync',request.url),{method:'POST',headers:{Authorization:'Bearer '+env.CHECK_BRIDGE_TOKEN},body:JSON.stringify({kind:input.kind,records:input.records})});
    return serverData(forwarded,{...env,SERVER_SYNC_TOKEN:env.CHECK_BRIDGE_TOKEN},null,new URL(forwarded.url));
  }
  const id=input?.id;
  if(!checkId.test(id))return error('Некорректная проверка.');
  if(input.op==='state'&&['active',...terminal].includes(input.state)){
    await db.prepare("UPDATE web_checks SET state=?,detail=? WHERE id=? AND state IN ('queued','active')")
      .bind(input.state,field(input.detail,300),id).run();
    return json({ok:true});
  }
  if(input.op==='job'&&Number.isSafeInteger(input.job)){
    await db.prepare("UPDATE web_check_jobs SET state=?,detail=? WHERE id=? AND check_id=? AND state='claimed'")
      .bind(input.ok===true?'done':'failed',field(input.detail,300),input.job,id).run();
    return json({ok:true});
  }
  if(input.op==='message'&&checkId.test(input.messageId)&&['player','moderator'].includes(input.side)&&field(input.message,500)){
    await db.prepare('INSERT OR IGNORE INTO web_check_messages (id,check_id,side,body,created) VALUES (?,?,?,?,?)')
      .bind(input.messageId,id,input.side,field(input.message,500),time).run();
    return json({ok:true});
  }
  return error('Некорректное событие.');
}
