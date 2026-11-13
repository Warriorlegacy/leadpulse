import { createApp } from './app.js';
import { initDb } from './db.js';

let appInstance = null;

export default {
  async fetch(request, env, ctx) {
    if (!appInstance) {
      await initDb();
      appInstance = createApp();
    }

    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return appInstance.fetch(request, env, ctx);
    }

    // Static Assets handler (Cloudflare Pages / Workers Static Assets)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};

