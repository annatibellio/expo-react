const express = require('express');

const app = express();
const port = Number(process.env.PORT) || 3001;
const allowedPath = /^\/(?:chart\/0\/(?:tracks|artists|albums)|search(?:\/(?:artist|album))?|artist\/\d+\/top|album\/\d+)$/;

app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
    return res.status(403).json({error: 'Origem não permitida.'});
  }
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/deezer/*path', async (req, res) => {
  const parts = req.params.path;
  const path = `/${Array.isArray(parts) ? parts.join('/') : parts}`;
  if (!allowedPath.test(path)) return res.status(404).json({error: 'Rota Deezer não permitida.'});

  const url = new URL(path, 'https://api.deezer.com');
  for (const key of ['q', 'limit']) {
    if (typeof req.query[key] === 'string') url.searchParams.set(key, req.query[key]);
  }

  try {
    const response = await fetch(url, {signal: AbortSignal.timeout(12000)});
    const body = await response.text();
    res.status(response.status).type('application/json').send(body);
  } catch (error) {
    console.error('Deezer proxy request failed:', error.message);
    res.status(502).json({error: 'Não foi possível acessar a API da Deezer.'});
  }
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Proxy Deezer disponível em http://localhost:${port}/api/deezer`);
});
