import { build } from 'esbuild';
import { readFile, readdir, mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const assets = {};
const types = { '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.html':'text/html; charset=utf-8', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf', '.jpg':'image/jpeg', '.png':'image/png', '.txt':'text/plain; charset=utf-8' };
async function add(file, url) {
  assets[url] = { data: (await readFile(path.join(root,file))).toString('base64'), type: types[path.extname(file)] || 'application/octet-stream' };
}
async function directory(folder) {
  for (const item of await readdir(path.join(root,folder),{withFileTypes:true})) {
    const file = `${folder}/${item.name}`;
    if (item.isDirectory()) await directory(file);
    else await add(file, '/'+file.slice('dist/'.length));
  }
}
await add('dist/index.html','/journal.html');
const browser = await build({
  absWorkingDir:root, entryPoints:['dist/app.js'], bundle:true, format:'iife', platform:'browser', target:'es2022', write:false,
});
assets['/app.js'] = { data:Buffer.from(browser.outputFiles[0].contents).toString('base64'), type:types['.js'] };
await add('dist/style.css','/style.css');
await directory('dist/assets');
for (const file of ['login.html','auth.css','auth.js','account.js','favicon.svg']) await add('public/'+file,'/'+file);
await mkdir(path.join(root,'dist/server'),{recursive:true});
await mkdir(path.join(root,'dist/.openai'),{recursive:true});
await build({
  absWorkingDir:root,entryPoints:['worker/index.mjs'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,
  plugins:[{name:'journal-assets',setup(api){
    api.onResolve({filter:/^journal:assets$/},()=>({path:'assets',namespace:'journal'}));
    api.onLoad({filter:/.*/,namespace:'journal'},()=>({contents:'export default '+JSON.stringify(assets),loader:'js'}));
  }}],
});
const manifest = await readFile(path.join(root,'.openai/hosting.json'));
await writeFile(path.join(root,'dist/.openai/hosting.json'),manifest);
console.log(`Built Cloudflare Worker with ${Object.keys(assets).length} bundled assets and D1 binding.`);

if (process.argv.includes('--pages')) {
  const config = JSON.parse(await readFile(path.join(root, 'wrangler.pages.jsonc'), 'utf8'));
  const output = path.join(root, config.pages_build_output_dir);
  await mkdir(output, { recursive: true });
  await copyFile(path.join(root, 'dist/server/index.js'), path.join(output, '_worker.js'));
}
