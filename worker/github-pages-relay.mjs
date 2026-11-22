import { isPagesApi } from './github-pages.mjs';

const upstream = 'https://jevoxjournal.pages.dev';

export default {
  async fetch(request) {
    const { pathname, search } = new URL(request.url);
    const texture = /^\/assets\/minecraft-textures\/[a-f0-9]{32,64}\.png$/.test(pathname);
    if (texture ? !['GET', 'HEAD'].includes(request.method) : !isPagesApi(request)) {
      return new Response('Not found', { status: 404 });
    }
    const headers = new Headers();
    for (const name of ['Origin', 'Content-Type', 'Authorization', 'X-CSRF-Token',
      'Access-Control-Request-Method', 'Access-Control-Request-Headers']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    return fetch(upstream + pathname + search, {
      method: request.method, headers, body: request.body, redirect: 'manual',
    });
  },
};
