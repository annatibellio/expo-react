import {Platform} from 'react-native';

const BASE = 'https://api.deezer.com';
const cache = {};

// A Deezer não libera CORS, então no navegador (Expo Web / Snack) o fetch direto falha.
// Estratégia: JSONP (web) -> fetch direto (nativo) -> proxies CORS como reserva.
const PROXIES = [
  u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

function jsonp(url, ms = 8000) {
  return new Promise((resolve, reject) => {
    const cb = 'dz' + Date.now() + Math.floor(Math.random() * 1e5);
    const s = document.createElement('script');
    const clean = () => { clearTimeout(t); delete window[cb]; s.remove(); };
    const t = setTimeout(() => { clean(); reject(new Error('timeout')); }, ms);
    window[cb] = d => { clean(); resolve(d); };
    s.onerror = () => { clean(); reject(new Error('jsonp')); };
    s.src = `${url}${url.includes('?') ? '&' : '?'}output=jsonp&callback=${cb}`;
    document.body.appendChild(s);
  });
}

async function fetchJson(url, ms = 9000) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = setTimeout(() => ctrl && ctrl.abort(), ms);
  try {
    const r = await fetch(url, ctrl ? {signal: ctrl.signal} : undefined);
    if (!r.ok) throw new Error('http ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function get(path) {
  if (cache[path]) return cache[path];
  const url = BASE + path;
  const isWeb = Platform.OS === 'web';
  const attempts = [
    isWeb ? () => jsonp(url) : () => fetchJson(url),
    ...PROXIES.map(p => () => fetchJson(p(url))),
  ];
  let lastErr;
  for (const run of attempts) {
    try {
      const data = await run();
      if (data && !data.error) { cache[path] = data; return data; }
      lastErr = new Error(data?.error?.message || 'Erro da Deezer');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Falha ao acessar a Deezer');
}

export const chartTracks = () => get('/chart/0/tracks?limit=20').then(x => x.data);
export const chartArtists = () => get('/chart/0/artists?limit=12').then(x => x.data);
export const chartAlbums = () => get('/chart/0/albums?limit=12').then(x => x.data);
export const search = q => get(`/search?q=${encodeURIComponent(q)}&limit=30`).then(x => x.data);
export const artistTop = id => get(`/artist/${id}/top?limit=25`).then(x => x.data);
export const albumTracks = id => get(`/album/${id}`).then(a =>
  a.tracks.data.map(t => ({...t, album: a, artist: t.artist || a.artist})));

export const norm = t => ({
  id: t.id, title: t.title, artist: t.artist?.name || '', artistId: t.artist?.id,
  cover: t.album?.cover_medium || t.album?.cover_big || '',
  coverBig: t.album?.cover_xl || t.album?.cover_big || t.album?.cover_medium || '',
  preview: t.preview, duration: t.duration || 30,
});
