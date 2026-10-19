import {handleApi} from './api.js';

// Optional API-only entry for a separately owned Cloudflare Worker.
// The live Site uses build/sites-worker.ts and its managed DB binding instead.
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(path==='/api'||path.startsWith('/api/'))return handleApi(request,env);
    return new Response(JSON.stringify({error:'This Worker serves the /api endpoints only.',code:'not_found'}),{
      status:404,
      headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},
    });
  },
};
