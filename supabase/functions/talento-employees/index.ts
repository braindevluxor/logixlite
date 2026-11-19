// Supabase Edge Function: talento-employees
// Proxy de la API de Talento Humano (desarrolloluxor.lat) hacia el navegador.
//
// Por qué existe: la API original solo permite los headers CORS
// `token, Content-Type`, pero exige el header `API_KEY`, que el navegador
// bloquea. Aquí la clave vive en los secretos de Supabase y nunca se expone
// en el bundle del cliente.
//
// Despliegue:
//   supabase secrets set TALENTO_API_KEY=PBDFeysVkGLa0zRfq5bYEUtNbmV0akhtN3hFakRES3E2cU82TVE9PQ==
//   supabase functions deploy talento-employees
//
// Uso desde la app:
//   GET {SUPABASE_URL}/functions/v1/talento-employees/employee/samir?branchID=5
//   Headers: Authorization: Bearer <anon key>

const UPSTREAM_BASE = 'https://desarrolloluxor.lat/api/talentohumano'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS })
  }

  const apiKey = Deno.env.get('TALENTO_API_KEY')
  if (!apiKey) {
    return json(
      { error: 'Falta el secreto TALENTO_API_KEY (supabase secrets set TALENTO_API_KEY=...)' },
      500
    )
  }

  // Ruta y query originales: /employee/samir?branchID=5
  const url = new URL(req.url)
  const upstreamPath = url.pathname.replace(/^\/talento-employees/, '')
  const upstream = `${UPSTREAM_BASE}${upstreamPath}${url.search}`

  try {
    const r = await fetch(upstream, {
      headers: { API_KEY: apiKey, Accept: req.headers.get('Accept') ?? '*/*' },
    })
    const text = await r.text()
    return new Response(text, {
      status: r.status,
      headers: { ...CORS, 'Content-Type': r.headers.get('Content-Type') ?? 'application/json' },
    })
  } catch (err) {
    return json(
      { error: 'No se pudo contactar la API de Talento Humano', detail: String(err) },
      502
    )
  }
})
