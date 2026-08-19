const ALLOWED_ORIGINS = new Set([
  'https://mapzimus.github.io',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
]);

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    'cache-control': 'public, max-age=60',
    'content-type': 'application/json; charset=utf-8',
    vary: 'Origin',
  });
  const origin = request.headers.get('origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) headers.set('access-control-allow-origin', origin);
  return headers;
}

export default {
  fetch(request: Request): Response {
    const origin = request.headers.get('origin');
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return Response.json({ error: 'Origin not allowed' }, { status: 403 });
    }
    return new Response(JSON.stringify({ service: 'Motion aircraft gateway', status: 'ok' }), {
      headers: corsHeaders(request),
    });
  },
};
