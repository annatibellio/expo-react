import {Platform} from 'react-native';

const BASE = 'https://api.deezer.com';
const cache = {};
const PROXIES = [
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy?url=${encodeURIComponent(url)}`,
];

function jsonp(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const callback = `dz${Date.now()}${Math.floor(Math.random() * 1e5)}`;
    const script = document.createElement('script');
    const cleanup = () => {
      clearTimeout(timer);
      delete window[callback];
      script.remove();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('A Deezer demorou para responder.'));
    }, timeout);
    window[callback] = data => {
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('Não foi possível acessar a Deezer.'));
    };
    script.src = `${url}${url.includes('?') ? '&' : '?'}output=jsonp&callback=${callback}`;
    document.body.appendChild(script);
  });
}

async function fetchJson(url, timeout = 9000) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeout);
  try {
    const response = await fetch(url, controller ? {signal: controller.signal} : undefined);
    if (!response.ok) throw new Error(`Deezer respondeu com HTTP ${response.status}.`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function get(path) {
  if (cache[path]) return cache[path];
  const url = BASE + path;
  const attempts = [
    ...(Platform.OS === 'web' ? [() => jsonp(url)] : [() => fetchJson(url)]),
    ...PROXIES.map(proxy => () => fetchJson(proxy(url))),
  ];
  let lastError;
  for (const attempt of attempts) {
    try {
      const data = await attempt();
      if (data && !data.error) {
        cache[path] = data;
        return data;
      }
      lastError = new Error(data?.error?.message || 'Erro ao consultar a Deezer.');
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Falha ao acessar a Deezer.');
}

export const chartTracks = () => get('/chart/0/tracks?limit=20').then(result => result.data);
export const chartArtists = () => get('/chart/0/artists?limit=12').then(result => result.data);
export const chartAlbums = () => get('/chart/0/albums?limit=12').then(result => result.data);
export const search = query => get(`/search?q=${encodeURIComponent(query)}&limit=30`).then(result => result.data);
export const artistTop = id => get(`/artist/${id}/top?limit=25`).then(result => result.data);
export const albumTracks = id => get(`/album/${id}`).then(album =>
  album.tracks.data.map(track => ({...track, album, artist: track.artist || album.artist})));

export const norm = track => ({
  id: track.id,
  title: track.title,
  artist: track.artist?.name || '',
  artistId: track.artist?.id,
  cover: track.album?.cover_medium || track.album?.cover_big || '',
  coverBig: track.album?.cover_xl || track.album?.cover_big || track.album?.cover_medium || '',
  preview: track.preview,
  duration: track.duration || 30,
  source: 'Deezer',
});
