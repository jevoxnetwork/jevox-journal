import { staffPositions, canAssignPosition, canDeleteFormerRecord, canEditRoster, canManageManuals, canViewStaff, hasStaffRank } from './staff-positions.mjs';
import { canUseBanner, isProfileBanner } from './profile-banners.mjs';
import { discordIdValid, discordInteraction, drainDiscordJobs, logStaffRemoval } from './discord.mjs';
import { actionLogs, canReadActionLogs } from './action-logs.mjs';
import { serverData, staffActivity } from './server-data.mjs';
import { minecraftSkin, minecraftTexture } from './minecraft-skins.mjs';
import { checkBridge, webChecks, checkChatHistory } from './web-checks.mjs';
import { Store } from './store.mjs';
import { authorizationURL, exchangeIdentity } from './providers.mjs';
import { authConfig, authFailureCode, available, cookie, cookies, equal, json, randomToken, redirect, safeJson, secureResponse } from './security.mjs';

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, provider: user.provider, providerId: user.provider_id, displayName: user.journal_nickname || user.display_name, position: user.journal_position || null, staffSince: user.journal_staff_since || null, profileBanner: canUseBanner(user.journal_profile_banner,user.journal_position) ? user.journal_profile_banner : null, canSetProfileBanner: !!user.journal_moderator_id, status: user.status };
}
function escapeText(value) {
  return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
}
function asset(map, name, status = 200) {
  const file = map[name];
  if (!file) return new Response('Not found', { status: 404 });
  const bytes = Uint8Array.from(atob(file.data), c => c.charCodeAt(0));
  return new Response(bytes, { status, headers: { 'Content-Type': file.type, 'Cache-Control': name.startsWith('/assets/') ? 'public, max-age=86400' : 'no-store' } });
}
async function readBody(request, limit = 16384) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('INVALID_BODY');
  const body = await request.text(); if (body.length > limit) throw new Error('INVALID_BODY');
  return JSON.parse(body);
}
function validAppointmentDate(value) {
  if (!value) return true;
  return validCalendarDate(value)&&value<=new Date().toISOString().slice(0,10);
}
function staffHistoryRange(input){
  const day=86400,offset=10800;
  const now=Math.floor(Date.now()/1000);
  const today=Math.floor((now+offset)/day)*day-offset;
  const period=input?.period??'all';
  if(period==='all')return {from:0,to:now};
  if(period==='today')return {from:today,to:now};
  if(period==='month'||period==='quarter'){
    const local=new Date((today+offset)*1000);
    const month=local.getUTCMonth()-(period==='month'?1:3);
    const year=local.getUTCFullYear();
    const lastDay=new Date(Date.UTC(year,month+1,0)).getUTCDate();
    const from=Date.UTC(year,month,Math.min(lastDay,local.getUTCDate()))/1000-offset;
    return {from,to:now};
  }
  if(period!=='custom'||![input.from,input.to].every(date=>typeof date==='string'&&validCalendarDate(date)))return null;
  const from=Date.parse(input.from+'T00:00:00+03:00')/1000;
  const to=Date.parse(input.to+'T00:00:00+03:00')/1000+day-1;
  return from<=Math.min(to,now)?{from,to:Math.min(to,now)}:null;
}
function validCalendarDate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===value;
}
function csrfOk(request, config, session) {
  return request.headers.get('origin') === config.origin && equal(request.headers.get('x-csrf-token'), session.csrf);
}
function one(url, key, limit = 2000) {
  const all = url.searchParams.getAll(key);
  return all.length === 1 && all[0].length <= limit ? all[0] : '';
}
export function createHandler(assetMap, dependencies = {}) {
  return async function fetchHandler(request, env, ctx = { waitUntil() {} }) {
    try {
      const response=await route(request, env, ctx);
      const path=new URL(request.url).pathname;
      if(env.DISCORD_BOT_TOKEN&&request.method==='POST'&&response.ok&&/^\/api\/(?:admin\/(?:moderators(?:\/[^/]+\/(?:edit|remove))?|former-moderators\/[^/]+\/restore)|staff\/[^/]+\/position)$/.test(path)){
        ctx.waitUntil(fetch('https://jevox-discord-presence.1pirs.workers.dev/health',{signal:AbortSignal.timeout(5000)})
          .catch(()=>console.error('Discord roster refresh request failed')));
        ctx.waitUntil(drainDiscordJobs(env,6,{newest:true}).catch(()=>console.error('Discord role processing failed')));
      }
      return secureResponse(response);
    }
    catch (error) {
      // Never log authorization codes, provider tokens, request URLs or secrets.
      const id = crypto.randomUUID(); console.error('Journal request failed', id, error?.name || 'Error');
      return secureResponse(json({ error: 'Сервис временно недоступен. Попробуйте позже.', requestId: id }, 503));
    }
  };
  async function route(request, env, ctx) {
    const url = new URL(request.url), path = url.pathname;
    if(path==='/api/discord/interactions'&&request.method==='POST')return discordInteraction(request,env,ctx);
    const config = authConfig(env, url.origin), cookieValues = cookies(request);
    const token = cookieValues[config.sessionName];
    let store;
    const db = () => store ||= new Store(env.DB);
    const syncDiscordMember = memberId => {
      if(env.DISCORD_BOT_TOKEN&&memberId)ctx.waitUntil(drainDiscordJobs(env,1,{memberId}).catch(()=>console.error('Discord member sync failed')));
    };
    const localPreview = env.LOCAL_PREVIEW_NO_LOGIN === '1' && ['localhost', '127.0.0.1'].includes(url.hostname);
    const getSession = () => localPreview ? Promise.resolve({id:'local-preview', provider:'local', provider_id:'local', display_name:'Администратор', journal_position:'Владелец', status:'active', csrf:'local-preview'}) : token ? db().session(token) : null;
    if (!['GET', 'HEAD', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
    if (request.method === 'HEAD') {
      const result = await route(new Request(request.url, { method: 'GET', headers: request.headers }), env, ctx);
      return new Response(null, { status: result.status, headers: result.headers });
    }
    if(['/api/server/sync','/api/server/checks','/api/server/summary','/api/server/leaderboard'].includes(path))return serverData(request,env,path.endsWith('/sync')?null:await getSession(),url);
    if(path==='/api/check-bridge')return checkBridge(request,env);
    if(path==='/api/work/checks/chat')return checkChatHistory(request,env,await getSession(),url);
    if(path==='/api/work/checks'){
      const session=await getSession();
      return webChecks(request,env,session,session&&csrfOk(request,config,session));
    }
    const skinMatch=path.match(/^\/api\/minecraft-skin\/([A-Za-z0-9_]{1,16})$/);
    if(skinMatch&&request.method==='GET'){
      const session=await getSession();
      if(session?.status!=='active')return json({error:'Нет доступа.'},403);
      const name=skinMatch[1].toLowerCase();
      const member=await db().db.prepare('SELECT nickname FROM moderators WHERE nickname=? COLLATE NOCASE').bind(name).first();
      if(!member)return json({skin:null},404);
      return minecraftSkin(name==='cvasolir'?'lqgend':name);
    }
    if (request.method === 'GET' && ['/style.css', '/auth.css', '/auth.js', '/account.js', '/favicon.svg'].includes(path)) return asset(assetMap, path);
    const textureMatch=path.match(/^\/assets\/minecraft-textures\/([a-f0-9]{32,64})\.png$/);
    if(textureMatch&&request.method==='GET')return assetMap[path]?asset(assetMap,path):minecraftTexture(textureMatch[1]);
    if (request.method === 'GET' && path.startsWith('/assets/')) return asset(assetMap, path);
    if (request.method === 'GET' && path === '/api/health') {
      await db().db.prepare('SELECT id FROM auth_users LIMIT 1').first();
      if (url.searchParams.get('telegram_probe') === '1') {
        if (!(await db().limit(`probe:${request.headers.get('cf-connecting-ip') || 'local'}`, 5, 600))) return json({ error: 'Too many requests' }, 429);
        try {
          const probe = await fetch('https://oauth.telegram.org/.well-known/jwks.json', { redirect: 'manual', signal: AbortSignal.timeout(10000) });
          return json({ ok: probe.ok, telegramKeysStatus: probe.status }, probe.ok ? 200 : 502);
        } catch (error) { return json({ ok: false, telegramKeysError: ['TypeError','TimeoutError','AbortError'].includes(error?.name) ? error.name : 'unavailable' }, 502); }
      }
      return json({ ok: true, service: 'moderation-journal', runtime: 'cloudflare-worker', database: 'D1', providers: available(config) });
    }
    if (request.method === 'GET' && path === '/api/auth/session') {
      const session = await getSession();
      return json({ user: publicUser(session), csrf: session?.csrf || null, providers: available(config) });
    }
    if (request.method === 'POST' && path === '/api/auth/logout') {
      const session = await getSession();
      if (!session) return json({ error: 'Войдите в аккаунт.' }, 401);
      if (!csrfOk(request, config, session)) return json({ error: 'Недействительный запрос.' }, 403);
      await db().logout(token); await db().audit(session.id, 'logout');
      const response = json({ ok: true }); response.headers.append('Set-Cookie', cookie(config, config.sessionName, '', 0));
      return response;
    }
    const start = path.match(/^\/auth\/(telegram|vk)\/start$/);
    if (request.method === 'GET' && start) {
      const provider = start[1];
      if (!available(config)[provider]) return redirect('/login?error=not_configured');
      if (!(await db().limit(`start:${request.headers.get('cf-connecting-ip') || 'local'}`, 30, 600))) return redirect('/login?error=rate_limit');
      const browser = /^[A-Za-z0-9_-]{43}$/.test(cookieValues[config.flowName] || '') ? cookieValues[config.flowName] : randomToken();
      const flow = { state: randomToken(), verifier: randomToken(48), nonce: randomToken() };
      await db().saveFlow(provider, browser, flow);
      const response = redirect(await authorizationURL(config, provider, flow));
      response.headers.append('Set-Cookie', cookie(config, config.flowName, browser, 600));
      ctx.waitUntil(db().cleanup());
      return response;
    }
    const callback = path.match(/^\/auth\/(telegram|vk)\/callback$/);
    if (request.method === 'GET' && callback) {
      const provider = callback[1];
      if (!available(config)[provider]) return redirect('/login?error=not_configured');
      if (!(await db().limit(`callback:${request.headers.get('cf-connecting-ip') || 'local'}`, 60, 600))) return redirect('/login?error=rate_limit');
      const state = one(url, 'state', 100), browser = cookieValues[config.flowName] || '';
      if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(browser)) return redirect('/login?error=expired');
      const flow = await db().consumeFlow(provider, browser, state);
      if (!flow) return redirect('/login?error=expired');
      if (url.searchParams.has('error')) return redirect('/login?error=cancelled');
      const code = one(url, 'code', 4096), deviceId = one(url, 'device_id', 1000);
      if (!code || (provider === 'vk' && !deviceId)) return redirect('/login?error=invalid_response');
      let stage = 'EXCHANGE';
      try {
        const identity = await (dependencies.exchangeIdentity || exchangeIdentity)(config, provider, flow, { code, state, deviceId });
        if (identity.provider !== provider || !identity.subject || !identity.providerId) throw new Error('INVALID_IDENTITY');
        stage = 'USER_STORE';
        const user = await db().upsertUser(identity, config);
        if (user.status === 'blocked') return redirect('/login?error=blocked');
        stage = 'SESSION_STORE';
        const session = await db().createSession(user.id, token);
        await db().audit(user.id, 'login:' + provider);
        const response = redirect(user.status === 'active' ? '/journal' : '/login');
        response.headers.append('Set-Cookie', cookie(config, config.sessionName, session.token));
        return response;
      } catch (error) {
        const failure = stage + '_' + authFailureCode(error);
        // Keep a bounded classification, never codes, tokens, URLs or secrets.
        try { await db().audit(null, 'login_failed:' + provider + ':' + failure); } catch {}
        console.error('OAuth verification failed', provider, failure);
        return redirect('/login?error=provider_failed');
      }
    }
    if(['/api/notifications','/api/notifications/read','/api/notifications/clear'].includes(path)) {
      const session=await getSession();if(!session||session.status!=='active')return json({error:'Нет доступа.'},403);
      if(path==='/api/notifications'&&request.method==='GET')return json({notifications:await db().notifications(session)});
      if(path.endsWith('/read')&&request.method==='POST'&&csrfOk(request,config,session)){await db().readNotifications(session);return json({ok:true})}
      if(path.endsWith('/clear')&&request.method==='POST'&&csrfOk(request,config,session)){await db().clearNotifications(session);return json({ok:true})}
      return json({error:'Нет доступа.'},403);
    }
    const staffProfileMatch=path.match(/^\/api\/staff\/([^/]+)\/profile$/);
    if(staffProfileMatch&&request.method==='GET') {
      const session=await getSession();
      if(!session||session.status!=='active'||!canViewStaff(session.journal_position))return json({error:'Нет доступа.'},403);
      const member=await db().db.prepare('SELECT id,nickname,position,staff_since,profile_banner FROM moderators WHERE id=?').bind(staffProfileMatch[1]).first();
      if(!member)return json({error:'Сотрудник не найден.'},404);
      if(!canUseBanner(member.profile_banner,member.position))member.profile_banner=null;
      const [history,activity]=await Promise.all([
        db().personalProfile({journal_moderator_id:member.id,journal_position:member.position}),
        staffActivity(db().db,member.nickname,member.id)
      ]);
      return json({member,history,activity});
    }
    const staffUpdateMatch=path.match(/^\/api\/staff\/([^/]+)\/profile\/(activity|clear-logs|clear-positions|clear-activity)$/);
    if(staffUpdateMatch){
      const session=await getSession();
      const [,id,operation]=staffUpdateMatch;
      const minimum=['clear-activity','clear-positions'].includes(operation)?'Младший Администратор':'Владелец';
      if(session?.status!=='active'||!hasStaffRank(session.journal_position,minimum)||!csrfOk(request,config,session))return json({error:'Нет доступа.'},403);
      if(request.method!=='POST')return json({error:'Method not allowed'},405);
      let options={};
      if(operation==='activity'){
        try{options=await readBody(request);}catch{return json({error:'Некорректные данные.'},400);}
        if(![options?.checks,options?.punishments].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=2147483647))
          return json({error:'Введите целые числа от 0 до 2 147 483 647.'},400);
      }
      if(operation==='clear-logs'||operation==='clear-positions'){
        let input;
        try{input=await readBody(request);}catch{return json({error:'Некорректные данные.'},400);}
        options=staffHistoryRange(input);
        if(!options)return json({error:'Выберите корректный период.'},400);
      }
      const action={activity:'staff_activity_adjusted','clear-logs':'staff_logs_cleared','clear-positions':'staff_positions_cleared','clear-activity':'staff_activity_cleared'}[operation];
      return await db().updateStaffJournal(session,id,action,options)?json({ok:true}):json({error:'Сотрудник не найден.'},404);
    }
    if(path==='/api/action-logs'&&request.method==='GET') {
      const session=await getSession();
      if(!canReadActionLogs(session))return json({error:'Нет доступа.'},403);
      return actionLogs(db().db,url.searchParams);
    }
    if(path==='/api/me/profile/banner'&&request.method==='POST') {
      const session=await getSession();
      if(session?.status!=='active'||!session.journal_moderator_id||!csrfOk(request,config,session))return json({error:'Нет доступа.'},403);
      let data;
      try { data=await readBody(request); } catch { return json({error:'Проверьте формат запроса.'},400); }
      const banner=data?.banner;
      if(banner!==null&&!isProfileBanner(banner))return json({error:'Выберите баннер из списка.'},400);
      if(banner!==null&&!canUseBanner(banner,session.journal_position))return json({error:'Этот баннер доступен только владельцам.'},403);
      if(!await db().setProfileBanner(session,banner))return json({error:'Доступ к баннеру изменился. Обновите страницу.'},409);
      return json({banner});
    }
    if(path==='/api/me/profile'&&request.method==='GET') {
      const session=await getSession();
      if(!session||session.status!=='active')return json({error:'Нет доступа.'},403);
      return json(await db().personalProfile(session));
    }
    if(path==='/api/me/sanctions'&&request.method==='GET') {
      const session=await getSession();if(!session||session.status!=='active')return json({error:'Нет доступа.'},403);
      return json({sanctions:await db().personalSanctions(session)});
    }
    if(path==='/api/staff-sanctions'||/^\/api\/staff-sanctions\/[^/]+\/revoke$/.test(path)) {
      const session=await getSession();if(!session||session.status!=='active'||!canEditRoster(session.journal_position))return json({error:'Нет доступа.'},403);
      if(path==='/api/staff-sanctions'&&request.method==='GET')return json({sanctions:await db().staffSanctions()});
      if(request.method!=='POST'||!csrfOk(request,config,session))return json({error:'Нет доступа.'},403);
      if(path!=='/api/staff-sanctions')return await db().revokeStaffSanction(session,path.split('/')[3])?json({ok:true}):json({error:'Наказание уже снято или не найдено.'},409);
      let data;try{data=await readBody(request)}catch{return json({error:'Некорректные данные.'},400)}
      const reason=typeof data?.reason==='string'?data.reason.trim():'';
      if(typeof data?.moderatorId!=='string'||!['warning','reprimand'].includes(data?.type)||reason.length<3||reason.length>500)return json({error:'Выберите сотрудника, вид наказания и укажите причину.'},400);
      const result=await db().issueStaffSanction(session,data.moderatorId,data.type,reason);
      if(result==='rank')return json({error:'Наказание можно выдать только нижестоящему сотруднику.'},403);
      if(result==='conflict')return json({error:'Должность сотрудника изменилась. Обновите профиль.'},409);
      if(result==='immune')return json({error:'Младшим администраторам, администраторам и владельцам нельзя выдавать взыскания.'},403);
      return result==='ok'?json({ok:true},201):json({error:'Сотрудник не найден.'},404);
    }
    if (path === '/api/staff' && request.method === 'GET') {
      const session = await getSession();
      if (!session || session.status !== 'active') return json({ error: 'Нет доступа.' }, 403);
      const search=url.searchParams.get('q')||'';
      if(search.length>120) return json({error:'Слишком длинный запрос.'},400);
      return json({ users: await db().activeStaff(search) });
    }
    if(path==='/api/manual-images/start'||/^\/api\/manual-images\/[a-f0-9-]{36}\/(chunk|finish)$/.test(path)) {
      const session=await getSession();if(!session||session.status!=='active'||!canManageManuals(session.journal_position)||!csrfOk(request,config,session))return json({error:'Нет доступа.'},403);
      if(request.method!=='POST')return json({error:'Method not allowed'},405);
      let data;try{data=await readBody(request,800000)}catch{return json({error:'Некорректная часть изображения.'},400)}
      if(path==='/api/manual-images/start') {
        if(!['image/png','image/jpeg','image/webp','image/gif'].includes(data?.type)||!Number.isSafeInteger(data?.size)||data.size<1)return json({error:'Выберите изображение PNG, JPG, GIF или WebP.'},400);
        return json(await db().startManualImage(session,data.type,data.size),201);
      }
      const parts=path.split('/'),id=parts[3],action=parts[4];
      if(action==='chunk')return await db().putManualImageChunk(session,id,data?.index,data?.data)?json({ok:true}):json({error:'Не удалось сохранить часть изображения.'},400);
      return await db().finishManualImage(session,id)?json({ok:true}):json({error:'Изображение загружено не полностью.'},400);
    }
    if (/^\/api\/manual-images\/[a-f0-9-]{36}$/.test(path)&&request.method==='GET') {
      const session=await getSession();if(!session||session.status!=='active')return json({error:'Нет доступа.'},403);
      const image=await db().manualImage(path.split('/')[3],session);if(!image)return json({error:'Изображение не найдено.'},404);
      let next=0,buffer=[];
      const stream=new ReadableStream({async pull(controller){try{
        if(!buffer.length&&next<image.chunk_count)buffer=(await db().db.prepare('SELECT data FROM manual_image_chunks WHERE image_id=? AND chunk_index>=? ORDER BY chunk_index LIMIT 16').bind(image.id,next).all()).results;
        if(!buffer.length){if(next!==image.chunk_count)throw Error('IMAGE_INCOMPLETE');controller.close();return}
        const bytes=Uint8Array.from(atob(buffer.shift().data),c=>c.charCodeAt(0));next++;controller.enqueue(bytes);
      }catch(error){controller.error(error)}}});
      return new Response(stream,{headers:{'Content-Type':image.media_type,'Content-Length':String(image.file_size),'Cache-Control':'private, no-store'}});
    }
    if (/^\/api\/manuals\/[^/]+\/delete$/.test(path)) {
      const session=await getSession();
      if(!session||session.status!=='active'||!canManageManuals(session.journal_position)||!csrfOk(request,config,session))return json({error:'Нет доступа.'},403);
      if(request.method!=='POST')return json({error:'Method not allowed'},405);
      return await db().deleteManual(session,path.split('/')[3])?json({ok:true}):json({error:'Мануал не найден.'},404);
    }
    const formerDelete=path.match(/^\/api\/admin\/former-moderators\/([^/]+)\/delete$/);
    if(formerDelete){
      const session=await getSession();
      if(!session||session.status!=='active'||!canDeleteFormerRecord(session.journal_position)||!csrfOk(request,config,session))return json({error:'Нет доступа.'},403);
      if(request.method!=='POST')return json({error:'Method not allowed'},405);
      return await db().deleteFormerRecord(session,formerDelete[1])?json({ok:true}):json({error:'Запись уже удалена или недоступна.'},404);
    }
    if (/^\/api\/admin\/former-moderators\/[^/]+\/restore$/.test(path)) {
      const session=await getSession();
      if(!session||session.status!=='active'||!canEditRoster(session.journal_position)||!csrfOk(request,config,session))return json({error:'Нет доступа.'},403);
      if(request.method!=='POST')return json({error:'Method not allowed'},405);
      try {const result=await db().restoreModerator(session,path.split('/')[4]);if(result==='rank')return json({error:'Недостаточно прав для восстановления этой должности.'},403);return result==='ok'?json({ok:true}):json({error:'Сотрудник уже восстановлен или не найден.'},404);}
      catch(error){if(String(error).includes('OWNER_LIMIT'))return json({error:'В составе может быть только два владельца.'},409);if(/unique|constraint/i.test(String(error)))return json({error:'Ник или аккаунт уже используется в действующем составе.'},409);throw error;}
    }
    if (path === '/api/manuals' || /^\/api\/manuals\/[^/]+$/.test(path)) {
      const session=await getSession();
      if (!session || session.status!=='active') return json({error:'Нет доступа.'},403);
      const id=path==='/api/manuals'?null:path.split('/')[3];
      if(request.method==='GET') { if(!id) return json({manuals:await db().manuals(session)}); const manual=await db().manual(id,session); return manual?json({manual}):json({error:'Мануал не найден.'},404); }
      if(request.method!=='POST') return json({error:'Method not allowed'},405);
      if(!canManageManuals(session.journal_position)||!csrfOk(request,config,session)) return json({error:'Нет доступа.'},403);
      let data;try{data=await readBody(request,10000000)}catch{return json({error:'Слишком большой или некорректный запрос.'},400)}
      const m=Object.fromEntries(['title','description','content'].map(k=>[k,typeof data?.[k]==='string'?data[k].trim():'']));
      if(!m.title||m.title.length>120||!m.description||m.description.length>500||!m.content||m.content.length>9000000) return json({error:'Проверьте название, описание и содержимое.'},400);
      if(data.allowedPositions!==undefined) {
        if(data.allowedPositions!==null && (!Array.isArray(data.allowedPositions)||!data.allowedPositions.length||data.allowedPositions.length>staffPositions.length||data.allowedPositions.some(p=>!staffPositions.includes(p))||new Set(data.allowedPositions).size!==data.allowedPositions.length)) return json({error:'Выберите должности, которым доступен мануал.'},400);
        m.allowedPositions=data.allowedPositions;
      }

      try {if(!await db().saveManual(session,m,id)) return json({error:'Мануал не найден.'},404);} catch(error) {if(['IMAGE_SIZE','MANUAL_SIZE','IMAGE_REFERENCE'].includes(error.message))return json({error:error.message==='IMAGE_SIZE'?'Не удалось обработать изображение. Добавьте его ещё раз.':'Мануал слишком большой или содержит недоступное изображение.'},400);throw error;}
      return json({ok:true},id?200:201);
    }
    if(path==='/api/admin/former-moderators'&&request.method==='GET') {
      const session=await getSession();if(!session||session.status!=='active'||!canEditRoster(session.journal_position))return json({error:'Нет доступа.'},403);
      return json({moderators:await db().formerModerators()});
    }
    const positionMatch=path.match(/^\/api\/staff\/([^/]+)\/position$/);
    if(positionMatch&&request.method==='POST') {
      const session=await getSession();
      if(!session||session.status!=='active'||!csrfOk(request,config,session))return json({error:'Нет доступа.'},403);
      let data;try{data=await readBody(request)}catch{return json({error:'Некорректные данные.'},400)}
      if(!canAssignPosition(session.journal_position,data?.position))return json({error:'Недостаточно прав для назначения на эту должность.'},403);
      let result;
      try{result=await db().changeStaffPosition(session,positionMatch[1],data.position)}
      catch(error){if(String(error).includes('OWNER_LIMIT'))return json({error:'В составе может быть только два владельца.'},409);throw error}
      if(result==='ok')return json({ok:true});
      if(result==='rank')return json({error:'Недостаточно прав для изменения этой должности.'},403);
      if(result==='conflict')return json({error:'Должность уже изменилась. Обновите страницу.'},409);
      return json({error:'Сотрудник не найден.'},404);
    }
    if (/^\/api\/admin\/moderators\/[^/]+\/(edit|remove)$/.test(path)) {
      const session=await getSession();
      if(!session||session.status!=='active'||!canEditRoster(session.journal_position)||!csrfOk(request,config,session)) return json({error:'Нет доступа.'},403);
      if(request.method!=='POST') return json({error:'Method not allowed'},405);
      const [, , , ,id,action]=path.split('/'); let data;try{data=await readBody(request)}catch{return json({error:'Некорректные данные.'},400)}
      if(action==='remove') {
        const reason=typeof data?.reason==='string'?data.reason.trim():'';
        if(reason.length<3||reason.length>500)return json({error:'Укажите причину снятия (от 3 до 500 символов).'},400);
        const result=await db().removeModerator(session,id,reason);
        if(result.status==='ok'){
          if(env.DISCORD_BOT_TOKEN)ctx.waitUntil(logStaffRemoval(env,result).catch(()=>console.error('Discord staff removal log failed')));
          return json({ok:true});
        }
        if(result.status==='rank')return json({error:'Недостаточно прав для управления этой должностью.'},403);
        return json({error:result.status==='missing'?'Сотрудник не найден.':'Нельзя снять себя.'},result.status==='missing'?404:409);
      }
      const m=Object.fromEntries(['nickname','position','realName','birthDate','vkId','telegramId'].map(k=>[k,typeof data?.[k]==='string'?data[k].trim():'']));
      if(data.appointmentDate!==undefined){if(typeof data.appointmentDate!=='string'||!validAppointmentDate(data.appointmentDate))return json({error:'Проверьте дату назначения.'},400);m.appointmentDate=data.appointmentDate;}
      if(data.staffSince!==undefined){if(typeof data.staffSince!=='string'||!validAppointmentDate(data.staffSince))return json({error:'Проверьте дату вступления в состав.'},400);m.staffSince=data.staffSince;}
      const date=new Date(m.birthDate+'T00:00:00Z');
      if(!/^[a-zA-Z0-9_]{3,16}$/.test(m.nickname)||!staffPositions.includes(m.position)||m.realName.length<2||m.realName.length>120||!/^\d{4}-\d{2}-\d{2}$/.test(m.birthDate)||Number.isNaN(date.valueOf())||date.toISOString().slice(0,10)!==m.birthDate||m.birthDate>new Date().toISOString().slice(0,10)||(!m.vkId&&!m.telegramId)||(m.vkId&&!/^[0-9]{1,30}$/.test(m.vkId))||(m.telegramId&&!/^[0-9]{1,30}$/.test(m.telegramId))) return json({error:'Проверьте данные сотрудника.'},400);
      if(data.discordId!==undefined){
        m.discordId=typeof data.discordId==='string'?data.discordId.trim():null;
        if(m.discordId===null||(m.discordId!==''&&!discordIdValid(m.discordId)))return json({error:'Укажите корректный Discord ID.'},400);
      }
      let result;try{result=await db().editModerator(session,id,m)}catch(error){if(String(error).includes('OWNER_LIMIT'))return json({error:'В составе может быть только два владельца.'},409);if(/unique|constraint/i.test(String(error)))return json({error:'Такой ник или ID (ВКонтакте, Telegram или Discord) уже есть в составе.'},409);throw error}
      if(result==='rank')return json({error:'Недостаточно прав для управления этой должностью.'},403);
      if(result==='ok')syncDiscordMember(m.discordId);
      return result==='ok'?json({ok:true}):json({error:result==='missing'?'Сотрудник не найден.':'Нельзя отвязать свой аккаунт.'},result==='missing'?404:409);
    }
    if (path === '/api/admin/moderators') {
      const session = await getSession();
      if (!session || session.status !== 'active' || !canEditRoster(session.journal_position)) return json({ error: 'Нет доступа.' }, 403);
      if (path === '/api/admin/moderators' && request.method === 'GET') return json({ moderators: await db().moderators() });
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      if (!csrfOk(request, config, session)) return json({ error: 'Недействительный запрос.' }, 403);
      let data; try { data=await readBody(request); } catch { return json({error:'Проверьте формат запроса.'},400); }
      const m=Object.fromEntries(['nickname','position','realName','birthDate','vkId','telegramId'].map(k=>[k,typeof data?.[k]==='string'?data[k].trim():'']));
      if(data.appointmentDate!==undefined){if(typeof data.appointmentDate!=='string'||!validAppointmentDate(data.appointmentDate))return json({error:'Проверьте дату назначения.'},400);m.appointmentDate=data.appointmentDate;}
      if(data.staffSince!==undefined){if(typeof data.staffSince!=='string'||!validAppointmentDate(data.staffSince))return json({error:'Проверьте дату вступления в состав.'},400);m.staffSince=data.staffSince;}
      const date=new Date(m.birthDate+'T00:00:00Z');
      if (!/^[a-zA-Z0-9_]{3,16}$/.test(m.nickname) || !staffPositions.includes(m.position) || m.realName.length<2 || m.realName.length>120 || !/^\d{4}-\d{2}-\d{2}$/.test(m.birthDate) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0,10)!==m.birthDate || m.birthDate>new Date().toISOString().slice(0,10) || (!m.vkId && !m.telegramId) || (m.vkId && !/^[0-9]{1,30}$/.test(m.vkId)) || (m.telegramId && !/^[0-9]{1,30}$/.test(m.telegramId))) return json({error:'Проверьте ник, должность, имя, дату рождения и числовые ID. Укажите хотя бы один ID.'},400);
      if(!canAssignPosition(session.journal_position,m.position))return json({error:'Недостаточно прав для назначения на эту должность.'},403);
      m.discordId=typeof data.discordId==='string'?data.discordId.trim():'';
      if(!discordIdValid(m.discordId))return json({error:'Укажите корректный Discord ID сотрудника.'},400);
      try { await db().addModerator(session,m); } catch(error) { if(String(error).includes('OWNER_LIMIT'))return json({error:'В составе может быть только два владельца.'},409);if (/unique|constraint/i.test(String(error))) return json({error:'Такой ник или ID (ВКонтакте, Telegram или Discord) уже есть в составе.'},409); throw error; }
      syncDiscordMember(m.discordId);
      return json({ok:true},201);
    }
    if (request.method === 'GET' && (path === '/' || path === '/login')) {
      const session = await getSession();
      if (session?.status === 'active') return redirect('/journal');
      return asset(assetMap, '/login.html');
    }
    if (request.method === 'GET' && ['/journal', '/index.html', '/app.js'].includes(path)) {
      const session = await getSession();
      if (!session) return path === '/app.js' ? json({ error: 'Войдите в аккаунт.' }, 401) : redirect('/login');
      if (session.status !== 'active') return path === '/app.js' ? json({ error: 'Доступ не выдан.' }, 403) : redirect('/login');
      if (path === '/app.js') return asset(assetMap, '/app.js');
      const template = await asset(assetMap, '/journal.html').text();
      const user = publicUser(session);
      const initials = String(user.displayName??'').replace(/\s/g,'').slice(0,2).toUpperCase();
      const html = template
        .replace('<!-- PROFILE_INITIALS -->', () => escapeText(initials))
        .replace('<!-- PROFILE_NAME -->', () => escapeText(user.displayName))
        .replace('<!-- AUTH_SESSION -->', () => `<script id="auth-session" type="application/json">${safeJson({user,csrf:session.csrf})}</script>`);
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    if (path.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return new Response('Страница не найдена.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
}
