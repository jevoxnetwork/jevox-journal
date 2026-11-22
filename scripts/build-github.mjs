import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.wrangler/github-pages');
const backend = 'https://jevox-github-api.1pirs.workers.dev';
const base = '/jevox-journal/';
const csp = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: " + backend + " https://textures.minecraft.net",
  "connect-src 'self' " + backend, "font-src 'self'", "base-uri 'none'", "object-src 'none'", "form-action 'self'",
].join('; ');
const read = file => readFile(path.join(root, file), 'utf8');
const put = (file, body) => writeFile(path.join(output, file), body);
const secureHead = '<meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="' + csp + '">';
const html = body => body.replace('<head>', '<head>' + secureHead)
  .replace(/(href|src)="\/(?!\/)/g, (_, attribute) => attribute + '="' + base);
await mkdir(path.join(output, 'journal'), { recursive: true });
await cp(path.join(root, 'dist/assets'), path.join(output, 'assets'), { recursive: true });
await cp(path.join(root, 'public/favicon.svg'), path.join(output, 'favicon.svg'));
for (const [source, file] of [['dist/style.css', 'style.css'], ['public/auth.css', 'auth.css']]) {
  await put(file, (await read(source)).replaceAll('/assets/', base + 'assets/'));
}
await put('index.html', html((await read('public/login.html'))
  .replace('<script src="/auth.js">', '<script type="module" src="/login.js">')));
await put('journal/index.html', html((await read('dist/index.html'))
  .replace('href="style.css"', 'href="/style.css"')
  .replace('<!-- AUTH_SESSION -->', '<script id="auth-session" type="application/json">{}</script>')
  .replace('<script src="/app.js"></script>', '<script type="module" src="/journal.js"></script>')
  .replace('<script src="/account.js"></script>', '')));
await put('.nojekyll', '');

await build({
  absWorkingDir: root,
  entryPoints: { login: 'pages/login.mjs', journal: 'pages/journal.mjs' },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  outdir: output,
  inject: ['pages/client.mjs'],
  plugins: [{
    name: 'github-journal-paths',
    setup(api) {
      api.onLoad({ filter: /[\\/](auth|account|app)\.js$/ }, async args => {
        let contents = await readFile(args.path, 'utf8');
        if (args.path === path.join(root, 'dist/app.js')) {
          contents = contents
            .replaceAll("'/assets/skins/", "'" + base + 'assets/skins/')
            .replace("path:'/assets/minecraft-textures/", "path:'" + base + 'assets/minecraft-textures/')
            .replace("const texture='/assets/minecraft-textures/", "const texture='" + backend + '/assets/minecraft-textures/');
          return { contents, loader: 'js' };
        }
        if (![path.join(root, 'public/auth.js'), path.join(root, 'public/account.js')].includes(args.path)) return;
        contents = "import { startLogin, clearLogin } from '../pages/client.mjs';\n" + contents
          .replace("'', '/login'", "'', '/jevox-journal/'")
          .replace("replace('/journal')", "replace('/jevox-journal/journal/')")
          .replaceAll("location.replace('/login')", "location.replace('/jevox-journal/')")
          .replace('location.assign(`/auth/${provider}/start`)', "startLogin(provider).catch(() => { const message = document.querySelector('#login-error'); message.hidden = false; message.textContent = 'Не удалось начать вход.'; })")
          .replace(/if \(!response\.ok\) throw new Error\(\);\s+location\.replace\('\/jevox-journal\/'\);/g,
            "if (!response.ok) throw new Error(); clearLogin(); location.replace('/jevox-journal/');")
          .replace("toast('Не удалось выйти. Попробуйте ещё раз.')", "alert('Не удалось выйти. Попробуйте ещё раз.')");
        return { contents, loader: 'js' };
      });
    },
  }],
});
console.log('Built GitHub Pages frontend in .wrangler/github-pages.');
