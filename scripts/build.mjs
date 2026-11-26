import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const assets = {};
const assetDirectory = path.join(root, 'dist/assets');
const mediaExtensions = new Set(['.svg', '.woff2', '.woff', '.ttf', '.jpg', '.png', '.txt']);
const types = { '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.html':'text/html; charset=utf-8', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf', '.jpg':'image/jpeg', '.png':'image/png', '.txt':'text/plain; charset=utf-8' };
async function add(file, url) {
  assets[url] = { data: (await readFile(path.join(root,file))).toString('base64'), type: types[path.extname(file)] || 'application/octet-stream' };
}
async function directory(folder) {
  for (const item of await readdir(path.join(root,folder),{withFileTypes:true})) {
    const file = `${folder}/${item.name}`;
    if (item.isDirectory()) await directory(file);
    else if (mediaExtensions.has(path.extname(file))) await add(file, '/'+file.slice('dist/'.length));
  }
}
function addBundle(name, extension, contents) {
  const hash = createHash('sha256').update(contents).digest('hex').slice(0, 16);
  const url = `/assets/ui/${name}-${hash}${extension}`;
  assets[url] = { data: Buffer.from(contents).toString('base64'), type: types[extension] };
  return url;
}

async function browserScript(name, entryPoint) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [entryPoint],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    write: false,
  });
  return addBundle(name, '.js', result.outputFiles[0].contents);
}

const styles = await build({
  absWorkingDir: root,
  stdin: {
    contents: '@import "./dist/style.css"; @import "./public/auth.css";',
    loader: 'css',
    resolveDir: root,
  },
  bundle: true,
  minify: true,
  sourcemap: false,
  write: false,
  plugins: [{
    name: 'public-media',
    setup(api) {
      api.onResolve({ filter: /.*/ }, args => {
        if (args.kind !== 'url-token') return;
        if (args.path.startsWith('/assets/')) return { path: args.path, external: true };
        const file = path.resolve(args.resolveDir, args.path);
        if (!file.startsWith(assetDirectory + path.sep)) return;
        const url = path.relative(path.join(root, 'dist'), file).split(path.sep).join('/');
        return { path: '/' + url, external: true };
      });
    },
  }],
});
const css = addBundle('style', '.css', styles.outputFiles[0].contents);

async function addPage(file, url, script) {
  const html = (await readFile(path.join(root, file), 'utf8'))
    .replace('%UI_STYLE%', css)
    .replace('%UI_SCRIPT%', script);
  assets[url] = { data: Buffer.from(html).toString('base64'), type: types['.html'] };
}

const [loginScript, journalScript] = await Promise.all([
  browserScript('login', 'public/auth.js'),
  browserScript('journal', 'public/journal-entry.js'),
]);
await addPage('public/login.html', '/login.html', loginScript);
await addPage('dist/index.html', '/journal.html', journalScript);
await directory('dist/assets');
await add('public/favicon.svg', '/favicon.svg');
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
  const deployRoot = path.join(root, '.wrangler/pages-deploy');
  await mkdir(output, { recursive: true });
  await copyFile(path.join(root, 'dist/server/index.js'), path.join(output, '_worker.js'));
  await mkdir(deployRoot, { recursive: true });
  const relative = file => path.relative(deployRoot, file).split(path.sep).join('/');
  config.pages_build_output_dir = relative(output);
  for (const database of config.d1_databases || []) {
    if (database.migrations_dir) database.migrations_dir = relative(path.join(root, database.migrations_dir));
  }
  await writeFile(path.join(deployRoot, 'wrangler.jsonc'), JSON.stringify(config, null, 2) + '\n');
}
