import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHandler } from '../worker/app.mjs';
import { hash, now } from '../worker/security.mjs';

function d1() {
  const raw=new DatabaseSync(':memory:');raw.exec('PRAGMA foreign_keys=ON');
  for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  return {raw,prepare(sql){let args=[];return {bind(...values){args=values;return this},async first(){return raw.prepare(sql).get(...args)||null},async all(){return {results:raw.prepare(sql).all(...args)}},async run(){return raw.prepare(sql).run(...args)}}},async batch(statements){raw.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());raw.exec('COMMIT');return result}catch(e){raw.exec('ROLLBACK');throw e}}};
}
const asset=text=>({data:Buffer.from(text).toString('base64'),type:'text/html; charset=utf-8'});
function setup({admin=false,identityId='42',position}={}){
 const DB=d1();const env={PUBLIC_URL:'https://journal.example',TELEGRAM_CLIENT_ID:'123',TELEGRAM_CLIENT_SECRET:'test-secret',VK_CLIENT_ID:'456',DB,...(admin?{ADMIN_TELEGRAM_IDS:'42'}:{})};
 if(position) DB.raw.prepare("INSERT INTO moderators (id,nickname,position,real_name,birth_date,telegram_id,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)").run("actor","User <test>",position,"Test Name","2000-01-01",identityId,now(),"test");
 let called=0;
 const handler=createHandler({'/login.html':asset('LOGIN'),'/journal.html':asset(readFileSync(new URL('../dist/index.html',import.meta.url),'utf8')),'/app.js':asset('protected')},{exchangeIdentity:async(config,provider,flow,callback)=>{called++;assert.ok(flow.verifier.length>=43);assert.ok(flow.nonce.length>=43);assert.ok(callback.code);return {provider,subject:'subject-'+identityId,providerId:identityId,displayName:'User <test>',username:''}}});
 const wait=[];const request=(path,options={})=>handler(new Request('https://journal.example'+path,options),env,{waitUntil:p=>wait.push(p)});
 return {env,DB,request,get called(){return called},async close(){await Promise.all(wait);DB.raw.close()}};
}
async function start(f,provider='telegram'){
 const response=await f.request(`/auth/${provider}/start`);assert.equal(response.status,302);
 return {state:new URL(response.headers.get('location')).searchParams.get('state'),flowCookie:response.headers.get('set-cookie').split(';')[0],response};
}
async function login(f){const flow=await start(f);const response=await f.request(`/auth/telegram/callback?code=valid&state=${flow.state}`,{headers:{Cookie:flow.flowCookie}});return {...flow,response,sessionCookie:response.headers.get('set-cookie')?.split(';')[0]}}

