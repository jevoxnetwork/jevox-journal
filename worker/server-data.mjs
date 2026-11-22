import { canEditRoster } from './staff-positions.mjs';
import { equal, json, now } from './security.mjs';
const fields=['id','player','player_uuid','moderator','moderator_uuid','reason','started','ended','result','type','active','removed_by'];
const moscowOffset=3*60*60*1000;
export async function serverData(request,env,session,url) {
 const db=env.DB,path=url.pathname;
 if(path==='/api/server/sync') {
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  if(!env.SERVER_SYNC_TOKEN||!equal(request.headers.get('authorization'), 'Bearer '+env.SERVER_SYNC_TOKEN))return json({error:'Unauthorized'},401);
  const raw=await request.text();if(raw.length>500000)return json({error:'Too large'},413);
  let data;try{data=JSON.parse(raw)}catch{return json({error:'Invalid JSON'},400)}
  if(!['checks','punishments'].includes(data.kind)||!Array.isArray(data.records)||data.records.length>100)return json({error:'Invalid batch'},400);
  const queries=[];
  for(const row of data.records){
   if(!row||fields.some(k=>row[k]!==undefined&&(typeof row[k]!=='string'&&typeof row[k]!=='number'))||typeof row.id!=='string'||row.id.length>150||typeof row.player!=='string'||row.player.length>100||typeof row.moderator!=='string'||row.moderator.length>100||typeof row.reason!=='string'||row.reason.length>5000||!Number.isSafeInteger(row.started)||row.started<0||!Number.isSafeInteger(row.ended)||row.ended<0)return json({error:'Invalid record'},400);
   const values=fields.map(k=>row[k]??(['started','ended','active'].includes(k)?0:''));
   queries.push(db.prepare(`INSERT INTO server_${data.kind} (${fields.join(',')}) SELECT ${fields.map(()=>'?').join(',')} WHERE ?>COALESCE((SELECT cutoff FROM server_retention WHERE kind=?),-1) ON CONFLICT(id) DO UPDATE SET ${fields.slice(1).map(k=>k+'=excluded.'+k).join(',')}${data.kind==='checks'?' WHERE excluded.ended>=server_checks.ended':''}`).bind(...values,row.started,data.kind));
  }
  queries.push(db.prepare('INSERT INTO server_sync (kind,updated_at) VALUES (?,?) ON CONFLICT(kind) DO UPDATE SET updated_at=excluded.updated_at').bind(data.kind,now()));
  await db.batch(queries);return json({ok:true,count:data.records.length});
 }
 if(!session||session.status!=='active')return json({error:'Нет доступа.'},403);
 if(request.method!=='GET')return json({error:'Method not allowed'},405);
 if(path==='/api/server/summary')return json(await staffActivity(db,session.journal_nickname,session.journal_moderator_id));
 if(path==='/api/server/leaderboard')return json(await staffLeaderboard(db,url.searchParams.get('period')==='month'));
 const sync=(await db.prepare('SELECT * FROM server_sync').all()).results;
 const staffChecks=path==='/api/server/staff-checks';
 const kind=staffChecks||path.endsWith('/checks')?'checks':'punishments',params=url.searchParams;
 if(staffChecks&&!canEditRoster(session.journal_position))return json({error:'Нет доступа.'},403);
 const filters=[],args=[];
 const player=(params.get('player')||'').trim();
 if(kind==='checks'){
  if(staffChecks){
   const moderator=(params.get('moderator')||'').trim();
   if(moderator.length>100)return json({error:'Слишком длинный запрос.'},400);
   if(moderator){filters.push('instr(lower(moderator),lower(?))>0');args.push(moderator)}
  }else{
   if(!session.journal_nickname)return json({items:[],total:0,page:1,pages:0,sync});
   filters.push('moderator=? COLLATE NOCASE','started>COALESCE((SELECT activity_reset_at FROM staff_journal_controls WHERE moderator_id=?),-1)');
   args.push(session.journal_nickname,session.journal_moderator_id??null);
  }
  if(player.length>100)return json({error:'Слишком длинный запрос.'},400);
  if(player){filters.push('instr(lower(player),lower(?))>0');args.push(player)}
  for(const [key,op,offset] of [['from','>=',0],['to','<',86400000]]){
    const date=params.get(key);
    if(!date)continue;
    const start=Date.parse(date+'T00:00:00+03:00');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(start)||new Date(start+10800000).toISOString().slice(0,10)!==date)
      return json({error:'Укажите корректную дату.'},400);
    filters.push('started'+op+'?');args.push(start+offset);
  }
 }else{
  // There is no all-punishments listing or partial-name lookup.
  if(!player)return json({items:[],total:0,page:1,pages:0,sync,requiresPlayer:true});
  if(!/^[A-Za-z0-9_]{3,16}$/.test(player))return json({error:'Укажите полный ник игрока.'},400);
  filters.push('player=? COLLATE NOCASE');args.push(player);
 }
 if(kind==='punishments'&&params.get('type')){if(!['ban','mute','warn','kick'].includes(params.get('type')))return json({error:'Неверный тип'},400);filters.push('type=?');args.push(params.get('type'))}
 const where=filters.length?' WHERE '+filters.join(' AND '):'';
 const page=Math.max(1,Math.min(100000,parseInt(params.get('page')||'1')||1));
 const total=(await db.prepare(`SELECT COUNT(*) AS n FROM server_${kind}`+where).bind(...args).first()).n;
 const columns=kind==='checks'?`${fields.filter(field=>field!=='reason').join(',')}, (SELECT p.reason FROM server_punishments p WHERE p.type='ban' AND server_checks.player_uuid<>'' AND p.player_uuid=server_checks.player_uuid AND p.started>=server_checks.started AND p.started<=CASE WHEN server_checks.ended=0 THEN 9223372036854775807 ELSE server_checks.ended+5000 END ORDER BY p.started LIMIT 1) AS ban_reason`:'*';
 const items=(await db.prepare(`SELECT ${columns} FROM server_${kind}`+where+' ORDER BY started DESC,id DESC LIMIT 30 OFFSET ?').bind(...args,(page-1)*30).all()).results;
 return json({items,total,page,pages:Math.ceil(total/30),sync});
}

