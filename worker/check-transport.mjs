const journalBridge = 'https://jevoxjournal.pages.dev/api/check-bridge';

export default {
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/check-bridge' || url.search) {
      return new Response('Not found', { status: 404 });
    }
    const authorization = request.headers.get('Authorization');
    if (request.method !== 'POST' || !authorization?.startsWith('Bearer ')) {
      return new Response('Forbidden', { status: 403 });
    }
    return fetch(journalBridge, {
      method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: request.body,
      redirect: 'manual',
    });
  },
};