test('Anonymous visitors only receive the login page; private assets and paths stay protected',async()=>{
 const f=setup();try{
 assert.equal(await (await f.request('/')).text(),'LOGIN');assert.equal((await f.request('/journal')).headers.get('location'),'/login');assert.equal((await f.request('/app.js')).status,401);
 for(const path of ['/.env','/journal.html','/dist/index.html','/server/index.js'])assert.equal((await f.request(path)).status,404);
 assert.deepEqual((await (await f.request('/api/auth/session')).json()).user,null);
 assert.equal((await f.request('/api/admin/moderators')).status,403);
 }finally{await f.close()}
});
test('Authorization uses S256, server-held verifier, state and a secure browser-binding cookie',async()=>{
 const f=setup();try{const flow=await start(f);const url=new URL(flow.response.headers.get('location'));assert.equal(url.origin,'https://oauth.telegram.org');assert.equal(url.searchParams.get('scope'),'openid profile');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('code_verifier'),null);const saved=f.DB.raw.prepare('SELECT * FROM auth_flows').get();assert.equal(url.searchParams.get('code_challenge'),await hash(saved.verifier));assert.equal(url.searchParams.get('nonce'),null);assert.match(flow.response.headers.get('set-cookie'),/HttpOnly/);assert.match(flow.response.headers.get('set-cookie'),/Secure/);assert.match(flow.response.headers.get('set-cookie'),/SameSite=Lax/)}finally{await f.close()}
});
test('Cross-browser, cross-provider, expired and replayed callbacks cannot create sessions',async()=>{
 const f=setup();try{const flow=await start(f);
 assert.match((await f.request(`/auth/telegram/callback?code=x&state=${flow.state}`)).headers.get('location'),/expired/);
 assert.match((await f.request(`/auth/vk/callback?code=x&device_id=d&state=${flow.state}`,{headers:{Cookie:flow.flowCookie}})).headers.get('location'),/expired/);
 assert.equal(f.called,0);
 const valid=await f.request(`/auth/telegram/callback?code=x&state=${flow.state}`,{headers:{Cookie:flow.flowCookie}});assert.ok(valid.headers.get('set-cookie'));
 assert.match((await f.request(`/auth/telegram/callback?code=x&state=${flow.state}`,{headers:{Cookie:flow.flowCookie}})).headers.get('location'),/expired/);assert.equal(f.called,1);
 const expired=await start(f);f.DB.raw.exec('UPDATE auth_flows SET expires_at=0');assert.match((await f.request(`/auth/telegram/callback?code=x&state=${expired.state}`,{headers:{Cookie:expired.flowCookie}})).headers.get('location'),/expired/);
 }finally{await f.close()}
});
test('Social identity alone does not grant moderation privileges; first user remains pending',async()=>{
 const f=setup();try{const l=await login(f);const me=await (await f.request('/api/auth/session',{headers:{Cookie:l.sessionCookie}})).json();assert.equal(me.user.status,'pending');assert.equal(me.user.role,undefined);assert.equal((await f.request('/app.js',{headers:{Cookie:l.sessionCookie}})).status,403);assert.equal((await f.request('/api/admin/moderators',{headers:{Cookie:l.sessionCookie}})).status,403);
 const rawToken=l.sessionCookie.split('=')[1],row=f.DB.raw.prepare('SELECT token_hash FROM auth_sessions').get();assert.notEqual(row.token_hash,rawToken);assert.equal(row.token_hash,await hash(rawToken));
 }finally{await f.close()}
});
test('Approved administrator can enter; JSON bootstrap is escaped; logout enforces CSRF and revokes session',async()=>{
 const f=setup({admin:true});try{const l=await login(f);const headers={Cookie:l.sessionCookie};const me=await (await f.request('/api/auth/session',{headers})).json();assert.equal(me.user.status,'active');assert.equal(me.user.role,undefined);const journal=await f.request('/journal',{headers});const html=await journal.text();assert.match(html,/auth-session/);assert.ok(!html.includes('User <test>'));assert.match(html, /class="profile-name">User &lt;test&gt;<\/strong>/);assert.match(html, /class="avatar" aria-hidden="true">US<\/span>/);assert.match(html,/\\u003c/);assert.equal((await f.request('/app.js',{headers})).status,200);
 assert.equal((await f.request('/api/auth/logout',{method:'POST',headers})).status,403);
 assert.equal((await f.request('/api/auth/logout',{method:'POST',headers:{...headers,Origin:'https://evil.example','X-CSRF-Token':me.csrf}})).status,403);
 assert.equal((await f.request('/api/auth/logout',{method:'POST',headers:{...headers,Origin:f.env.PUBLIC_URL,'X-CSRF-Token':me.csrf}})).status,200);
 assert.equal((await (await f.request('/api/auth/session',{headers})).json()).user,null);
 }finally{await f.close()}
});
test('Sessions expire, blocked accounts lose access, and browser sessions survive handler restarts',async()=>{
 const f=setup({admin:true});try{const l=await login(f);const headers={Cookie:l.sessionCookie};assert.equal((await f.request('/app.js',{headers})).status,200);f.DB.raw.exec("UPDATE auth_users SET status='blocked'");assert.equal((await f.request('/app.js',{headers})).status,403);f.DB.raw.exec("UPDATE auth_users SET status='active'; UPDATE auth_sessions SET expires_at=0");assert.equal((await f.request('/app.js',{headers})).status,401)}finally{await f.close()}
});
test('Legacy journal roles do not grant access and their write endpoints were removed',async()=>{
 const f=setup({admin:true});
 try {
  const {sessionCookie}=await login(f),headers={Cookie:sessionCookie};
  const {csrf}=await (await f.request('/api/auth/session',{headers})).json();
  f.DB.raw.exec("UPDATE auth_users SET role='admin'");
  for(const path of ['/api/admin/moderators','/api/action-logs','/api/staff/member/profile']){
   assert.equal((await f.request(path,{headers})).status,403);
  }
  for(const path of ['/api/admin/users/other/access','/api/admin/moderators/member/role','/api/admin/moderators/member/admin']){
   assert.equal((await f.request(path,{method:'POST',headers:{...headers,Origin:f.env.PUBLIC_URL,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:'{}'})).status,404);
  }
 }finally{await f.close()}
});
test('Missing provider settings stay disabled, and repeated attempts are limited',async()=>{
 const f=setup();try{f.env.TELEGRAM_CLIENT_SECRET='';assert.match((await f.request('/auth/telegram/start')).headers.get('location'),/not_configured/);assert.equal((await (await f.request('/api/auth/session')).json()).providers.telegram,false);f.env.TELEGRAM_CLIENT_SECRET='test';for(let i=0;i<30;i++)assert.ok(!(await f.request('/auth/telegram/start')).headers.get('location').includes('rate_limit'));assert.match((await f.request('/auth/telegram/start')).headers.get('location'),/rate_limit/)}finally{await f.close()}
});
import { Store } from '../worker/store.mjs';

test('Roster creation checks management access, validates identities and keeps personal data private',async()=>{
 const f=setup({admin:true,position:'Владелец'});try{
 const l=await login(f),headers={Cookie:l.sessionCookie},me=await (await f.request('/api/auth/session',{headers})).json();
 const postHeaders={...headers,Origin:f.env.PUBLIC_URL,'X-CSRF-Token':me.csrf,'Content-Type':'application/json'};
 const data={nickname:'Player_123',discordId:'1572356030611067001',position:'Джуниор',realName:'Иван Иванов',birthDate:'2000-01-01',vkId:'77',telegramId:'88'};
 assert.equal((await f.request('/api/admin/moderators',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(data)})).status,403);
 f.DB.raw.prepare('INSERT INTO auth_users VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('pending','vk','p','77','Pending','','','moderator','pending',now(),now());
 assert.equal((await f.request('/api/admin/moderators',{method:'POST',headers:postHeaders,body:JSON.stringify(data)})).status,201);
 assert.equal(f.DB.raw.prepare('SELECT status FROM auth_users WHERE id=?').get('pending').status,'active');
 assert.equal((await f.request('/api/admin/moderators',{method:'POST',headers:postHeaders,body:JSON.stringify({...data,nickname:'player_123',vkId:'999',telegramId:''})})).status,409);
 assert.equal((await f.request('/api/admin/moderators',{method:'POST',headers:postHeaders,body:JSON.stringify({...data,nickname:'different',birthDate:'2020-02-30'})})).status,400);
 const list=await (await f.request('/api/admin/moderators',{headers})).json();assert.equal(list.moderators.find(member=>member.id!=='actor').real_name,'Иван Иванов');
 const safe=await (await f.request('/api/staff',{headers})).json();assert.equal(safe.users.find(member=>member.id!=='actor').nickname,'Player_123');assert.equal(safe.users.find(member=>member.id!=='actor').real_name,undefined);assert.equal(safe.users.find(member=>member.id!=='actor').telegram_id,undefined);


 const store=new Store(f.DB),config={admins:{vk:new Set(),telegram:new Set()},staff:{vk:new Set(),telegram:new Set()}};
 const user=await store.upsertUser({provider:'telegram',subject:'new',providerId:'88',displayName:'Social'},config);assert.equal(user.status,'active');assert.equal(user.role,'moderator');
 const newSession=await store.createSession(user.id);assert.equal((await store.session(newSession.token)).journal_nickname,'Player_123');
 }finally{await f.close()}
});
test('Manuals require admin to write and remain readable for active moderators',async()=>{
 const f=setup({admin:true,position:'Владелец'});try{const l=await login(f),headers={Cookie:l.sessionCookie},me=await(await f.request('/api/auth/session',{headers})).json();const post={...headers,Origin:f.env.PUBLIC_URL,'X-CSRF-Token':me.csrf,'Content-Type':'application/json'};const manual={title:'Проверки',description:'Как проверять',content:'## Начало\n**Важно**\n![Фото](data:image/png;base64,AAAA)'};
 assert.equal((await f.request('/api/manuals',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(manual)})).status,403);
 assert.equal((await f.request('/api/manuals',{method:'POST',headers:post,body:JSON.stringify(manual)})).status,201);
 const list=await(await f.request('/api/manuals',{headers})).json();assert.equal(list.manuals.length,1);assert.equal(list.manuals[0].content,undefined);
 const detail=await(await f.request('/api/manuals/'+list.manuals[0].id,{headers})).json();assert.match(detail.manual.content,/!\[Фото\]\(\/api\/manual-images\/[a-f0-9-]+\)/);const imagePath=detail.manual.content.match(/\/api\/manual-images\/[a-f0-9-]+/)[0];assert.equal((await f.request(imagePath,{headers})).status,200);
 f.DB.raw.exec("UPDATE moderators SET position='Джуниор' WHERE id='actor'");assert.equal((await f.request('/api/manuals',{headers})).status,200);assert.equal((await f.request('/api/manuals',{method:'POST',headers:post,body:JSON.stringify(manual)})).status,403);
 }finally{await f.close()}
});
test('Roster edits change the server position and revoke access to a detached identity',async()=>{
 const f=setup({admin:true,position:'Владелец'});try{const l=await login(f),headers={Cookie:l.sessionCookie},me=await(await f.request('/api/auth/session',{headers})).json();const post={...headers,Origin:f.env.PUBLIC_URL,'X-CSRF-Token':me.csrf,'Content-Type':'application/json'};const m={nickname:'Alex_123',discordId:'1572356030611067001',position:'Джуниор',realName:'Имя Фамилия',birthDate:'2000-01-01',vkId:'77',telegramId:''};
 f.DB.raw.prepare('INSERT INTO auth_users VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('other','vk','other','77','Other','','','moderator','pending',now(),now());
 assert.equal((await f.request('/api/admin/moderators',{method:'POST',headers:post,body:JSON.stringify(m)})).status,201);let list=await(await f.request('/api/admin/moderators',{headers})).json();const id=list.moderators.find(member=>member.id!=='actor').id;
 const send=(path,data)=>f.request(`/api/admin/moderators/${id}/${path}`,{method:'POST',headers:post,body:JSON.stringify(data)});
 assert.equal((await send('edit',{...m,position:'Менеджер'})).status,200);assert.equal(f.DB.raw.prepare('SELECT role FROM auth_users WHERE id=?').get('other').role,'moderator');


 assert.equal((await send('edit',{...m,vkId:'78'})).status,200);assert.equal(f.DB.raw.prepare('SELECT status FROM auth_users WHERE id=?').get('other').status,'pending');
 }finally{await f.close()}
});
test('Manual visibility follows server position on list and direct access; author remains original',async()=>{
 const f=setup({admin:true,position:'Владелец'});try{const l=await login(f),headers={Cookie:l.sessionCookie},me=await(await f.request('/api/auth/session',{headers})).json();const post={...headers,Origin:f.env.PUBLIC_URL,'X-CSRF-Token':me.csrf,'Content-Type':'application/json'};
 const create=(data)=>f.request('/api/manuals',{method:'POST',headers:post,body:JSON.stringify(data)});const m={title:'Только кураторы',description:'Доступ по должности',content:'Материал',allowedPositions:['Менеджер']};
 assert.equal((await create({...m,allowedPositions:[]})).status,400);assert.equal((await create({...m,allowedPositions:['Подделка']})).status,400);assert.equal((await create(m)).status,201);const id=(await(await f.request('/api/manuals',{headers})).json()).manuals[0].id;
 assert.equal((await(await f.request('/api/manuals/'+id,{headers})).json()).manual.author_name,'User <test>');
 f.DB.raw.prepare('UPDATE moderators SET nickname=? WHERE id=?').run('Nick','actor');
 assert.equal((await(await f.request('/api/manuals/'+id,{headers})).json()).manual.author_name,'Nick');
 f.DB.raw.exec("UPDATE moderators SET position='Джуниор' WHERE id='actor'");assert.equal((await(await f.request('/api/manuals',{headers})).json()).manuals.length,0);assert.equal((await f.request('/api/manuals/'+id,{headers})).status,404);
 f.DB.raw.exec("UPDATE moderators SET position='Менеджер' WHERE id='actor'");assert.equal((await(await f.request('/api/manuals',{headers})).json()).manuals.length,1);assert.equal((await f.request('/api/manuals/'+id,{headers})).status,200);
 f.DB.raw.exec("UPDATE moderators SET position='Владелец' WHERE id='actor'");assert.equal((await f.request('/api/manuals/'+id,{headers})).status,200);
 assert.equal((await f.request('/api/manuals/'+id,{method:'POST',headers:post,body:JSON.stringify({...m,title:'Обновлено'})})).status,200);
 assert.equal((await(await f.request('/api/manuals/'+id,{headers})).json()).manual.author_name,'Nick');
 }finally{await f.close()}
});
test('Staff search matches nickname and Cyrillic full name without returning personal details',async()=>{
 const f=setup({admin:true});try{const l=await login(f),headers={Cookie:l.sessionCookie};const me=await(await f.request('/api/auth/session',{headers})).json();const insert=f.DB.raw.prepare('INSERT INTO moderators (id,nickname,position,real_name,birth_date,vk_id,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)');insert.run('one','Meriwether','Менеджер','Ярослав Попков','2000-01-01','123',now(),me.user.id);insert.run('two','Another','Джуниор','Иван Петров','2001-01-01','456',now(),me.user.id);
 for(const q of ['MERIW','яРОСЛАВ ПОПКОВ','ПопКоВ']){const data=await(await f.request('/api/staff?q='+encodeURIComponent(q),{headers})).json();assert.equal(data.users.length,1);assert.equal(data.users[0].nickname,'Meriwether');assert.equal(data.users[0].real_name,undefined);assert.equal(data.users[0].birth_date,undefined)}
 assert.equal((await(await f.request('/api/staff?q=notfound',{headers})).json()).users.length,0);assert.equal((await f.request('/api/staff?q=иван')).status,403);
 }finally{await f.close()}
});
test('Removing moderator archives details, revokes sessions, and permits deliberate re-adding',async()=>{
 const f=setup({admin:true,position:'Владелец'});try{const l=await login(f),headers={Cookie:l.sessionCookie},me=await(await f.request('/api/auth/session',{headers})).json();const post={...headers,Origin:f.env.PUBLIC_URL,'X-CSRF-Token':me.csrf,'Content-Type':'application/json'};
 const data={nickname:'TestPerson',discordId:'1572356030611067001',position:'Менеджер',realName:'Иван Иванов',birthDate:'2000-01-01',vkId:'77',telegramId:'88',appointmentDate:'2025-01-02'};
 f.DB.raw.prepare('INSERT INTO auth_users VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('other','vk','other','77','Other','','','moderator','pending',now(),now());
 assert.equal((await f.request('/api/admin/moderators',{method:'POST',headers:post,body:JSON.stringify(data)})).status,201);
 const list=await(await f.request('/api/admin/moderators',{headers})).json(),id=list.moderators.find(member=>member.id!=='actor').id;assert.equal(list.moderators.find(member=>member.id!=='actor').appointment_date,'2025-01-02');
 const store=new Store(f.DB),otherSession=await store.createSession('other');assert.equal((await store.session(otherSession.token)).status,'active');
 const remove=`/api/admin/moderators/${id}/remove`;assert.equal((await f.request(remove,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'})).status,403);
 assert.equal((await f.request(remove,{method:'POST',headers:post,body:JSON.stringify({reason:'Причина снятия'})})).status,200);assert.equal(await store.session(otherSession.token),null);
 assert.equal(f.DB.raw.prepare('SELECT status FROM auth_users WHERE id=?').get('other').status,'removed');assert.equal((await(await f.request('/api/admin/moderators',{headers})).json()).moderators.length,1);
 const archive=(await(await f.request('/api/admin/former-moderators',{headers})).json()).moderators;assert.equal(archive.length,1);assert.equal(archive[0].appointment_date,'2025-01-02');assert.equal(archive[0].removed_by_name,'User <test>');assert.equal(archive[0].position,'Менеджер');assert.equal(archive[0].removal_reason,'Причина снятия');assert.equal((await f.request('/api/admin/former-moderators')).status,403);
 const config={admins:{vk:new Set(),telegram:new Set()},staff:{vk:new Set(),telegram:new Set(['88'])}};assert.equal((await store.upsertUser({provider:'telegram',providerId:'88',subject:'other',displayName:'Other'},config)).status,'blocked');
 assert.equal((await f.request('/api/admin/moderators',{method:'POST',headers:post,body:JSON.stringify(data)})).status,201);assert.equal(f.DB.raw.prepare('SELECT status FROM auth_users WHERE id=?').get('other').status,'active');
 }finally{await f.close()}
});
test('Removal reason required, restoring moderator preserves the server position and handles conflicts',async()=>{
 const f=setup({admin:true,position:'Владелец'});try{const l=await login(f),headers={Cookie:l.sessionCookie},me=await(await f.request('/api/auth/session',{headers})).json(),post={...headers,Origin:f.env.PUBLIC_URL,'X-CSRF-Token':me.csrf,'Content-Type':'application/json'};
 const m={nickname:'ModOne',discordId:'1572356030611067001',position:'Менеджер',realName:'Иван Иванов',birthDate:'2000-01-01',vkId:'77',telegramId:'',appointmentDate:'2025-01-02'};
 f.DB.raw.prepare('INSERT INTO auth_users VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('mod','vk','mod','77','Mod','','','moderator','pending',now(),now());
 assert.equal((await f.request('/api/admin/moderators',{method:'POST',headers:post,body:JSON.stringify(m)})).status,201);const id=(await(await f.request('/api/admin/moderators',{headers})).json()).moderators.find(member=>member.id!=='actor').id;
 const send=(url,data={})=>f.request(url,{method:'POST',headers:post,body:JSON.stringify(data)});

 assert.equal((await send(`/api/admin/moderators/${id}/remove`,{reason:'  '})).status,400);assert.equal((await send(`/api/admin/moderators/${id}/remove`,{reason:'Ушел по желанию'})).status,200);
 const former=(await(await f.request('/api/admin/former-moderators',{headers})).json()).moderators[0];assert.equal(former.removal_reason,'Ушел по желанию');assert.equal(former.journal_admin,undefined);
 assert.equal((await f.request(`/api/admin/former-moderators/${former.id}/restore`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'})).status,403);
 assert.equal((await f.request('/api/admin/moderators',{method:'POST',headers:post,body:JSON.stringify(m)})).status,201);assert.equal((await send(`/api/admin/former-moderators/${former.id}/restore`)).status,409);
 f.DB.raw.exec("DELETE FROM moderators WHERE nickname='ModOne'; UPDATE auth_users SET status='removed' WHERE id='mod'");
 assert.equal((await send(`/api/admin/former-moderators/${former.id}/restore`)).status,200);const active=(await(await f.request('/api/admin/moderators',{headers})).json()).moderators.find(member=>member.id!=='actor');assert.equal(active.nickname,'ModOne');assert.equal(active.appointment_date,'2025-01-02');assert.equal(active.position,'Менеджер');assert.equal(f.DB.raw.prepare('SELECT status FROM auth_users WHERE id=?').get('mod').status,'active');assert.equal((await(await f.request('/api/admin/former-moderators',{headers})).json()).moderators.length,0);assert.equal((await send(`/api/admin/former-moderators/${former.id}/restore`)).status,404);
 }finally{await f.close()}
});
test('Only admin with CSRF may delete a manual',async()=>{
 const f=setup({admin:true,position:'Владелец'});try{const l=await login(f),headers={Cookie:l.sessionCookie},me=await(await f.request('/api/auth/session',{headers})).json(),post={...headers,Origin:f.env.PUBLIC_URL,'X-CSRF-Token':me.csrf,'Content-Type':'application/json'};
 assert.equal((await f.request('/api/manuals',{method:'POST',headers:post,body:JSON.stringify({title:'Тест',description:'Описание',content:'Текст'})})).status,201);const id=(await(await f.request('/api/manuals',{headers})).json()).manuals[0].id;
 assert.equal((await f.request(`/api/manuals/${id}/delete`,{method:'POST',headers,body:'{}'})).status,403);f.DB.raw.exec("UPDATE moderators SET position='Джуниор' WHERE id='actor'");assert.equal((await f.request(`/api/manuals/${id}/delete`,{method:'POST',headers:post,body:'{}'})).status,403);f.DB.raw.exec("UPDATE moderators SET position='Владелец' WHERE id='actor'");assert.equal((await f.request(`/api/manuals/${id}/delete`,{method:'POST',headers:post,body:'{}'})).status,200);assert.equal((await f.request(`/api/manuals/${id}`,{headers})).status,404);
 }finally{await f.close()}
});
test('Removed form, player punishment and rollback routes are unavailable',async()=>{
 const f=setup({admin:true});try{
  const session=await login(f),headers={Cookie:session.sessionCookie};
  for(const path of ['/api/ban-forms','/api/ban-forms/history','/api/server/punishments?player=Example'])
   assert.equal((await f.request(path,{headers})).status,404);
  for(const path of ['/api/ban-forms','/api/ban-forms/old/accept','/api/action-logs/aaa111/undo'])
   assert.equal((await f.request(path,{method:'POST',headers})).status,404);
 }finally{await f.close()}
});

test('Position change creates a private notification, which can be marked read',async()=>{
 const f=setup({admin:true,position:'Владелец'});
 try {
  const {sessionCookie}=await login(f),headers={Cookie:sessionCookie};
  const {csrf}=await (await f.request('/api/auth/session',{headers})).json();
  const post={...headers,Origin:f.env.PUBLIC_URL,'X-CSRF-Token':csrf,'Content-Type':'application/json'};
  const member={nickname:'ModOther',discordId:'1572356030611067001',position:'Джуниор',realName:'Имя Фамилия',birthDate:'2000-01-01',telegramId:'88'};
  assert.equal((await f.request('/api/admin/moderators',{method:'POST',headers:post,body:JSON.stringify(member)})).status,201);
  const {id}=f.DB.raw.prepare("SELECT id FROM moderators WHERE nickname=?").get(member.nickname);
  assert.equal((await f.request(`/api/admin/moderators/${id}/edit`,{method:'POST',headers:post,body:JSON.stringify({...member,position:'Шериф'})})).status,200);
  const ownerData=await (await f.request('/api/notifications',{headers})).json();
  assert.deepEqual(ownerData.notifications,[]);
  const store=new Store(f.DB);
  const other=await store.upsertUser({provider:'telegram',providerId:'88',subject:'other',displayName:'Other'},{admins:{telegram:new Set()},staff:{telegram:new Set()}});
  const session=await store.createSession(other.id);
  const otherHeaders={Cookie:`__Host-journal_session=${session.token}`};
  const getNotes=async()=> (await (await f.request('/api/notifications',{headers:otherHeaders})).json()).notifications;
  const notes=await getNotes();
  assert.equal(notes.length,1);
  assert.match(notes[0].message,/Шериф/);
  assert.equal(notes[0].read_at,null);
  assert.equal((await f.request('/api/notifications/read',{method:'POST',headers:otherHeaders})).status,403);
  assert.equal((await f.request('/api/notifications/read',{method:'POST',headers:{...otherHeaders,Origin:f.env.PUBLIC_URL,'X-CSRF-Token':session.csrf}})).status,200);
  assert.notEqual((await getNotes())[0].read_at,null);
 }finally{await f.close()}
});
test('Manuals save multiple legacy images separately and protect access',async()=>{
 const f=setup({admin:true,position:'Владелец'});try{const l=await login(f),headers={Cookie:l.sessionCookie},me=await(await f.request('/api/auth/session',{headers})).json(),post={...headers,Origin:f.env.PUBLIC_URL,'X-CSRF-Token':me.csrf,'Content-Type':'application/json'};
 const large=Buffer.alloc(1048576,65).toString('base64'), tooLarge=Buffer.alloc(1048577,65).toString('base64');const manual={title:'Фото',description:'Описание',content:`![Фото](data:image/png;base64,${large})\n![Фото](data:image/png;base64,${large})`,allowedPositions:['Менеджер']};
 assert.equal((await f.request('/api/manuals',{method:'POST',headers:post,body:JSON.stringify(manual)})).status,201);const id=(await(await f.request('/api/manuals',{headers})).json()).manuals[0].id;const saved=(await(await f.request('/api/manuals/'+id,{headers})).json()).manual;const paths=[...saved.content.matchAll(/\/api\/manual-images\/[a-f0-9-]+/g)].map(x=>x[0]);assert.equal(paths.length,2);assert.ok(saved.content.length<300);const response=await f.request(paths[0],{headers});assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,1048576);assert.equal((await f.request(paths[0])).status,403);
 assert.equal((await f.request('/api/manuals/'+id,{method:'POST',headers:post,body:JSON.stringify({...manual,content:saved.content})})).status,200);assert.equal((await f.request(paths[1],{headers})).status,200);
 assert.equal((await f.request('/api/manuals/'+id,{method:'POST',headers:post,body:JSON.stringify({...manual,content:'Текст'})})).status,200);assert.equal((await f.request(paths[0],{headers})).status,404);
 assert.equal((await f.request('/api/manuals',{method:'POST',headers:post,body:JSON.stringify({...manual,content:`![Фото](data:image/png;base64,${tooLarge})`})})).status,201);
 }finally{await f.close()}
});
test('Chunked uploads handle images over 1 MB, link to a manual and enforce visibility',async()=>{
 const f=setup({admin:true,position:'Владелец'});try{const l=await login(f),headers={Cookie:l.sessionCookie},me=await(await f.request('/api/auth/session',{headers})).json(),post={...headers,Origin:f.env.PUBLIC_URL,'X-CSRF-Token':me.csrf,'Content-Type':'application/json'};
 const buffer=Buffer.alloc(524288*4+57,91);const request=(url,data)=>f.request(url,{method:'POST',headers:post,body:JSON.stringify(data)});
 const start=await request('/api/manual-images/start',{type:'image/png',size:buffer.length});assert.equal(start.status,201);const {id,chunkCount}=await start.json();assert.equal(chunkCount,5);
 assert.equal((await request(`/api/manual-images/${id}/finish`,{})).status,400);
 for(let index=0;index<chunkCount;index++){const data=buffer.subarray(index*524288,(index+1)*524288).toString('base64');assert.equal((await request(`/api/manual-images/${id}/chunk`,{index,data})).status,200)}
 assert.equal((await request(`/api/manual-images/${id}/finish`,{})).status,200);const path='/api/manual-images/'+id;const preview=await f.request(path,{headers});assert.deepEqual(Buffer.from(await preview.arrayBuffer()),buffer);assert.equal((await f.request(path)).status,403);
 const m={title:'Большое фото',description:'Проверка',content:`![Фото](${path})`,allowedPositions:['Менеджер']};assert.equal((await request('/api/manuals',m)).status,201);const manualId=(await(await f.request('/api/manuals',{headers})).json()).manuals[0].id;
 f.DB.raw.exec("UPDATE moderators SET position='Джуниор' WHERE id='actor'");assert.equal((await f.request(path,{headers})).status,404);f.DB.raw.exec("UPDATE moderators SET position='Владелец' WHERE id='actor'");
 assert.equal((await request('/api/manuals/'+manualId,{...m,content:'Без фото'})).status,200);assert.equal((await f.request(path,{headers})).status,404);
 }finally{await f.close()}
});
test('Managers manage staff warnings and reprimands; counts are private and survive restoration',async()=>{
 const f=setup({admin:true,position:'Владелец'});try{const l=await login(f),adminHeaders={Cookie:l.sessionCookie},me=await(await f.request('/api/auth/session',{headers:adminHeaders})).json(),post={...adminHeaders,Origin:f.env.PUBLIC_URL,'X-CSRF-Token':me.csrf,'Content-Type':'application/json'};
 const curator={nickname:'Curator',position:'Менеджер',realName:'Имя Менеджера',birthDate:'2000-01-01',vkId:'',telegramId:'42',staffSince:'2023-06-02'}, target={nickname:'Staffer',discordId:'1572356030611067001',position:'Саппорт',realName:'Имя Сотрудника',birthDate:'2000-01-01',vkId:'77',telegramId:'',staffSince:'2024-08-05'};
 f.DB.raw.prepare('INSERT INTO auth_users VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('target','vk','target','77','User','','','moderator','pending',now(),now());
 assert.equal((await f.request('/api/admin/moderators',{method:'POST',headers:post,body:JSON.stringify(target)})).status,201);
 f.DB.raw.prepare('UPDATE moderators SET nickname=?,position=?,staff_since=? WHERE id=?').run(curator.nickname,curator.position,curator.staffSince,'actor');
 const moderators=(await(await f.request('/api/admin/moderators',{headers:adminHeaders})).json()).moderators,targetId=moderators.find(x=>x.nickname==='Staffer').id;
 let session=await(await f.request('/api/auth/session',{headers:adminHeaders})).json();assert.equal(session.user.position,'Менеджер');assert.equal(session.user.staffSince,'2023-06-02');
 const store=new Store(f.DB),other=await store.createSession('target'),otherHeaders={Cookie:`${f.env.PUBLIC_URL.startsWith('https:')?'__Host-journal_session':'journal_session'}=${other.token}`},otherPost={...otherHeaders,Origin:f.env.PUBLIC_URL,'X-CSRF-Token':other.csrf,'Content-Type':'application/json'};

 assert.equal((await f.request('/api/staff-sanctions',{headers:otherHeaders})).status,403);assert.equal((await f.request('/api/staff-sanctions',{method:'POST',headers:otherPost,body:JSON.stringify({moderatorId:targetId,type:'warning',reason:'Причина'})})).status,403);
 assert.equal((await f.request('/api/staff-sanctions',{method:'POST',headers:post,body:JSON.stringify({moderatorId:targetId,type:'warning',reason:'Опоздание'})})).status,201);
 assert.equal((await f.request('/api/staff-sanctions',{method:'POST',headers:post,body:JSON.stringify({moderatorId:targetId,type:'reprimand',reason:'Нарушение'})})).status,201);
 assert.deepEqual((await(await f.request('/api/me/sanctions',{headers:otherHeaders})).json()).sanctions,{warnings:1,reprimands:1});assert.equal((await(await f.request('/api/notifications',{headers:otherHeaders})).json()).notifications.length,2);
 const all=(await(await f.request('/api/staff-sanctions',{headers:adminHeaders})).json()).sanctions;const warning=all.find(x=>x.type==='warning');assert.equal((await f.request(`/api/staff-sanctions/${warning.id}/revoke`,{method:'POST',headers:post,body:'{}'})).status,200);assert.deepEqual((await(await f.request('/api/me/sanctions',{headers:otherHeaders})).json()).sanctions,{warnings:0,reprimands:1});
 assert.equal((await f.request(`/api/admin/moderators/${targetId}/remove`,{method:'POST',headers:post,body:JSON.stringify({reason:'Ушёл'})})).status,200);const former=(await(await f.request('/api/admin/former-moderators',{headers:adminHeaders})).json()).moderators[0];assert.equal(former.staff_since,'2024-08-05');assert.equal((await f.request(`/api/admin/former-moderators/${former.id}/restore`,{method:'POST',headers:post,body:'{}'})).status,200);
 const reauth=await store.createSession('target'),targetHeaders={Cookie:`__Host-journal_session=${reauth.token}`};assert.deepEqual((await(await f.request('/api/me/sanctions',{headers:targetHeaders})).json()).sanctions,{warnings:0,reprimands:1});assert.equal((await(await f.request('/api/auth/session',{headers:targetHeaders})).json()).user.staffSince,'2024-08-05');
 }finally{await f.close()}
});

test('Server sync requires its secret; validates records, upserts, filters and restricts history to staff',async()=>{
 const f=setup({admin:true});try{
  f.env.SERVER_SYNC_TOKEN='a'.repeat(64);
  const row={id:'ban-1',player:'Player_One',player_uuid:'p',moderator:'ModOne',moderator_uuid:'m',reason:'Test',started:1000,ended:2000,type:'ban',result:'',active:1,removed_by:''};
  const send=(body,token=f.env.SERVER_SYNC_TOKEN)=>f.request('/api/server/sync',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
  assert.equal((await send({kind:'punishments',records:[row]},'wrong')).status,401);
  assert.equal((await send({kind:'other',records:[]})).status,400);
  assert.equal((await send({kind:'punishments',records:[{...row,started:-1}]})).status,400);
  assert.equal((await send({kind:'punishments',records:[row]})).status,200);
  assert.equal((await send({kind:'punishments',records:[{...row,active:0}]})).status,200);
  assert.equal((await f.request('/api/server/punishments')).status,404);
  const l=await login(f),headers={Cookie:l.sessionCookie};
  let data;assert.equal(f.DB.raw.prepare("SELECT active FROM server_punishments WHERE id='ban-1'").get().active,0);
  assert.equal((await send({kind:'checks',records:[{...row,id:'check-1',type:'check',result:'бан: Test'}]})).status,200);
  f.DB.raw.exec("INSERT INTO moderators (id,nickname,position,real_name,birth_date,telegram_id,created_at,created_by) VALUES ('mod','ModOne','Администратор','Test','2000-01-01','42',1,'test')");
  data=await(await f.request('/api/server/checks',{headers})).json();assert.equal(data.items[0].result,'бан: Test');assert.equal(data.items[0].ban_reason,'Test');
 }finally{await f.close()}
});

test('All roles see only their own checks; player history requires an exact name; reset cutoff rejects replayed history',async()=>{
 const f=setup({admin:true});try{
  f.env.SERVER_SYNC_TOKEN='b'.repeat(64);
  const row={id:'check-own',player:'Target',player_uuid:'p',moderator:'OwnMod',moderator_uuid:'m',reason:'Reason',started:1000,ended:2000,type:'check',result:'завершена',active:0,removed_by:''};
  const sync=(kind,records)=>f.request('/api/server/sync',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+f.env.SERVER_SYNC_TOKEN},body:JSON.stringify({kind,records})});
  assert.equal((await sync('checks',[row,{...row,id:'check-other',moderator:'OtherMod'}])).status,200);
  assert.equal((await sync('punishments',[{...row,id:'ban-1',type:'ban'}])).status,200);
  const l=await login(f),headers={Cookie:l.sessionCookie},get=async path=>(await f.request(path,{headers})).json();
  assert.equal((await get('/api/server/checks')).total,0); // Even an admin needs a linked roster nickname.
  f.DB.raw.exec("INSERT INTO moderators (id,nickname,position,real_name,birth_date,telegram_id,created_at,created_by) VALUES ('mod','OwnMod','Администратор','Test','2000-01-01','42',1,'test')");
  for(const role of ['admin','moderator']){
   f.DB.raw.prepare('UPDATE auth_users SET role=?').run(role);
   const d=await get('/api/server/checks?moderator=OtherMod');assert.equal(d.total,1);assert.equal(d.items[0].moderator,'OwnMod');
  }
  f.DB.raw.exec("INSERT INTO server_retention VALUES ('checks',3000),('punishments',3000); DELETE FROM server_checks; DELETE FROM server_punishments;");
  for(const kind of ['checks','punishments'])assert.equal((await sync(kind,[{...row,id:'replayed',type:kind==='checks'?'check':'ban'},{...row,id:'boundary',started:3000,type:'check'},{...row,id:'new',started:4000,ended:5000,type:kind==='checks'?'check':'ban'}])).status,200);
  assert.equal(f.DB.raw.prepare('SELECT COUNT(*) AS n FROM server_checks WHERE started<=3000').get().n,0);
  const summary=await get('/api/server/summary');assert.equal(summary.checks,1);assert.equal(summary.punishments,1);
  const moscowMidnight=Math.floor((Date.now()+10800000)/86400000)*86400000-10800000;
  const punishment=(id,type,started,moderator='ownmod')=>({...row,id,type,started,moderator,ended:0});
  assert.equal((await sync('punishments',[
    punishment('ban-yesterday','ban',moscowMidnight-1),
    punishment('mute-today','mute',moscowMidnight),
    punishment('kick-today','kick',moscowMidnight),
    punishment('warn-today','warn',moscowMidnight),
    punishment('ban-other','ban',moscowMidnight,'OtherMod'),
  ])).status,200);
  const activity=await get('/api/server/summary');
  assert.equal(activity.punishmentsToday,3);
  assert.equal(activity.banMuteToday,1);
  assert.equal(activity.banMuteTotal,3);
  assert.equal(activity.checks,1);
 }finally{await f.close()}
});

test('Leaderboard exposes only active staff and their case-insensitive activity totals',async()=>{
 const f=setup({position:'Джуниор'});
 try{
  const path='/api/server/leaderboard';
  assert.equal((await f.request(path)).status,403);
  f.DB.raw.prepare("UPDATE moderators SET nickname='1pirs' WHERE id='actor'").run();
  f.DB.raw.prepare('INSERT INTO moderators (id,nickname,position,real_name,birth_date,created_at,created_by) VALUES (?,?,?,?,?,?,?)')
    .run('staff-2','OtherStaff','Саппорт','Private name','2000-01-01',1,'test');
  const insert=(kind,id,moderator,type)=>f.DB.raw.prepare(`INSERT INTO server_${kind} VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id,'PrivatePlayer','private-uuid',moderator,'moderator-uuid','Private reason',1,2,'',type,0,'');
  insert('checks','a','1PIRS','check');
  insert('checks','b','1pirs','check');
  insert('checks','c','FormerStaff','check');
  insert('punishments','d','1PIRS','ban');
  insert('punishments','e','1pirs','mute');
  insert('punishments','f','1pirs','warn');
  f.DB.raw.prepare("INSERT INTO server_sync VALUES ('checks',1),('punishments',1)").run();
  const l=await login(f);
  const request=await f.request(path,{headers:{Cookie:l.sessionCookie}});
  assert.equal(request.status,200);
  const {staff,synced}=await request.json();
  assert.deepEqual(staff,[
    {id:'actor',nickname:'1pirs',position:'Джуниор',checks:2,punishments:3},
    {id:'staff-2',nickname:'OtherStaff',position:'Саппорт',checks:0,punishments:0},
  ]);
  assert.deepEqual(synced.sort(),['checks','punishments']);
 }finally{await f.close()}
});

test('Staff controls separate monthly activity, personal notifications, position history and action logs',async()=>{
 const f=setup({position:'Владелец'});
 try{
  const l=await login(f),owner={Cookie:l.sessionCookie};
  const {csrf}=await(await f.request('/api/auth/session',{headers:owner})).json();
  const localMonth=new Date(Date.now()+10800000);
  const month=Date.UTC(localMonth.getUTCFullYear(),localMonth.getUTCMonth(),1)-10800000;
  f.DB.raw.prepare("INSERT INTO moderators (id,nickname,position,real_name,birth_date,telegram_id,created_at,created_by) VALUES ('member','TestMember','Спектатор','Name','2000-01-01','88',1,'test')").run();
  f.DB.raw.prepare('INSERT INTO auth_users VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('staff-user','telegram','sub','88','Name','','','moderator','active',now(),now());
  const session=await new Store(f.DB).createSession('staff-user');
  const member={Cookie:`__Host-journal_session=${session.token}`};
  const bodyHeaders={Origin:f.env.PUBLIC_URL,'Content-Type':'application/json'};
  const post=(path,body,headers=owner,token=csrf)=>f.request(path,{method:'POST',headers:{...headers,...bodyHeaders,'X-CSRF-Token':token},body:JSON.stringify(body)});
  const get=async(path,headers=owner)=>(await f.request(path,{headers})).json();
  const notifications=f.DB.raw.prepare('INSERT INTO journal_notifications (id,moderator_id,message,created_at) VALUES (?,?,?,?)');
  notifications.run('promotion','member','Должность изменена: Саппорт → Спектатор. Изменил: Owner.',now());
  notifications.run('other','actor','Другое уведомление',now());
  const checks=f.DB.raw.prepare("INSERT INTO server_checks VALUES (?,'Player','uuid','TESTMEMBER','staff-uuid','Reason',?,0,'','check',0,'')");
  checks.run('old',month-1);
  checks.run('new',month);
  const profile='/api/staff/member/profile';
  assert.equal((await post(profile+'/activity',{checks:12,punishments:8},member,session.csrf)).status,403);
  assert.equal((await post(profile+'/activity',{checks:-1,punishments:8})).status,400);
  assert.equal((await post(profile+'/activity',{checks:12,punishments:8})).status,200);
  assert.equal((await get(profile)).activity.checks,12);
  assert.equal((await get('/api/server/summary',member)).punishments,8);
  checks.run('later',month+1);
  assert.equal((await get('/api/server/leaderboard?period=all')).staff.find(row=>row.id==='member').checks,13);
  assert.equal((await get('/api/server/leaderboard?period=month')).staff.find(row=>row.id==='member').checks,2);
  assert.equal((await post('/api/notifications/clear',{},member,session.csrf)).status,200);
  assert.deepEqual((await get('/api/notifications',member)).notifications,[]);
  assert.equal((await get('/api/notifications')).notifications.length,1);
  assert.equal((await get('/api/me/profile',member)).positions.length,1);
  assert.equal((await post(profile+'/clear-positions',{})).status,200);
  assert.deepEqual((await get('/api/me/profile',member)).positions,[]);
  notifications.run('later-promotion','member','Должность изменена: Спектатор → Менеджер. Изменил: Owner.',now());
  assert.equal((await get('/api/me/profile',member)).positions.length,1);
  assert.equal((await get('/api/notifications',member)).notifications.length,1);
  const store=new Store(f.DB);
  await store.audit('staff-user','moderator_edited','member');
  assert.equal((await get('/api/action-logs?actor=member')).entries.length,1);
  const today=new Date(Date.now()+10800000).toISOString().slice(0,10);
  await store.audit('staff-user','moderator_added','member');
  f.DB.raw.prepare("UPDATE auth_audit SET created_at=1 WHERE actor_id='staff-user' AND action='moderator_added'").run();
  assert.equal((await post(profile+'/clear-logs',{period:'custom',from:today,to:today})).status,200);
  assert.deepEqual((await get('/api/action-logs?actor=member')).entries.map(row=>row.action),['moderator_added']);
  f.DB.raw.prepare("UPDATE moderators SET position='Младший Администратор' WHERE id='actor'").run();
  assert.equal((await post(profile+'/activity',{checks:99,punishments:99})).status,403);
  assert.equal((await post(profile+'/clear-positions',{period:'today'})).status,200);
  assert.equal((await post(profile+'/clear-activity',{})).status,200);
  assert.equal((await get(profile)).activity.checks,0);
  assert.equal((await get(profile)).activity.punishments,0);
  assert.equal((await get('/api/server/leaderboard?period=month')).staff.find(row=>row.id==='member').checks,0);
  assert.equal((await get('/api/server/leaderboard?period=all')).staff.find(row=>row.id==='member').checks,0);
  assert.equal((await get('/api/server/checks',member)).total,0);
  checks.run('after-reset',Date.now()+1);
  assert.equal((await get(profile)).activity.checks,1);
  f.DB.raw.prepare("UPDATE moderators SET position='Владелец' WHERE id='actor'").run();
  assert.equal((await post(profile+'/clear-logs',{})).status,200);
  assert.deepEqual((await get('/api/action-logs?actor=member')).entries,[]);
  assert.equal(f.DB.raw.prepare("SELECT COUNT(*) AS n FROM auth_audit WHERE actor_id='staff-user' AND action='moderator_edited'").get().n,1);
  await store.audit('staff-user','moderator_edited','member');
  assert.equal((await get('/api/action-logs?actor=member')).entries.length,1);
 }finally{await f.close()}
});

test('Game check events retain history; only managers and above can search staff checks',async()=>{
 const f=setup({position:'Саппорт'});
 try{
  f.env.CHECK_BRIDGE_TOKEN='b'.repeat(64);
  f.DB.raw.exec("UPDATE moderators SET nickname='FirstMod' WHERE id='actor'");
  const session=await login(f);
  const headers={Cookie:session.sessionCookie};
  const bridge=(data,token=f.env.CHECK_BRIDGE_TOKEN)=>f.request('/api/check-bridge',{
    method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(data),
  });
  assert.equal((await bridge({op:'poll'},'wrong')).status,403);
  assert.deepEqual(await(await bridge({op:'poll'})).json(),{jobs:[]});
  assert.equal((await f.request('/api/work/checks',{method:'POST',headers,body:'{}'})).status,404);
  assert.equal((await f.request('/api/server/staff-checks')).status,403);
  assert.equal((await f.request('/api/server/staff-checks',{headers})).status,403);
  const started=Date.now()-1000, ended=started+500;
  const first={id:'fastfreeze-first',player:'TestPlayer',moderator:'FirstMod',reason:'Жалоба',started,ended:0,result:'На проверке',active:1,type:'check'};
  const second={...first,id:'fastfreeze-second',moderator:'SecondMod',player:'OtherPlayer'};
  const sync=records=>bridge({op:'sync',kind:'checks',records});
  assert.equal((await sync([first,second])).status,200);
  assert.equal((await sync([{...first,ended,result:'Отпущен',active:0,removed_by:'OtherModerator'}])).status,200);
  assert.equal((await sync([first])).status,200);
  const read=async path=>(await f.request(path,{headers})).json();
  const today=new Date(Date.now()+10800000).toISOString().slice(0,10);
  const personal=await read('/api/server/checks?player=test&reason='+encodeURIComponent('Жалоба')+'&from='+today+'&to='+today);
  assert.equal(personal.total,1);
  assert.equal(personal.items[0].started,started);
  assert.equal(personal.items[0].ended,ended);
  assert.equal(personal.items[0].result,'Отпущен');
  assert.equal(personal.items[0].removed_by,'OtherModerator');
  assert.equal((await read('/api/server/summary')).checks,1);
  assert.equal((await read('/api/server/leaderboard?period=month')).staff[0].checks,1);
  f.DB.raw.exec("UPDATE moderators SET position='Спектатор' WHERE id='actor'");
  assert.equal((await f.request('/api/server/staff-checks',{headers})).status,403);
  f.DB.raw.exec("UPDATE moderators SET position='Менеджер' WHERE id='actor'");
  assert.equal((await read('/api/server/staff-checks')).total,2);
  assert.equal((await read('/api/server/checks?moderator=SecondMod')).total,1);
  assert.equal((await read('/api/server/staff-checks?moderator=SECOND')).items[0].player,'OtherPlayer');
  assert.equal((await read('/api/server/staff-checks?player=TEST')).items[0].moderator,'FirstMod');
  assert.equal((await read('/api/server/staff-checks?player=TEST&moderator=SECOND')).total,0);
 }finally{await f.close();}
});

test('Personal profile only returns history for the signed-in staff member',async()=>{
  const f=setup({admin:true});
  try {
    assert.equal((await f.request('/api/me/profile')).status,403);
    const session=await login(f);
    f.DB.raw.exec(`
      INSERT INTO moderators (id,nickname,position,real_name,birth_date,telegram_id,created_at,created_by)
      VALUES ('mine','TestMod','Шериф','Test','2000-01-01','42',1,'test');
      INSERT INTO journal_notifications (id,moderator_id,message,created_at) VALUES
        ('mine-change','mine','Должность изменена: Джуниор → Шериф. Изменил: Owner.',1),
        ('other-change','different','Должность изменена: Джуниор → Шериф. Изменил: Owner.',1),
        ('mine-note','mine','Другое уведомление',1);
      INSERT INTO staff_sanctions (id,moderator_id,moderator_name,type,reason,issued_by,issued_by_name,issued_at)
      VALUES ('mine-warning','mine','TestMod','warning','Причина','owner','Owner',1),
             ('other-warning','different','OtherMod','warning','Причина','owner','Owner',1);
    `);
    const res=await f.request('/api/me/profile?moderatorId=different',{headers:{Cookie:session.sessionCookie}});
    assert.equal(res.status,200);
    const profile=await res.json();
    assert.deepEqual(profile.positions.map(item=>item.id),['mine-change']);
    assert.deepEqual(profile.sanctions.map(item=>item.id),['mine-warning']);
    f.DB.raw.exec(`INSERT INTO moderators (id,nickname,position,real_name,birth_date,created_at,created_by)
      VALUES ('different','OtherMod','Джуниор','Other','2000-01-01',1,'test');
      UPDATE moderators SET position='Джуниор' WHERE id='actor';`);
    const target=()=>f.request('/api/staff/different/profile',{headers:{Cookie:session.sessionCookie}});
    assert.equal((await target()).status,403);
    f.DB.raw.exec("UPDATE moderators SET position='Спектатор' WHERE id='mine'");
    const targetResponse=await target();
    assert.equal(targetResponse.status,200);
    const other=await targetResponse.json();
    assert.equal(other.member.nickname,'OtherMod');
    assert.deepEqual(other.history.sanctions.map(item=>item.id),['other-warning']);
    assert.deepEqual(other.history.positions.map(item=>item.id),['other-change']);
    assert.equal((await f.request('/api/admin/moderators',{headers:{Cookie:session.sessionCookie}})).status,403);

  } finally { await f.close(); }
});

test('Action logs group linked logins by active staff and exclude historical forms',async()=>{
 const f=setup({admin:true});
 try{
  const {sessionCookie}=await login(f);
  const headers={Cookie:sessionCookie};
  const me=await (await f.request('/api/auth/session',{headers})).json();
  f.DB.raw.exec(`
    INSERT INTO moderators (id,nickname,position,real_name,birth_date,vk_id,telegram_id,created_at,created_by)
      VALUES ('staff','Mod','Администратор','Test','2000-01-01','77','42',1,'test');
    INSERT INTO auth_users VALUES ('alt','vk','alt','77','ModAlt','','','moderator','active',1,1);
    INSERT INTO auth_users VALUES ('unlinked','vk','unlinked','78','Former','','','moderator','active',1,1);
    INSERT INTO auth_audit (id,actor_id,action,created_at) VALUES
      ('a1','alt','staff_sanction_revoked',1),('a2','unlinked','logout',1),('a3','alt','ban_form_created',1);
  `);
  const res=await f.request('/api/action-logs?actor=staff',{headers});
  assert.equal(res.status,200);
  const log=await res.json();
  assert.deepEqual(log.actors.map(actor=>actor.name),['Mod']);
  assert.deepEqual(log.entries.map(row=>row.action),['staff_sanction_revoked','login:telegram']);
  assert.ok(log.entries.every(row=>row.actor==='Mod'));
  const former=await (await f.request('/api/action-logs?actor=unlinked',{headers})).json();
  assert.deepEqual(former.entries,[]);
  f.DB.raw.prepare("UPDATE auth_users SET role='admin' WHERE id=?").run(me.user.id);
  f.DB.raw.exec("UPDATE moderators SET position='Саппорт' WHERE id='staff'");
  assert.equal((await f.request('/api/action-logs',{headers})).status,403);
 }finally{await f.close()}
});

test('Rank limits apply to management, appointments, and sanctions',async()=>{
 const f=setup({admin:true,position:'Менеджер'});
 try {
  const {sessionCookie}=await login(f),headers={Cookie:sessionCookie};
  const {csrf}=await (await f.request('/api/auth/session',{headers})).json();
  const request=(path,body)=>f.request(path,{method:'POST',headers:{...headers,Origin:f.env.PUBLIC_URL,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const setPosition=f.DB.raw.prepare('UPDATE moderators SET position=? WHERE id=?');
  f.DB.raw.exec(`INSERT INTO moderators (id,nickname,position,real_name,birth_date,telegram_id,created_at,created_by)
    VALUES ('target','Target','Джуниор','Test','2000-01-01','99',1,'test');`);
  const change=(position,id='target')=>request('/api/staff/'+id+'/position',{position});
  const issue=(type,id='target')=>request('/api/staff-sanctions',{moderatorId:id,type,reason:'Проверка иммунитета'});
  assert.equal((await f.request('/api/admin/moderators',{headers})).status,200);
  for(const position of ['Менеджер','Спектатор','Младший Администратор']) assert.equal((await change(position)).status,403);
  assert.equal((await change('Саппорт')).status,200);
  assert.equal((await change('Саппорт','actor')).status,403);
  assert.equal((await issue('warning','actor')).status,403);
  setPosition.run('Менеджер','target');
  assert.equal((await issue('reprimand')).status,403);
  setPosition.run('Спектатор','target');
  assert.equal((await issue('warning')).status,201);
  setPosition.run('Спектатор','actor');
  assert.equal((await f.request('/api/admin/moderators',{headers})).status,403);
  assert.equal((await f.request('/api/action-logs',{headers})).status,200);
  assert.equal((await f.request('/api/staff/target/profile',{headers})).status,200);
  assert.equal((await issue('warning')).status,403);
  setPosition.run('Младший Администратор','actor');
  assert.equal((await change('Менеджер')).status,200);
  assert.equal((await change('Спектатор')).status,200);
  assert.equal((await change('Младший Администратор')).status,403);
  setPosition.run('Администратор','actor');
  assert.equal((await change('Младший Администратор')).status,403);
  setPosition.run('Владелец','actor');
  assert.equal((await change('Младший Администратор')).status,200);
  for(const position of ['Младший Администратор','Администратор','Владелец']){
    setPosition.run(position,'target');
    for(const type of ['warning','reprimand']) assert.equal((await issue(type)).status,403);
    const {history}=await (await f.request('/api/staff/target/profile',{headers})).json();
    assert.deepEqual(history.sanctions,[]);
  }
  assert.equal((await change('Владелец')).status,403);
  assert.equal((await change('Джуниор')).status,403);
  setPosition.run('Администратор','actor');
  assert.equal((await request('/api/admin/moderators/target/remove',{reason:'Проверка'})).status,403);
  setPosition.run('Владелец','actor');
  const staff={nickname:'ThirdOwner',discordId:'1572356030611067001',position:'Владелец',realName:'Test Name',birthDate:'2000-01-01',vkId:'123'};
  assert.equal((await request('/api/admin/moderators',staff)).status,403);
  assert.equal((await request('/api/admin/moderators',{...staff,position:'Джуниор'})).status,201);
  assert.throws(()=>f.DB.raw.exec("UPDATE moderators SET position='Владелец' WHERE nickname='ThirdOwner'"),/OWNER_LIMIT/);
 }finally{await f.close()}
});

test('Profile banners are personal, persistent and restricted by the current position',async()=>{
 const f=setup({position:'Спектатор'});
 try {
  const {sessionCookie}=await login(f),headers={Cookie:sessionCookie};
  const session=async()=> (await (await f.request('/api/auth/session',{headers})).json());
  const {csrf}=await session();
  const post={...headers,Origin:f.env.PUBLIC_URL,'X-CSRF-Token':csrf,'Content-Type':'application/json'};
  const save=(banner,requestHeaders=post)=>f.request('/api/me/profile/banner',{method:'POST',headers:requestHeaders,body:JSON.stringify({banner,moderatorId:'another'})});
  const view=async()=> (await (await f.request('/api/staff/actor/profile',{headers})).json()).member.profile_banner;
  assert.equal((await session()).user.canSetProfileBanner,true);
  assert.equal((await save('forest',headers)).status,403);
  assert.equal((await save('unknown')).status,400);
  assert.equal((await save('blood')).status,403);
  assert.equal((await save('city')).status,200);
  assert.equal((await session()).user.profileBanner,'city');
  assert.equal(await view(),'city');
  f.DB.raw.exec("UPDATE moderators SET position='Владелец' WHERE id='actor'");
  assert.equal((await save('blood')).status,200);
  assert.equal(await view(),'blood');
  f.DB.raw.exec("UPDATE moderators SET position='Спектатор' WHERE id='actor'");
  assert.equal((await session()).user.profileBanner,null);
  assert.equal(await view(),null);
  assert.equal((await save(null)).status,200);
  assert.equal(f.DB.raw.prepare("SELECT profile_banner FROM moderators WHERE id='actor'").get().profile_banner,null);
 }finally{await f.close()}
});

test('Removing staff logs the actor in Discord and only junior administrators or above can delete the archive record',async t=>{
 const f=setup({position:'Менеджер'});
 const {discordLog,discordRosterChannel}=await import('../worker/discord.mjs');
 const messages=[];
 t.mock.method(globalThis,'fetch',async (url,options)=>{
   if(url.endsWith(`/channels/${discordLog}/messages`))messages.push(JSON.parse(options.body));
   else if(url.endsWith('/applications/@me'))return Response.json({id:'1572356030611067118'});
   else if(url.endsWith('/applications/1572356030611067118/emojis'))return Response.json({items:[],id:'1572356030611067119'});
   else if(url.endsWith('/channels/'+discordRosterChannel))return Response.json({guild_id:'1543584416889176134',type:0});
   else if(url.endsWith('/channels/'+discordRosterChannel+'/messages?limit=50'))return Response.json([]);
   else if(url.endsWith('/users/@me'))return Response.json({id:'1572356030611067118'});
   else if(url.endsWith('/channels/'+discordRosterChannel+'/messages'))return Response.json({id:'1572356030611067120'});
   else if(url.startsWith('https://mc-heads.net/'))return new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':'image/png'}});
   return Response.json({id:'discord-log'},{status:201});
 });
 try{
  const l=await login(f),headers={Cookie:l.sessionCookie};
  const {csrf}=await(await f.request('/api/auth/session',{headers})).json();
  const mutate={method:'POST',headers:{...headers,Origin:f.env.PUBLIC_URL,'X-CSRF-Token':csrf,'Content-Type':'application/json'}};
  f.env.DISCORD_BOT_TOKEN='fake';
  f.DB.raw.exec("UPDATE moderators SET nickname='Remover' WHERE id='actor'");
  const insert=f.DB.raw.prepare('INSERT INTO moderators (id,nickname,position,real_name,birth_date,telegram_id,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)');
  insert.run('remove','FormerStaff','Шериф','Test Name','2000-01-01','88',1,'test');
  assert.equal((await f.request('/api/admin/moderators/remove/remove',{...mutate,body:JSON.stringify({reason:'Покинул команду'})})).status,200);
  assert.equal(messages.length,1);
  assert.match(messages[0].embeds[0].description,/Сотрудник: \*\*FormerStaff\*\*/);
  assert.match(messages[0].embeds[0].description,/Кто снял: \*\*Remover\*\*/);
  const {moderators:[record]}=await(await f.request('/api/admin/former-moderators',{headers})).json();
  const route=`/api/admin/former-moderators/${record.id}/delete`;
  assert.equal((await f.request(route,mutate)).status,403);
  f.DB.raw.exec("UPDATE moderators SET position='Младший Администратор' WHERE id='actor'");
  assert.equal((await f.request(route,{method:'POST',headers})).status,403);
  assert.equal((await f.request(route,mutate)).status,200);
  assert.equal((await f.request(route,mutate)).status,404);
  assert.deepEqual((await(await f.request('/api/admin/former-moderators',{headers})).json()).moderators,[]);
  assert.equal(f.DB.raw.prepare("SELECT COUNT(*) AS n FROM auth_audit WHERE action='former_record_deleted'").get().n,1);
  assert.equal((await f.request(`/api/admin/former-moderators/${record.id}/restore`,mutate)).status,404);
 }finally{await f.close()}
});

test('Discord roster creates one panel and edits it after a promotion and removal',async t=>{
 const DB=d1();
 const {discordRosterChannel,refreshDiscordRoster,rosterPayload}=await import('../worker/discord-roster.mjs');
 const {discordGuild}=await import('../worker/discord.mjs');
 const botId='1572356030611067123',messageId='1572356030611067124';
 const route='/channels/'+discordRosterChannel, writes=[],emojis=new Set();
 const env={DB,DISCORD_BOT_TOKEN:'fake'};
 let next=1572356030611067125n,created=0,posted=null,uploads=0;
 const bytes=new Uint8Array([137,80,78,71]);
 const save=async options=>{
   assert.ok(options.body instanceof FormData);
   const payload=JSON.parse(options.body.get('payload_json'));
   const file=options.body.get('files[0]');
   assert.deepEqual(new Uint8Array(await file.arrayBuffer()),bytes);
   assert.deepEqual(payload.attachments,[{id:0,filename:file.name}]);
   writes.push(payload);
   uploads++;
   const url='https://cdn.discordapp.com/attachments/'+discordRosterChannel+'/'+String(next++)+'/'+file.name+'?signed=1';
   posted={id:messageId,attachments:[],embeds:[{...payload.embeds[0],image:{url}},...payload.embeds.slice(1)]};
   return Response.json(posted);
 };
 t.mock.method(globalThis,'fetch',async(url,options)=>{
   const path=new URL(url).pathname.replace('/api/v10',''),method=options?.method;
   if(url.startsWith('https://mc-heads.net/'))return new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':'image/png'}});
   if(path==='/applications/@me'||path==='/users/@me')return Response.json({id:botId});
   if(path==='/applications/'+botId+'/emojis'){
     if(method==='GET')return Response.json({items:[]});
     const asset=JSON.parse(options.body);
     assert.match(asset.image,/^data:image\/png;base64,/);
     assert.ok(!emojis.has(asset.name));
     emojis.add(asset.name);
     return Response.json({id:String(next++)});
   }
   if(path===route)return Response.json({guild_id:discordGuild,type:0});
   if(path===route+'/messages'&&method==='GET')return Response.json([]);
   if(path===route+'/messages'&&method==='POST'){created++;return save(options);}
   if(path===route+'/messages/'+messageId&&method==='GET')return Response.json(posted);
   if(path===route+'/messages/'+messageId&&method==='PATCH')return save(options);
   throw Error('Unexpected Discord request');
 });
 try{
   const add=DB.raw.prepare("INSERT INTO moderators (id,nickname,position,real_name,birth_date,telegram_id,created_at,created_by) VALUES (?,?,?,'Test Name','2000-01-01',?,1,'test')");
   add.run('a','1pirs','Владелец','1');add.run('b','Cvasolir','Администратор','2');add.run('c','Test_Member','Шериф','3');
   await Promise.all([refreshDiscordRoster(env,bytes),refreshDiscordRoster(env,bytes)]);
   assert.equal(created,1);
   assert.equal(emojis.size,11);
   assert.equal(writes[0].embeds.length,4);
   const styled=rosterPayload([{nickname:'ExampleAdmin',position:'Младший Администратор'}],new Map());
   assert.equal(styled.embeds[0].author,undefined);
   assert.match(styled.embeds[0].image.url,/^attachment:\/\/jevox-team-153c5885[.]png$/);
   assert.equal(styled.embeds[1].color,0xf4cf58);
   assert.match(writes[0].embeds[1].description,/<:jhead_1pirs:[0-9]+> \*\*1pirs\*\*/);
   assert.match(writes[0].embeds[2].description,/<:jhead_cvasolir:[0-9]+>/);
   assert.match(writes[0].embeds[3].description,/<:jhead_test_member:[0-9]+>/);
   assert.equal(writes[0].allowed_mentions.parse.length,0);
   await refreshDiscordRoster(env,bytes);
   assert.equal(writes.length,1);
   DB.raw.exec("UPDATE moderators SET position='Саппорт' WHERE id='c'; DELETE FROM moderators WHERE id='b';");
   await refreshDiscordRoster(env,bytes);
   assert.equal(created,1);
   assert.equal(writes.length,2);
   assert.equal(emojis.size,11);
   assert.match(writes[1].embeds[2].title,/Саппорт/);
   assert.ok(!JSON.stringify(writes[1]).includes('Cvasolir'));
   assert.equal(DB.raw.prepare('SELECT message_id FROM discord_roster_board WHERE id=1').get().message_id,messageId);
   assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM discord_roster_notices').get().n,0);
   assert.equal(uploads,2);
   posted.embeds[0].image.url='https://example.com/old-banner.png';
   DB.raw.exec('UPDATE discord_roster_board SET verified_at=0');
   await refreshDiscordRoster(env,bytes);
   assert.equal(uploads,3);
   assert.equal(created,1);
   assert.match(posted.embeds[0].image.url,/jevox-team-153c5885[.]png/);
   const huge=rosterPayload(Array.from({length:900},(_,i)=>({nickname:'Moderator_'+i,position:i<450?'Владелец':'Джуниор'})),new Map());
   assert.ok(huge.embeds.every(embed=>(embed.description?.length??0)<=4096));
   assert.ok(huge.embeds.reduce((sum,entry)=>sum+(entry.title?.length??0)+(entry.description?.length??0)+(entry.author?.name.length??0)+(entry.footer?.text.length??0),0)<=6000);
 }finally{DB.raw.close();}
});

test('Discord role sync replaces the previous staff role and preserves unrelated roles',async t=>{
 const f=setup({position:'Менеджер'});
 const {discordRoles,drainDiscordJobs}=await import('../worker/discord.mjs');
 const discordId='1572356030611067099',unrelated='1572356030611067088';
 const roles=[unrelated,discordRoles['Шериф']];
 const messages=[];
 t.mock.method(globalThis,'fetch',async (url,request)=>{
   const path=new URL(url).pathname;
   if(request.method==='GET')return Response.json({roles,nick:'User <test>'});
   if(request.method==='DELETE'){roles.splice(roles.indexOf(path.split('/').at(-1)),1);return new Response(null,{status:204});}
   if(request.method==='PUT'){roles.push(path.split('/').at(-1));return new Response(null,{status:204});}
   messages.push(JSON.parse(request.body));return Response.json({id:'discord-log'},{status:201});
 });
 try {
  f.env.DISCORD_BOT_TOKEN='fake';
  f.DB.raw.prepare("UPDATE moderators SET discord_id=?,position='Шериф' WHERE id='actor'").run(discordId);
  f.DB.raw.exec("UPDATE moderators SET position='Саппорт' WHERE id='actor'");
  const result=await drainDiscordJobs(f.env);
  assert.equal(result.updated,1);
  assert.deepEqual(roles,[unrelated,discordRoles['Саппорт']]);
  assert.equal(messages.length,2);
  assert.deepEqual(messages[0].allowed_mentions,{parse:[]});
  assert.equal(f.DB.raw.prepare('SELECT COUNT(*) AS count FROM discord_role_jobs').get().count,0);
 }finally{await f.close()}
});

test('Discord interaction rejects invalid signatures and limits sync to the owner role',async()=>{
 const {discordInteraction,discordGuild}=await import('../worker/discord.mjs');
 const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
 const env={DISCORD_PUBLIC_KEY:Buffer.from(await crypto.subtle.exportKey('raw',keys.publicKey)).toString('hex')};
 const makeRequest=async payload=>{
  const body=JSON.stringify(payload),timestamp=String(now());
  const signature=await crypto.subtle.sign('Ed25519',keys.privateKey,new TextEncoder().encode(timestamp+body));
  return new Request('https://journal.example/api/discord/interactions',{method:'POST',body,headers:{'X-Signature-Ed25519':Buffer.from(signature).toString('hex'),'X-Signature-Timestamp':timestamp}});
 };
 const ctx={waitUntil(){assert.fail('Unauthorized interaction scheduled work')}};
 assert.equal((await discordInteraction(new Request('https://journal.example'),env,ctx)).status,401);
 assert.deepEqual(await (await discordInteraction(await makeRequest({type:1}),env,ctx)).json(),{type:1});
 const response=await discordInteraction(await makeRequest({type:2,guild_id:discordGuild,data:{name:'sync'},member:{roles:[],user:{id:'1572356030611067099'}}}),env,ctx);
 assert.match((await response.json()).data.content,/только владельцам/);
});

test('A linked employee joining Discord is synced ahead of unrelated queued changes',async t=>{
 const f=setup({position:'Саппорт'});
 const {discordRoles,discordGuild,syncDiscordJoin}=await import('../worker/discord.mjs');
 const id='1572356030611067099',other='1572356030611067000',calls=[];
 t.mock.method(globalThis,'fetch',async (url,options)=>{
   calls.push([new URL(url).pathname,options.method,options.body&&JSON.parse(options.body)]);
   if(options.method==='GET')return Response.json({roles:[]});
   return new Response(null,{status:204});
 });
 try{
  f.env.DISCORD_BOT_TOKEN='test';
  f.DB.raw.prepare("UPDATE moderators SET discord_id=? WHERE id='actor'").run(id);
  f.DB.raw.prepare('INSERT INTO discord_role_jobs (discord_id,nickname,reason,queued_at) VALUES (?,?,?,0)').run(other,'Other','Test');
  await syncDiscordJoin(f.env,{guild_id:discordGuild,user:{id:'1572356030611067002'}});
  assert.equal(calls.length,0);
  await syncDiscordJoin(f.env,{guild_id:discordGuild,user:{id}});
  assert.ok(calls.some(([path,method])=>method==='PUT'&&path===`/api/v10/guilds/${discordGuild}/members/${id}/roles/${discordRoles['Саппорт']}`));
  assert.ok(calls.some(([path,method,body])=>method==='PATCH'&&path.endsWith('/members/'+id)&&body.nick==='User <test>'));
  assert.deepEqual(f.DB.raw.prepare('SELECT discord_id FROM discord_role_jobs').all().map(row=>row.discord_id),[other]);
 }finally{await f.close()}
});

test('Discord removal resets the server nickname, even when the staff role is already gone',async t=>{
 const f=setup({position:'Шериф'});
 const {drainDiscordJobs}=await import('../worker/discord.mjs');
 const id='1572356030611067099';
 const updates=[];
 t.mock.method(globalThis,'fetch',async (url,options)=>{
   if(options.method==='GET')return Response.json({roles:[],nick:'FormerNick'});
   if(options.method==='PATCH')updates.push(JSON.parse(options.body));
   return new Response(null,{status:204});
 });
 try{
  f.env.DISCORD_BOT_TOKEN='test';
  f.DB.raw.prepare("UPDATE moderators SET discord_id=? WHERE id='actor'").run(id);
  f.DB.raw.prepare("DELETE FROM moderators WHERE id='actor'").run();
  assert.equal((await drainDiscordJobs(f.env)).updated,1);
  assert.deepEqual(updates,[{nick:null}]);
 }finally{await f.close()}
});

test('Saving a new staff member dispatches Discord role assignment from the journal request',async t=>{
 const f=setup({position:'Владелец'});
 const {discordRoles}=await import('../worker/discord.mjs');
 const id='1572356030611067096';
 let wroteRole=false;
 try{
  const {sessionCookie}=await login(f);
  const headers={Cookie:sessionCookie};
  const {csrf}=await (await f.request('/api/auth/session',{headers})).json();
  f.env.DISCORD_BOT_TOKEN='test';
  t.mock.method(globalThis,'fetch',async(url,request)=>{
   if(request.method==='GET')return Response.json({roles:[]});
   if(request.method==='PUT'&&url.endsWith('/members/'+id+'/roles/'+discordRoles['Шериф']))wroteRole=true;
   return new Response(null,{status:204});
  });
  const response=await f.request('/api/admin/moderators',{method:'POST',
   headers:{...headers,Origin:f.env.PUBLIC_URL,'X-CSRF-Token':csrf,'Content-Type':'application/json'},
   body:JSON.stringify({nickname:'NewMember',position:'Шериф',realName:'Test Member',birthDate:'2000-01-01',telegramId:'88',discordId:id})
  });
  assert.equal(response.status,201);
 }finally{await f.close()}
 assert.equal(wroteRole,true);
});

test('Owner /sync responds immediately and reports results through the Discord log channel',async t=>{
 const f=setup({position:'Шериф'});
 const {discordGuild,discordRoles,discordLog,discordInteraction}=await import('../worker/discord.mjs');
 const id='1572356030611067098';
 const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
 f.env.DISCORD_PUBLIC_KEY=Buffer.from(await crypto.subtle.exportKey('raw',keys.publicKey)).toString('hex');
 f.env.DISCORD_BOT_TOKEN='test';
 const callback=async()=>{
  const body=JSON.stringify({type:2,guild_id:discordGuild,data:{name:'sync'},member:{roles:[discordRoles['Владелец']],user:{id}}});
  const timestamp=String(now());
  const signature=Buffer.from(await crypto.subtle.sign('Ed25519',keys.privateKey,new TextEncoder().encode(timestamp+body))).toString('hex');
  return new Request('https://journal.example/api/discord/interactions',{method:'POST',body,headers:{'X-Signature-Ed25519':signature,'X-Signature-Timestamp':timestamp}});
 };
 const jobs=[];
 const ctx={waitUntil(work){jobs.push(work)}};
 let release;
 const hold=new Promise(resolve=>{release=resolve});
 const requests=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  requests.push(url);
  if(options.method==='GET'){await hold;return Response.json({roles:[discordRoles['Шериф']],nick:'User <test>'});}
  return new Response(null,{status:204});
 });
 try{
  const empty=await (await discordInteraction(await callback(),f.env,ctx)).json();
  assert.equal(empty.type,4);
  assert.match(empty.data.content,/нет сотрудников/);
  f.DB.raw.prepare("UPDATE moderators SET discord_id=? WHERE id='actor'").run(id);
  const response=await (await discordInteraction(await callback(),f.env,ctx)).json();
  assert.equal(response.type,4);
  assert.match(response.data.content,/Синхронизация запущена/);
  assert.equal(jobs.length,1);
 }finally{release();await Promise.all(jobs);await f.close()}
 assert.ok(requests.some(url=>url.endsWith('/channels/'+discordLog+'/messages')));
});

test('Changing only the journal nickname updates the linked Discord member',async t=>{
 const f=setup({position:'Шериф'});
 const {discordRoles,drainDiscordJobs}=await import('../worker/discord.mjs');
 const id='1572356030611067095',requests=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  requests.push({url,method:options.method,body:options.body});
  if(options.method==='GET')return Response.json({roles:[discordRoles['Шериф']],nick:'OldName'});
  return new Response(null,{status:204});
 });
 try{
  f.env.DISCORD_BOT_TOKEN='test';
  f.DB.raw.prepare("UPDATE moderators SET discord_id=? WHERE id='actor'").run(id);
  f.DB.raw.exec("DELETE FROM discord_role_jobs; UPDATE moderators SET nickname='NewName' WHERE id='actor'");
  assert.equal(f.DB.raw.prepare('SELECT nickname FROM discord_role_jobs').get().nickname,'NewName');
  const result=await drainDiscordJobs(f.env);
  assert.equal(result.updated,1);
  assert.deepEqual(requests.map(request=>request.method),['GET','PATCH','POST']);
  assert.ok(requests[1].url.endsWith('/members/'+id));
  assert.deepEqual(JSON.parse(requests[1].body),{nick:'NewName'});
 }finally{await f.close()}
});

test('Formatted manuals retain image access and alignment when saved and edited',async()=>{
 const f=setup({position:'Владелец'});
 try{
  const {sessionCookie}=await login(f);
  const headers={Cookie:sessionCookie};
  const {csrf}=await (await f.request('/api/auth/session',{headers})).json();
  const post={...headers,Origin:f.env.PUBLIC_URL,'X-CSRF-Token':csrf,'Content-Type':'application/json'};
  const prefix='<!--jevox-manual-v2-->';
  const content=prefix+'<h2 data-align="center">Порядок проверки</h2><img src="data:image/png;base64,AAAA" data-align="right" data-width="55">';
  const save=(path,body)=>f.request(path,{method:'POST',headers:post,body:JSON.stringify({title:'Проверки',description:'Порядок работы',content:body})});
  assert.equal((await save('/api/manuals',content)).status,201);
  const {manuals:[manual]}=await (await f.request('/api/manuals',{headers})).json();
  const path='/api/manuals/'+manual.id;
  const read=async()=> (await (await f.request(path,{headers})).json()).manual.content;
  const saved=await read();
  const image=saved.match(/src="(\/api\/manual-images\/[a-f0-9-]+)"/)[1];
  assert.ok(saved.includes('<h2 data-align="center">'));
  assert.ok(saved.includes('data-align="right" data-width="55"'));
  assert.equal((await f.request(image,{headers})).status,200);
  assert.equal((await save(path,saved.replace('center','left'))).status,200);
  assert.equal((await f.request(image,{headers})).status,200);
  assert.equal((await save(path,prefix+'<p>Только текст</p>')).status,200);
  assert.equal((await f.request(image,{headers})).status,404);
 }finally{await f.close()}
});
test('Discord tickets publish one panel, create private channels, allow one staff claim, and lock on close',async t=>{
 const DB=d1();
 const {discordInteraction,discordGuild,discordRoles}=await import('../worker/discord.mjs');
 const {ticketPanelChannel,ticketCategory,publishTicketPanel,setupTicketCommands,drainTickets}=await import('../worker/discord-tickets.mjs');
 const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
 const publicKey=Buffer.from(await crypto.subtle.exportKey('raw',keys.publicKey)).toString('hex');
 const env={DB,DISCORD_BOT_TOKEN:'fake',DISCORD_PUBLIC_KEY:publicKey};
 const pending=[],calls=[];
 const bot='1572567705624518726',author='1573750022762401900',staff='1573750022762401901';
 const secondStaff='1573750022762401902',panelMessage='1573750022762401903';
 let next=1573750022762402000n;
 const nextId=()=>String(next++);
 t.mock.method(globalThis,'fetch',async(url,request)=>{
   const path=new URL(url).pathname.replace('/api/v10',''),body=request.body?JSON.parse(request.body):null;
   calls.push({path,method:request.method,body});
   if(path==='/applications/@me')return Response.json({id:bot});
   if(path===`/applications/${bot}/guilds/${discordGuild}/commands`)return Response.json({id:nextId(),name:body.name});
   if(path===`/applications/${bot}/emojis`)return Response.json(request.method==='GET'?{items:[]}:{id:nextId()});
   if(/^\/channels\/\d+$/.test(path)&&request.method==='GET'&&path!=='/channels/'+ticketPanelChannel&&path!=='/channels/'+ticketCategory){
     const ticket=DB.raw.prepare('SELECT id FROM discord_tickets WHERE channel_id=?').get(path.split('/').at(-1));
     return Response.json({type:0,guild_id:discordGuild,topic:'Jevox Support · Ticket '+ticket.id});
   }
   if(path==='/channels/'+ticketPanelChannel)return Response.json({guild_id:discordGuild,type:0});
   if(path==='/channels/'+ticketCategory)return Response.json({guild_id:discordGuild,type:4});
   if(path==='/channels/'+ticketPanelChannel+'/messages'||path==='/channels/'+ticketPanelChannel+'/messages/'+panelMessage)
     return Response.json({id:panelMessage,components:body.components});
   if(path==='/guilds/'+discordGuild+'/channels'&&request.method==='POST')return Response.json({id:nextId()});
   if(/\/channels\/\d+\/messages$/.test(path))return Response.json({id:nextId()});
   return Response.json({});
 });
 const send=async(data,channel=ticketPanelChannel,user=author,roles=[],messageId=panelMessage)=>{
   const payload={guild_id:discordGuild,channel_id:channel,application_id:bot,id:nextId(),token:'fixture-'+user,
     member:{user:{id:user},roles},message:{id:messageId},...data};
   const body=JSON.stringify(payload),timestamp=String(now());
   const signature=await crypto.subtle.sign('Ed25519',keys.privateKey,new TextEncoder().encode(timestamp+body));
   const req=new Request('https://journal.example/api/discord/interactions',{method:'POST',body,
     headers:{'X-Signature-Ed25519':Buffer.from(signature).toString('hex'),'X-Signature-Timestamp':timestamp}});
   return {id:payload.id,reply:await(await discordInteraction(req,env,{waitUntil:p=>pending.push(p)})).json()};
 };
 const settle=()=>Promise.all(pending.splice(0));
 const controls=(action,ticket,user,role)=>send({type:3,data:{custom_id:'jt:'+action+':'+ticket.id}},ticket.channel_id,user,role?[role]:[],ticket.message_id);
 try{
   await setupTicketCommands(env);
   assert.deepEqual(calls.filter(x=>x.path.endsWith('/commands')).map(x=>x.body.name),['priority','force-close','add']);
   assert.equal(calls.filter(x=>x.path.endsWith('/emojis')&&x.method==='POST').length,6);
   await Promise.all([publishTicketPanel(env),publishTicketPanel(env)]);
   const panel=calls.find(x=>x.path==='/channels/'+ticketPanelChannel+'/messages').body;
   assert.equal(calls.filter(x=>x.path==='/channels/'+ticketPanelChannel+'/messages').length,1);
   const panelButtons=panel.components[0].components;
   assert.deepEqual(panelButtons.map(button=>button.custom_id),['jt:topic:support','jt:topic:complaint','jt:topic:other']);
   assert.ok(panelButtons.every(button=>button.type===2&&button.emoji.id));
   assert.match(panel.embeds[0].image.url,/discord-ticket-panel[.]jpg$/);
   DB.raw.exec('UPDATE discord_ticket_panel SET layout_version=0');
   await publishTicketPanel(env);
   assert.equal(calls.filter(x=>x.path==='/channels/'+ticketPanelChannel+'/messages'&&x.method==='POST').length,1);
   assert.equal(calls.filter(x=>x.path==='/channels/'+ticketPanelChannel+'/messages/'+panelMessage&&x.method==='PATCH').length,1);
   assert.equal(DB.raw.prepare('SELECT message_id FROM discord_ticket_panel WHERE id=1').get().message_id,panelMessage);
   const expected={
     support:{suffix:'поддержка',icon:'🔴',fields:['nickname','problem'],ping:discordRoles['Саппорт']},
     complaint:{suffix:'жалобы',icon:'🟢',fields:['nickname','target','report','evidence'],ping:discordRoles['Менеджер']},
     other:{suffix:'прочее',icon:'🟢',fields:['nickname','question'],ping:discordRoles['Саппорт']},
   };
   let complaint,support;
   for(const [kind,item] of Object.entries(expected)){
     const opened=await send({type:3,data:{custom_id:'jt:topic:'+kind}});
     assert.equal(opened.reply.type,9);
     assert.deepEqual(opened.reply.data.components.map(c=>c.component.custom_id),item.fields);
     const inputs=item.fields.map(custom_id=>({type:18,component:{custom_id,value:custom_id==='nickname'?'1pirs':'Test @everyone'}}));
     const request={type:5,data:{custom_id:'jt:open:'+kind,components:inputs}};
     const result=await send(request);
     assert.deepEqual(result.reply,{type:5,data:{flags:64}});
     await settle();
     const ticket=DB.raw.prepare('SELECT * FROM discord_tickets WHERE id=?').get(result.id);
     assert.ok(ticket.channel_id&&ticket.message_id);
     if(kind==='complaint')complaint=ticket;
     if(kind==='support')support=ticket;
     const channel=calls.find(x=>x.body?.topic==='Jevox Support · Ticket '+ticket.id).body;
     assert.equal(channel.name,item.icon+'・1pirs-'+item.suffix);
     assert.equal(channel.parent_id,ticketCategory);
     assert.deepEqual(channel.permission_overwrites[0],{id:discordGuild,type:0,allow:'0',deny:'1024'});
     assert.deepEqual(channel.permission_overwrites.slice(1,-2).map(r=>r.id),
       kind==='complaint'?[discordRoles['Владелец'],discordRoles['Менеджер'],discordRoles['Младший Администратор'],discordRoles['Администратор']]:
         [discordRoles['Владелец'],discordRoles['Саппорт'],discordRoles['Менеджер'],discordRoles['Младший Администратор'],discordRoles['Администратор']]);
     assert.equal(channel.permission_overwrites.at(-2).id,author);
     const notice=calls.find(x=>x.path==='/channels/'+ticket.channel_id+'/messages').body;
     assert.match(notice.embeds[0].image.url,new RegExp('discord-ticket-'+kind+'[.]jpg$'));
     assert.deepEqual(notice.allowed_mentions,{parse:[],users:[author],roles:[item.ping]});
     assert.ok(!JSON.stringify(notice).includes('@everyone'));
     assert.match(calls.at(-1).body.content,new RegExp(ticket.channel_id));
   }
   const denied=await controls('claim',complaint,staff,discordRoles['Саппорт']);
   assert.equal(denied.reply.type,5);
   await settle();
   assert.match(calls.at(-1).body.content,/нет прав/);
   assert.equal(DB.raw.prepare('SELECT assignee_id FROM discord_tickets WHERE id=?').get(complaint.id).assignee_id,null);
   const before=calls.length;
   const results=await Promise.all([controls('claim',complaint,staff,discordRoles['Менеджер']),controls('claim',complaint,secondStaff,discordRoles['Владелец'])]);
   assert.ok(results.every(item=>item.reply.type===5));
   await settle();
   assert.equal(calls.slice(before).filter(x=>x.path.includes('/messages/@original')&&x.body.content==='Вы приняли тикет.').length,1);
   assert.equal(calls.slice(before).filter(x=>x.path.includes('/messages/@original')&&/уже принят/.test(x.body.content)).length,1);
   const card='/channels/'+complaint.channel_id+'/messages/'+complaint.message_id;
   assert.equal(calls.find(x=>x.path===card).body.components[0].components[0].disabled,true);
   const channelPath='/channels/'+complaint.channel_id;
   assert.equal(calls.filter(x=>x.path===channelPath+'/messages'&&x.body?.nonce==='jc-'+complaint.id).length,1);
   const command=(name,ticket,user,role,options=[])=>send({type:2,data:{name,options}},ticket.channel_id,user,[role]);
   await command('priority',complaint,staff,discordRoles['Менеджер'],[{name:'level',value:'medium'}]);
   await settle();
   assert.ok(calls.some(x=>x.path===channelPath&&x.body?.name==='🟡・1pirs-жалобы'));
   const guest='1573750022762401906';
   await command('add',complaint,staff,discordRoles['Менеджер'],[{name:'user',value:guest}]);
   await settle();
   assert.ok(calls.some(x=>x.path===channelPath&&x.body?.permission_overwrites?.some(overwrite=>overwrite.id===guest)));
   await command('force-close',support,staff,discordRoles['Саппорт']);
   await settle();
   assert.match(calls.at(-1).body.content,/Менеджер/);
   await command('force-close',complaint,staff,discordRoles['Менеджер']);
   await settle();
   const locked=calls.filter(x=>x.path===channelPath&&x.body?.permission_overwrites).at(-1);
   const authorOverwrite=locked.body.permission_overwrites.find(x=>x.id===author);
   assert.equal(BigInt(authorOverwrite.deny)&2048n,2048n);
   assert.equal(BigInt(authorOverwrite.allow)&1024n,1024n);
   assert.ok(calls.filter(x=>x.path===card).at(-1).body.components[0].components.every(x=>x.disabled));
   assert.ok(locked.body.permission_overwrites.some(overwrite=>overwrite.id===guest&&BigInt(overwrite.deny)&2048n));
   assert.equal(calls.filter(x=>x.path===channelPath+'/messages'&&x.body?.nonce==='jx-'+complaint.id).length,1);
   const closed=DB.raw.prepare('SELECT closed_at,delete_after FROM discord_tickets WHERE id=?').get(complaint.id);
   assert.equal(closed.delete_after-closed.closed_at,3600);
   await drainTickets(env);
   assert.ok(!calls.some(x=>x.path===channelPath&&x.method==='DELETE'));
   DB.raw.prepare('UPDATE discord_tickets SET delete_after=unixepoch()-1 WHERE id=?').run(complaint.id);
   await drainTickets(env);
   assert.ok(calls.some(x=>x.path===channelPath&&x.method==='DELETE'));
   assert.ok(DB.raw.prepare('SELECT deleted_at FROM discord_tickets WHERE id=?').get(complaint.id).deleted_at);
 }finally{await settle();DB.raw.close();}
});