async function staffLeaderboard(db,monthly) {
  const now=Date.now();
  const shifted=new Date(now+moscowOffset);
  const start=monthly?Date.UTC(shifted.getUTCFullYear(),shifted.getUTCMonth(),1)-moscowOffset:0;
  const [staff,sync]=await Promise.all([
    db.prepare(`
      WITH checks AS (
        SELECT lower(s.moderator) AS nickname, COUNT(*) AS total
        FROM server_checks s JOIN moderators m ON m.nickname=s.moderator COLLATE NOCASE
        LEFT JOIN staff_journal_controls a ON a.moderator_id=m.id
        WHERE s.started>COALESCE(a.activity_reset_at,-1) AND (?1=0 OR s.started BETWEEN ?1 AND ?2) GROUP BY lower(s.moderator)
      ), punishments AS (
        SELECT lower(s.moderator) AS nickname, COUNT(*) AS total
        FROM server_punishments s JOIN moderators m ON m.nickname=s.moderator COLLATE NOCASE
        LEFT JOIN staff_journal_controls a ON a.moderator_id=m.id
        WHERE s.started>COALESCE(a.activity_reset_at,-1) AND (?1=0 OR s.started BETWEEN ?1 AND ?2) GROUP BY lower(s.moderator)
      )
      SELECT m.id,m.nickname,m.position,
        MAX(0,COALESCE(c.total,0)+COALESCE(a.checks_delta,0)) AS checks,
        MAX(0,COALESCE(p.total,0)+COALESCE(a.punishments_delta,0)) AS punishments
      FROM moderators m
      LEFT JOIN checks c ON c.nickname=lower(m.nickname)
      LEFT JOIN punishments p ON p.nickname=lower(m.nickname)
      LEFT JOIN staff_journal_controls a ON ?1=0 AND a.moderator_id=m.id
      ORDER BY m.nickname COLLATE NOCASE,m.id
    `).bind(start,now).all(),
    db.prepare("SELECT kind FROM server_sync WHERE kind IN ('checks','punishments')").all(),
  ]);
  return {staff:staff.results,synced:sync.results.map(source=>source.kind)};
}

export async function staffActivity(db,name,moderatorId) {
  const sync=(await db.prepare('SELECT * FROM server_sync').all()).results;
  if(!name)return {checks:0,today:0,punishments:0,punishmentsToday:0,banMuteToday:0,banMuteTotal:0,sync,linked:false};
  const currentTime=Date.now();
  const dayLength=24*60*60*1000;
  const startOfDay=Math.floor((currentTime+moscowOffset)/dayLength)*dayLength-moscowOffset;
  const adjustment=moderatorId?await db.prepare('SELECT checks_delta,punishments_delta,activity_reset_at FROM staff_journal_controls WHERE moderator_id=?').bind(moderatorId).first():null;
  const resetAt=adjustment?.activity_reset_at??-1;
  const checks=await db.prepare('SELECT COUNT(*) AS total,COUNT(CASE WHEN started BETWEEN ? AND ? THEN 1 END) AS today FROM server_checks WHERE moderator=? COLLATE NOCASE AND started>?').bind(startOfDay,currentTime,name,resetAt).first();
  const punishments=await db.prepare(`
    SELECT COUNT(*) AS total,
      COUNT(CASE WHEN started BETWEEN ?1 AND ?2 THEN 1 END) AS today,
      COUNT(CASE WHEN type IN ('ban','mute') THEN 1 END) AS ban_mute_total,
      COUNT(CASE WHEN type IN ('ban','mute') AND started BETWEEN ?1 AND ?2 THEN 1 END) AS ban_mute_today
    FROM server_punishments
    WHERE moderator=? COLLATE NOCASE AND started>?
  `).bind(startOfDay,currentTime,name,resetAt).first();
  const adjusted=[];
  if(adjustment?.checks_delta!=null)adjusted.push('checks');
  if(adjustment?.punishments_delta!=null)adjusted.push('punishments');
  return {
    checks:Math.max(0,checks.total+(adjustment?.checks_delta??0)),
    today:checks.today,
    punishments:Math.max(0,punishments.total+(adjustment?.punishments_delta??0)),
    punishmentsToday:punishments.today,
    banMuteToday:punishments.ban_mute_today,
    banMuteTotal:punishments.ban_mute_total,
    sync,
    adjusted,
    linked:true,
  };
}
