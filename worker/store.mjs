import { staffPositions, canAssignPosition, canEditMember, canDiscipline, canManageManuals, isSanctionImmune } from './staff-positions.mjs';
import { hash, now, randomToken } from './security.mjs';

export class Store {
  constructor(db) { if (!db) throw new Error('DATABASE_UNAVAILABLE'); this.db = db; }
  async audit(actor, action, target = null) {
    await this.db.prepare('INSERT INTO auth_audit (id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)')
      .bind(crypto.randomUUID(), actor, action, target, now()).run();
  }
  async limit(key, max, seconds) {
    const window = Math.floor(now() / seconds);
    const id = await hash(`${key}:${window}`);
    const result = await this.db.prepare('INSERT INTO auth_rate_limits (key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts')
      .bind(id, (window + 1) * seconds).first();
    return result.attempts <= max;
  }
  async saveFlow(provider, browser, flow) {
    await this.db.prepare('INSERT INTO auth_flows (state_hash,browser_hash,provider,verifier,nonce,expires_at) VALUES (?,?,?,?,?,?)')
      .bind(await hash(flow.state), await hash(browser), provider, flow.verifier, flow.nonce, now() + 600).run();
  }
  async consumeFlow(provider, browser, state) {
    return this.db.prepare('DELETE FROM auth_flows WHERE state_hash=? AND browser_hash=? AND provider=? AND expires_at>? RETURNING verifier,nonce')
      .bind(await hash(state), await hash(browser), provider, now()).first();
  }
  async upsertUser(identity, config) {
    const column = identity.provider === 'vk' ? 'vk_id' : 'telegram_id';
    const moderator = await this.db.prepare(`SELECT id FROM moderators WHERE ${column}=?`).bind(identity.providerId).first();
    if (!moderator && await this.db.prepare(`SELECT id FROM former_moderators WHERE ${column}=? LIMIT 1`).bind(identity.providerId).first()) return {status:'blocked'};
    const allowed = !!moderator || config.staff[identity.provider].has(identity.providerId) || config.admins[identity.provider].has(identity.providerId);
    await this.db.prepare(`INSERT INTO auth_users (id,provider,subject,provider_id,display_name,username,picture,status,created_at,last_login_at)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(provider,subject) DO UPDATE SET
      display_name=excluded.display_name,username=excluded.username,picture=excluded.picture,last_login_at=excluded.last_login_at,
      status=CASE WHEN auth_users.status='pending' AND excluded.status='active' THEN 'active' ELSE auth_users.status END`)
      .bind(crypto.randomUUID(), identity.provider, identity.subject, identity.providerId, identity.displayName, identity.username || '', '', allowed ? 'active' : 'pending', now(), now()).run();
    return this.db.prepare('SELECT * FROM auth_users WHERE provider=? AND subject=?').bind(identity.provider, identity.subject).first();
  }
  async createSession(userId, oldToken) {
    const token = randomToken(), csrf = randomToken();
    const queries = [];
    if (oldToken) queries.push(this.db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await hash(oldToken)));
    queries.push(this.db.prepare('INSERT INTO auth_sessions (token_hash,user_id,csrf,created_at,expires_at) VALUES (?,?,?,?,?)')
      .bind(await hash(token), userId, csrf, now(), now() + 604800));
    await this.db.batch(queries);
    return { token, csrf };
  }
  async session(token) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return this.db.prepare(`SELECT u.*,s.csrf,s.token_hash,s.expires_at,m.nickname AS journal_nickname,m.position AS journal_position,m.staff_since AS journal_staff_since,m.profile_banner AS journal_profile_banner,m.id AS journal_moderator_id FROM auth_sessions s
      JOIN auth_users u ON u.id=s.user_id LEFT JOIN moderators m ON (u.provider='vk' AND u.provider_id=m.vk_id) OR (u.provider='telegram' AND u.provider_id=m.telegram_id) WHERE s.token_hash=? AND s.expires_at>?`)
      .bind(await hash(token), now()).first();
  }
  async logout(token) {
    if (token) await this.db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await hash(token)).run();
  }
  async cleanup() {
    await this.db.batch([
      this.db.prepare('DELETE FROM auth_flows WHERE expires_at<=?').bind(now()),
      this.db.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').bind(now()),
      this.db.prepare('DELETE FROM auth_rate_limits WHERE expires_at<=?').bind(now()),
    ]);
  }
  async activeStaff(search='') {
    const rows=(await this.db.prepare(`SELECT id,nickname,position,vk_id,real_name FROM moderators ORDER BY CASE position ${staffPositions.map((position,index)=>`WHEN '${position}' THEN ${index}`).join(' ')} ELSE 99 END, nickname COLLATE NOCASE`).all()).results;
    const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/\s+/g,' ').trim();
    const query=normalize(search);
    return rows.filter(row=>!query||normalize(row.nickname).includes(query)||normalize(row.real_name).includes(query)).map(({real_name,...row})=>row);
  }
  async moderators() {
    return (await this.db.prepare(`SELECT m.id,m.nickname,m.position,m.real_name,m.birth_date,m.vk_id,m.telegram_id,m.discord_id,m.appointment_date,m.staff_since,m.created_at FROM moderators m ORDER BY CASE m.position ${staffPositions.map((position,index)=>`WHEN '${position}' THEN ${index}`).join(' ')} ELSE 99 END, m.nickname COLLATE NOCASE`).all()).results;
  }
  async addModerator(actor, m) {
    const id=crypto.randomUUID();
    await this.db.batch([
      this.db.prepare('INSERT INTO moderators (id,nickname,position,real_name,birth_date,vk_id,telegram_id,created_at,created_by,appointment_date,staff_since,discord_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,m.nickname,m.position,m.realName,m.birthDate,m.vkId || null,m.telegramId || null,now(),actor.id,m.appointmentDate===undefined?new Date().toISOString().slice(0,10):(m.appointmentDate||null),m.staffSince||null,m.discordId||null),
      this.db.prepare("UPDATE auth_users SET status='active' WHERE status IN ('pending','removed') AND ((provider='vk' AND provider_id=?) OR (provider='telegram' AND provider_id=?))").bind(m.vkId || null,m.telegramId || null),
      this.db.prepare('INSERT INTO auth_audit (id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),actor.id,'moderator_added',id,now())
    ]);
  }
  async moderator(id) { return this.db.prepare('SELECT * FROM moderators WHERE id=?').bind(id).first(); }
  positionDiscordActor(actor,id) {
    return this.db.prepare(`UPDATE discord_role_jobs SET changed_by=?
      WHERE discord_id=(SELECT discord_id FROM moderators WHERE id=?)
        AND reason='Должность изменена в журнале' AND changes()>0`)
      .bind(actor.journal_nickname||actor.display_name,id);
  }
  async editModerator(actor,id,m) {
    const old=await this.moderator(id); if(!old) return 'missing';
    if(!canEditMember(actor.journal_position,old.position))return 'rank';
    if(old.position!==m.position&&(!canAssignPosition(actor.journal_position,old.position)||!canAssignPosition(actor.journal_position,m.position)))return 'rank';
    const removed=[['vk',old.vk_id,m.vkId],['telegram',old.telegram_id,m.telegramId]].filter(([,before,after])=>before && before!==after);
    if(removed.some(([p,before])=>(actor.provider===p&&actor.provider_id===before))) return 'protected';
    const statements=[];
    for(const [provider,providerId] of removed){
      statements.push(this.db.prepare("DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM auth_users WHERE provider=? AND provider_id=?)").bind(provider,providerId));
      statements.push(this.db.prepare("UPDATE auth_users SET status=CASE WHEN status='active' THEN 'pending' ELSE status END WHERE provider=? AND provider_id=?").bind(provider,providerId));
    }
    statements.push(this.db.prepare('UPDATE moderators SET nickname=?,position=?,real_name=?,birth_date=?,vk_id=?,telegram_id=?,appointment_date=?,staff_since=?,discord_id=? WHERE id=?').bind(m.nickname,m.position,m.realName,m.birthDate,m.vkId||null,m.telegramId||null,m.appointmentDate===undefined?(m.position===old.position?old.appointment_date:new Date().toISOString().slice(0,10)):(m.appointmentDate||null),m.staffSince===undefined?old.staff_since:(m.staffSince||null),m.discordId===undefined?old.discord_id:(m.discordId||null),id));
    if(old.position!==m.position)statements.push(this.positionDiscordActor(actor,id));
    statements.push(this.db.prepare("UPDATE auth_users SET status=CASE WHEN status='pending' THEN 'active' ELSE status END WHERE (provider='vk' AND provider_id=?) OR (provider='telegram' AND provider_id=?)").bind(m.vkId||null,m.telegramId||null));
    if(old.position!==m.position) statements.push(this.db.prepare('INSERT INTO journal_notifications (id,moderator_id,message,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(),id,`Должность изменена: ${old.position} → ${m.position}. Изменил: ${actor.journal_nickname||actor.display_name}.`,now()));
    statements.push(this.db.prepare('INSERT INTO auth_audit (id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),actor.id,'moderator_edited',id,now()));
    await this.db.batch(statements); return 'ok';
  }
  async changeStaffPosition(actor,id,position) {
    const member=await this.moderator(id);
    if(!member)return 'missing';
    if(!canAssignPosition(actor.journal_position,position)||!canAssignPosition(actor.journal_position,member.position))return 'rank';
    if(member.position===position)return 'ok';
    const at=now(), date=new Date().toISOString().slice(0,10);
    const [result]=await this.db.batch([
      this.db.prepare('UPDATE moderators SET position=?,appointment_date=? WHERE id=? AND position=?').bind(position,date,id,member.position),
      this.db.prepare(`INSERT INTO journal_notifications (id,moderator_id,message,created_at)
        SELECT ?,?,?,? WHERE changes()>0`).bind(crypto.randomUUID(),id,`Должность изменена: ${member.position} → ${position}. Изменил: ${actor.journal_nickname||actor.display_name}.`,at),
      this.db.prepare(`INSERT INTO auth_audit (id,actor_id,action,target_id,created_at)
        SELECT ?,?,'moderator_edited',?,? WHERE changes()>0`).bind(crypto.randomUUID(),actor.id,id,at),
      this.positionDiscordActor(actor,id),
    ]);
    return (result.meta?.changes??result.changes)>0?'ok':'conflict';
  }
  async formerModerators() { return (await this.db.prepare('SELECT id,nickname,position,real_name,birth_date,appointment_date,staff_since,vk_id,telegram_id,joined_at,removed_at,removed_by_name,removal_reason FROM former_moderators WHERE restored_at IS NULL ORDER BY removed_at DESC, nickname COLLATE NOCASE').all()).results; }
  async deleteFormerRecord(actor,id) {
    const [result]=await this.db.batch([
      this.db.prepare('DELETE FROM former_moderators WHERE id=? AND restored_at IS NULL').bind(id),
      this.db.prepare(`INSERT INTO auth_audit (id,actor_id,action,target_id,created_at)
        SELECT ?,?,'former_record_deleted',?,? WHERE changes()>0`).bind(crypto.randomUUID(),actor.id,id,now()),
    ]);
    return (result.meta?.changes??result.changes)>0;
  }
  async removeModerator(actor,id,reason) {
    const m=await this.moderator(id);if(!m)return {status:'missing'};
    if(!canAssignPosition(actor.journal_position,m.position))return {status:'rank'};
    if ((actor.provider==='vk'&&actor.provider_id===m.vk_id)||(actor.provider==='telegram'&&actor.provider_id===m.telegram_id)) return {status:'protected'};
    const archiveId=crypto.randomUUID(),removedAt=now(),actorName=actor.journal_nickname||actor.display_name||'Администратор';
    const result=await this.db.batch([
      this.db.prepare(`INSERT INTO former_moderators (id,source_id,nickname,position,real_name,birth_date,appointment_date,staff_since,vk_id,telegram_id,joined_at,removed_at,removed_by,removed_by_name,removal_reason,profile_banner,discord_id) SELECT ?,m.id,m.nickname,m.position,m.real_name,m.birth_date,m.appointment_date,m.staff_since,m.vk_id,m.telegram_id,m.created_at,?,?,?,?,m.profile_banner,m.discord_id FROM moderators m WHERE m.id=?`).bind(archiveId,removedAt,actor.id,actorName,reason,id),
      this.db.prepare("DELETE FROM auth_sessions WHERE user_id IN (SELECT u.id FROM auth_users u JOIN moderators m ON ((u.provider='vk' AND u.provider_id=m.vk_id) OR (u.provider='telegram' AND u.provider_id=m.telegram_id)) WHERE m.id=?)").bind(id),
      this.db.prepare("UPDATE auth_users SET status=CASE WHEN status='blocked' THEN 'blocked' ELSE 'removed' END WHERE EXISTS (SELECT 1 FROM moderators m WHERE m.id=? AND ((auth_users.provider='vk' AND auth_users.provider_id=m.vk_id) OR (auth_users.provider='telegram' AND auth_users.provider_id=m.telegram_id)))").bind(id),
      this.db.prepare('DELETE FROM moderators WHERE id=?').bind(id),
      this.db.prepare('INSERT INTO auth_audit (id,actor_id,action,target_id,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM former_moderators WHERE id=?)').bind(crypto.randomUUID(),actor.id,'moderator_removed',id,removedAt,archiveId)
    ]);
    if((result[0].meta?.changes??result[0].changes)===0)return {status:'missing'};
    return {status:'ok',nickname:m.nickname,position:m.position,removedBy:actorName};
  }
  async restoreModerator(actor,id) {
    const prior=await this.db.prepare('SELECT * FROM former_moderators WHERE id=? AND restored_at IS NULL').bind(id).first();
    if(!prior)return 'missing';
    if(!canAssignPosition(actor.journal_position,prior.position))return 'rank';
    const newId=crypto.randomUUID(),at=now();
    const result=await this.db.batch([
      this.db.prepare(`INSERT INTO moderators (id,nickname,position,real_name,birth_date,appointment_date,staff_since,vk_id,telegram_id,created_at,created_by,profile_banner,discord_id) SELECT ?,nickname,position,real_name,birth_date,appointment_date,staff_since,vk_id,telegram_id,joined_at,?,profile_banner,discord_id FROM former_moderators WHERE id=? AND restored_at IS NULL`).bind(newId,actor.id,id),
      this.db.prepare("UPDATE auth_users SET status=CASE WHEN status='removed' THEN 'active' ELSE status END WHERE EXISTS (SELECT 1 FROM moderators m WHERE m.id=? AND ((auth_users.provider='vk' AND auth_users.provider_id=m.vk_id) OR (auth_users.provider='telegram' AND auth_users.provider_id=m.telegram_id)))").bind(newId),
      this.db.prepare('UPDATE staff_sanctions SET moderator_id=? WHERE moderator_id=? AND EXISTS (SELECT 1 FROM moderators WHERE id=?)').bind(newId,prior.source_id,newId),
      this.db.prepare('UPDATE staff_journal_controls SET moderator_id=? WHERE moderator_id=? AND EXISTS (SELECT 1 FROM moderators WHERE id=?)').bind(newId,prior.source_id,newId),
      this.db.prepare('UPDATE former_moderators SET restored_at=?,restored_by=? WHERE id=? AND restored_at IS NULL AND EXISTS (SELECT 1 FROM moderators WHERE id=?)').bind(at,actor.id,id,newId),
      this.db.prepare('INSERT INTO auth_audit (id,actor_id,action,target_id,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM moderators WHERE id=?)').bind(crypto.randomUUID(),actor.id,'moderator_restored',id,at,newId),
    ]);
    return (result[0]?.meta?.changes??result[0]?.changes)===0?'missing':'ok';
  }
  async deleteManual(actor,id) {
    const found=await this.manual(id,actor);if(!found)return false;
    await this.db.batch([
      this.db.prepare('DELETE FROM manual_image_chunks WHERE image_id IN (SELECT id FROM manual_images WHERE manual_id=?)').bind(id),
      this.db.prepare('DELETE FROM manual_images WHERE manual_id=?').bind(id),
      this.db.prepare('DELETE FROM manuals WHERE id=?').bind(id),
      this.db.prepare('INSERT INTO auth_audit (id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),actor.id,'manual_deleted',id,now()),
    ]);return true;
  }
  manualQuery(columns) { return `SELECT ${columns}, COALESCE(st.nickname,u.display_name,'Неизвестен') AS author_name FROM manuals m LEFT JOIN auth_users u ON u.id=m.author_id LEFT JOIN moderators st ON (u.provider='vk' AND u.provider_id=st.vk_id) OR (u.provider='telegram' AND u.provider_id=st.telegram_id) WHERE (m.allowed_positions IS NULL OR ?=1 OR EXISTS (SELECT 1 FROM json_each(m.allowed_positions) WHERE value=?))`; }
  manualResult(row) { return row ? {...row,allowed_positions:row.allowed_positions===null?null:JSON.parse(row.allowed_positions)} : null; }
  async manuals(actor) {
    const sql=this.manualQuery('m.id,m.title,m.description,m.allowed_positions,m.created_at,m.updated_at')+' ORDER BY m.updated_at DESC';
    return (await this.db.prepare(sql).bind(canManageManuals(actor.journal_position)?1:0,actor.journal_position||'').all()).results.map(row=>this.manualResult(row));
  }
  async manual(id,actor) {
    return this.manualResult(await this.db.prepare(this.manualQuery('m.*')+' AND m.id=?').bind(canManageManuals(actor.journal_position)?1:0,actor.journal_position||'',id).first());
  }
  async startManualImage(actor,type,size) {
    const id=crypto.randomUUID(),count=Math.ceil(size/524288),expiry=now()-604800;
    await this.db.batch([
      this.db.prepare('DELETE FROM manual_image_chunks WHERE image_id IN (SELECT id FROM manual_images WHERE manual_id IS NULL AND created_at<?)').bind(expiry),
      this.db.prepare('DELETE FROM manual_images WHERE manual_id IS NULL AND created_at<?').bind(expiry),
      this.db.prepare("INSERT INTO manual_images (id,manual_id,media_type,data,owner_id,status,created_at,file_size,chunk_count) VALUES (?,NULL,?,'',?,'uploading',?,?,?)").bind(id,type,actor.id,now(),size,count),
    ]);return {id,chunkCount:count};
  }
  async putManualImageChunk(actor,id,index,data) {
    const image=await this.db.prepare("SELECT * FROM manual_images WHERE id=? AND owner_id=? AND manual_id IS NULL AND status='uploading'").bind(id,actor.id).first();
    if(!image||!Number.isSafeInteger(index)||index<0||index>=image.chunk_count||typeof data!=='string'||data.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))return false;
    const size=Math.floor(data.length*3/4)-(data.endsWith('==')?2:data.endsWith('=')?1:0),expected=index===image.chunk_count-1?image.file_size-524288*index:524288;
    if(size!==expected)return false;
    await this.db.prepare('INSERT INTO manual_image_chunks (id,image_id,chunk_index,data,byte_length) VALUES (?,?,?,?,?) ON CONFLICT(image_id,chunk_index) DO UPDATE SET data=excluded.data,byte_length=excluded.byte_length').bind(crypto.randomUUID(),id,index,data,size).run();return true;
  }
  async finishManualImage(actor,id) {
    const row=await this.db.prepare("SELECT i.id,i.chunk_count,i.file_size,COUNT(c.id) AS actual_count,COALESCE(SUM(c.byte_length),0) AS actual_size FROM manual_images i LEFT JOIN manual_image_chunks c ON c.image_id=i.id WHERE i.id=? AND i.owner_id=? AND i.manual_id IS NULL AND i.status='uploading' GROUP BY i.id").bind(id,actor.id).first();
    if(!row||row.actual_count!==row.chunk_count||row.actual_size!==row.file_size)return false;
    await this.db.prepare("UPDATE manual_images SET status='ready' WHERE id=? AND owner_id=? AND status='uploading'").bind(id,actor.id).run();return true;
  }
  async manualImage(id,actor) {
    const image=await this.db.prepare("SELECT id,manual_id,media_type,owner_id,status,file_size,chunk_count FROM manual_images WHERE id=? AND status='ready'").bind(id).first();
    if(!image)return null;if(!image.manual_id)return image.owner_id===actor.id&&canManageManuals(actor.journal_position)?image:null;
    return await this.manual(image.manual_id,actor)?image:null;
  }
  async saveManual(actor,manual,id) {
    const existing=id?await this.manual(id,actor):null;if(id&&!existing)return false;
    const timestamp=now();id ||= crypto.randomUUID();
    const positions=manual.allowedPositions===undefined?(existing?.allowed_positions??null):manual.allowedPositions;
    const newImages=[];
    const formatted=manual.content.startsWith('<!--jevox-manual-v2-->');
    const inlineImage=formatted
      ? /src="data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})"/g
      : /!\[Фото\]\(data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})\)/g;
    const content=manual.content.replace(inlineImage,(_,type,data)=>{
      const bytes=Math.floor(data.length*3/4)-(data.endsWith('==')?2:data.endsWith('=')?1:0);
      if(data.length%4!==0||bytes>1300000||bytes<1)throw new Error('IMAGE_SIZE');
      const imageId=crypto.randomUUID();
      newImages.push({id:imageId,type:'image/'+type,data,bytes});
      const url='/api/manual-images/'+imageId;
      return formatted?'src="'+url+'"':'![Фото]('+url+')';
    });
    if(new TextEncoder().encode(content).byteLength>1800000)throw new Error('MANUAL_SIZE');
    const imageReference=formatted
      ? /src="\/api\/manual-images\/([a-f0-9-]{36})"/g
      : /!\[Фото\]\(\/api\/manual-images\/([a-f0-9-]{36})\)/g;
    const refs=[...new Set([...content.matchAll(imageReference)].map(match=>match[1]))];
    const newIds=new Set(newImages.map(x=>x.id));
    const available=(await this.db.prepare("SELECT id,manual_id,owner_id,status FROM manual_images WHERE manual_id=? OR (owner_id=? AND manual_id IS NULL)").bind(id,actor.id).all()).results;
    if(refs.some(ref=>!newIds.has(ref)&&!available.some(image=>image.id===ref&&image.status==='ready')))throw new Error('IMAGE_REFERENCE');
    const operations=[this.db.prepare('INSERT INTO manuals (id,title,description,content,author_id,created_at,updated_at,allowed_positions) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,content=excluded.content,updated_at=excluded.updated_at,allowed_positions=excluded.allowed_positions').bind(id,manual.title,manual.description,content,actor.id,timestamp,timestamp,positions===null?null:JSON.stringify(positions))];
    for(const image of available)if(image.manual_id===id&&!refs.includes(image.id)){operations.push(this.db.prepare('DELETE FROM manual_image_chunks WHERE image_id=?').bind(image.id),this.db.prepare('DELETE FROM manual_images WHERE id=? AND manual_id=?').bind(image.id,id));}
    for(const image of available)if(image.manual_id===null&&refs.includes(image.id))operations.push(this.db.prepare('UPDATE manual_images SET manual_id=? WHERE id=? AND owner_id=? AND manual_id IS NULL').bind(id,image.id,actor.id));
    for(const image of newImages){operations.push(this.db.prepare("INSERT INTO manual_images (id,manual_id,media_type,data,owner_id,status,created_at,file_size,chunk_count) VALUES (?,?,?,'',?,'ready',?,?,1)").bind(image.id,id,image.type,actor.id,timestamp,image.bytes),this.db.prepare('INSERT INTO manual_image_chunks (id,image_id,chunk_index,data,byte_length) VALUES (?,?,0,?,?)').bind(crypto.randomUUID(),image.id,image.data,image.bytes));}
    operations.push(this.db.prepare('INSERT INTO auth_audit (id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),actor.id,'manual_saved',id,timestamp));
    await this.db.batch(operations);return true;
  }
  async setProfileBanner(actor, banner) {
    const saved = await this.db.prepare(`UPDATE moderators SET profile_banner=?
      WHERE id=? AND ((?='vk' AND vk_id=?) OR (?='telegram' AND telegram_id=?))
      AND (? IS NULL OR ?!='blood' OR position='Владелец') RETURNING id`)
      .bind(banner,actor.journal_moderator_id,actor.provider,actor.provider_id,actor.provider,actor.provider_id,banner,banner).first();
    return !!saved;
  }
  async personalSanctions(actor) {
    if(!actor.journal_moderator_id||isSanctionImmune(actor.journal_position))return null;
    const row=await this.db.prepare("SELECT SUM(CASE WHEN type='warning' THEN 1 ELSE 0 END) AS warnings,SUM(CASE WHEN type='reprimand' THEN 1 ELSE 0 END) AS reprimands FROM staff_sanctions WHERE moderator_id=? AND revoked_at IS NULL").bind(actor.journal_moderator_id).first();
    return {warnings:Number(row?.warnings||0),reprimands:Number(row?.reprimands||0)};
  }
  async personalProfile(actor) {
    const staffId=actor.journal_moderator_id;
    if(!staffId)return {linked:false,sanctions:[],positions:[]};
    const [sanctions,positions]=await Promise.all([
      isSanctionImmune(actor.journal_position) ? {results:[]} : this.db.prepare(`SELECT id,type,reason,issued_by_name,issued_at,revoked_at
        FROM staff_sanctions WHERE moderator_id=? ORDER BY issued_at DESC,id DESC`).bind(staffId).all(),
      this.db.prepare(`SELECT id,message,created_at FROM journal_notifications
        WHERE moderator_id=? AND message LIKE ? AND position_history_hidden_at IS NULL ORDER BY created_at DESC,id DESC`).bind(staffId,'Должность изменена: %').all(),
    ]);
    return {linked:true,staffId,sanctions:sanctions.results,positions:positions.results};
  }
  async updateStaffJournal(actor,id,action,options){
    const audit=this.db.prepare(`INSERT INTO auth_audit (id,actor_id,action,target_id,created_at)
      SELECT ?,?,?,id,? FROM moderators WHERE id=?`).bind(crypto.randomUUID(),actor.id,action,now(),id);
    let change;
    if(action==='staff_activity_adjusted'){
      change=this.db.prepare(`
        INSERT INTO staff_journal_controls (moderator_id,checks_delta,punishments_delta)
        SELECT m.id,
          ?-(SELECT COUNT(*) FROM server_checks WHERE moderator=m.nickname COLLATE NOCASE AND started>COALESCE(c.activity_reset_at,-1)),
          ?-(SELECT COUNT(*) FROM server_punishments WHERE moderator=m.nickname COLLATE NOCASE AND started>COALESCE(c.activity_reset_at,-1))
        FROM moderators m LEFT JOIN staff_journal_controls c ON c.moderator_id=m.id WHERE m.id=?
        ON CONFLICT(moderator_id) DO UPDATE SET checks_delta=excluded.checks_delta,punishments_delta=excluded.punishments_delta
      `).bind(options.checks,options.punishments,id);
    }else if(action==='staff_activity_cleared'){
      change=this.db.prepare(`
        INSERT INTO staff_journal_controls (moderator_id,activity_reset_at,checks_delta,punishments_delta)
        SELECT id,?,NULL,NULL FROM moderators WHERE id=?
        ON CONFLICT(moderator_id) DO UPDATE SET activity_reset_at=excluded.activity_reset_at,checks_delta=NULL,punishments_delta=NULL
      `).bind(Date.now(),id);
    }else if(action==='staff_logs_cleared'){
      change=this.db.prepare(`
        UPDATE auth_audit SET hidden_from_staff_logs=1
        WHERE created_at BETWEEN ? AND ? AND actor_id IN (
          SELECT u.id FROM auth_users u JOIN moderators m
          ON (u.provider='vk' AND u.provider_id=m.vk_id) OR (u.provider='telegram' AND u.provider_id=m.telegram_id)
          WHERE m.id=?
        )
      `).bind(options.from,options.to,id);
    }else{
      change=this.db.prepare(`UPDATE journal_notifications SET position_history_hidden_at=?
        WHERE moderator_id=? AND position_history_hidden_at IS NULL
          AND created_at BETWEEN ? AND ?
          AND message LIKE 'Должность изменена: %' AND EXISTS (SELECT 1 FROM moderators WHERE id=?)`).bind(now(),id,options.from,options.to,id);
    }
    const [,record]=await this.db.batch([change,audit]);
    return (record.meta?.changes??record.changes)>0;
  }
  async staffSanctions() { return (await this.db.prepare('SELECT s.*,COALESCE(m.nickname,s.moderator_name) AS current_nickname FROM staff_sanctions s LEFT JOIN moderators m ON m.id=s.moderator_id WHERE m.position IS NULL OR m.position NOT IN (?,?,?) ORDER BY s.issued_at DESC,s.id DESC').bind(...staffPositions.slice(0,3)).all()).results; }
  async issueStaffSanction(actor,id,type,reason) {
    const member=await this.moderator(id);
    if(!member)return 'missing';
    if(isSanctionImmune(member.position))return 'immune';
    if(!canDiscipline(actor.journal_position,member.position))return 'rank';
    const sanctionId=crypto.randomUUID(),at=now(),name=actor.journal_nickname||actor.display_name||'Администратор',kind=type==='warning'?'Предупреждение':'Выговор';
    const result=await this.db.batch([
      this.db.prepare('INSERT INTO staff_sanctions (id,moderator_id,moderator_name,type,reason,issued_by,issued_by_name,issued_at) SELECT ?,id,nickname,?,?,?,?,? FROM moderators WHERE id=? AND position=?').bind(sanctionId,type,reason,actor.id,name,at,id,member.position),
      this.db.prepare('INSERT INTO journal_notifications (id,moderator_id,message,created_at) SELECT ?,moderator_id,?,? FROM staff_sanctions WHERE id=?').bind(crypto.randomUUID(),`${kind}: ${reason}. Выдал: ${name}.`,at,sanctionId),
      this.db.prepare('INSERT INTO auth_audit (id,actor_id,action,target_id,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM staff_sanctions WHERE id=?)').bind(crypto.randomUUID(),actor.id,'staff_sanction_issued',sanctionId,at,sanctionId),
    ]);
    return (result[0]?.meta?.changes??result[0]?.changes)>0?'ok':'conflict';
  }
  async revokeStaffSanction(actor,id) {
    const allowed=staffPositions.filter(position=>canDiscipline(actor.journal_position,position));
    if(!allowed.length)return false;
    const at=now(),name=actor.journal_nickname||actor.display_name||'Администратор';
    const auditId=crypto.randomUUID();
    const [result]=await this.db.batch([
      this.db.prepare(`UPDATE staff_sanctions SET revoked_at=?,revoked_by=?,revoked_by_name=? WHERE id=? AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM moderators WHERE id=staff_sanctions.moderator_id AND position IN (${allowed.map(()=>'?').join(',')}))`).bind(at,actor.id,name,id,...allowed),
      this.db.prepare(`INSERT INTO auth_audit (id,actor_id,action,target_id,created_at)
        SELECT ?,?,'staff_sanction_revoked',?,? WHERE changes()>0`).bind(auditId,actor.id,id,at),
      this.db.prepare(`INSERT INTO journal_notifications (id,moderator_id,message,created_at)
        SELECT ?,moderator_id,(CASE WHEN type='warning' THEN 'Предупреждение снято' ELSE 'Выговор снят' END)||?,?
        FROM staff_sanctions WHERE id=? AND EXISTS(SELECT 1 FROM auth_audit WHERE id=?)`)
        .bind(crypto.randomUUID(),'. Снял: '+name+'.',at,id,auditId)
    ]);
    return (result.meta?.changes??result.changes)>0;
  }
  staffKey(actor) { return actor.journal_moderator_id?'staff:'+actor.journal_moderator_id:'user:'+actor.id; }
  async notifications(actor) { if(!actor.journal_moderator_id)return [];return (await this.db.prepare('SELECT id,message,created_at,read_at FROM journal_notifications WHERE moderator_id=? AND cleared_at IS NULL ORDER BY created_at DESC LIMIT 100').bind(actor.journal_moderator_id).all()).results; }
  async readNotifications(actor) { if(actor.journal_moderator_id) await this.db.prepare('UPDATE journal_notifications SET read_at=? WHERE moderator_id=? AND read_at IS NULL AND cleared_at IS NULL').bind(now(),actor.journal_moderator_id).run(); }
  async clearNotifications(actor) {
    if(actor.journal_moderator_id)await this.db.prepare('UPDATE journal_notifications SET cleared_at=? WHERE moderator_id=? AND cleared_at IS NULL').bind(now(),actor.journal_moderator_id).run();
  }
}
