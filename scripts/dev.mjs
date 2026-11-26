import { Miniflare } from 'miniflare';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
if(existsSync('.env'))process.loadEnvFile('.env');
const port=Number(process.env.PORT||5173);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid PORT');
const names=['PUBLIC_URL','TELEGRAM_CLIENT_ID','TELEGRAM_CLIENT_SECRET','VK_CLIENT_ID','VK_CLIENT_SECRET','ADMIN_TELEGRAM_IDS','ADMIN_VK_IDS','STAFF_TELEGRAM_IDS','STAFF_VK_IDS'];
const bindings=Object.fromEntries(names.map(n=>[n,process.env[n]||'']));
bindings.PUBLIC_URL=`http://localhost:${port}`;
if(!existsSync('dist/server/index.js'))await import('./build.mjs');
const mf=new Miniflare({scriptPath:path.join(root,'dist/server/index.js'),modules:true,compatibilityDate:'2026-07-30',host:'127.0.0.1',port,bindings,d1Databases:['DB'],d1Persist:path.join(root,'.wrangler/state/d1')});
const db=await mf.getD1Database('DB');
await db.prepare('CREATE TABLE IF NOT EXISTS _journal_local_migrations (name TEXT PRIMARY KEY,applied_at INTEGER NOT NULL)').run();
for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort()){
  const applied=await db.prepare('SELECT name FROM _journal_local_migrations WHERE name=?').bind(name).first();
  if(applied)continue;
  const sql=readFileSync(path.join('drizzle',name),'utf8');
  for(const statement of sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
  await db.prepare('INSERT INTO _journal_local_migrations VALUES (?,?)').bind(name,Date.now()).run();
}
console.log(`Journal auth server ready: http://localhost:${port}`);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await mf.dispose();process.exit(0)});
