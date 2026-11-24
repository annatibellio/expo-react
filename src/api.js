import {Platform} from 'react-native';

const BASE = Platform.OS === 'web'
  ? (process.env.EXPO_PUBLIC_DEEZER_PROXY_URL || 'http://localhost:3001/api/deezer')
  : 'https://api.deezer.com';

async function get(path) {
  let response;
  try {
    response = await fetch(`${BASE}${path}`);
  } catch (error) {
    throw new Error(Platform.OS === 'web'
      ? 'Não foi possível acessar a Deezer. Verifique se o proxy local está rodando.'
      : 'Não foi possível acessar a Deezer. Verifique sua conexão.');
  }
  if (!response.ok) throw new Error(`A Deezer respondeu com erro (${response.status}).`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'A Deezer retornou um erro.');
  return data;
}

const list = (promise, description) => promise.then(result => {
  if (!Array.isArray(result.data)) throw new Error(`A resposta de ${description} veio em formato inválido.`);
  return result.data;
});

export const chartTracks = () => list(get('/chart/0/tracks?limit=15'), 'faixas em destaque');
export const chartArtists = () => list(get('/chart/0/artists?limit=12'), 'artistas');
export const chartAlbums = () => list(get('/chart/0/albums?limit=12'), 'álbuns');
export const search = q => list(get(`/search?q=${encodeURIComponent(q)}&limit=30`), 'busca');
export const searchArtists = q => list(get(`/search/artist?q=${encodeURIComponent(q)}&limit=12`), 'busca de artistas');
export const searchAlbums = q => list(get(`/search/album?q=${encodeURIComponent(q)}&limit=12`), 'busca de álbuns');
export const artistTop = id => list(get(`/artist/${encodeURIComponent(id)}/top?limit=25`), 'artista');
export const albumTracks = id => get(`/album/${encodeURIComponent(id)}`).then(a => {
  if (!Array.isArray(a.tracks?.data)) throw new Error('A Deezer não retornou faixas para este álbum.');
  return a.tracks.data.map(t => ({...t, album:a, artist:t.artist || a.artist}));
});

export const norm = t => ({
  id:t.id, title:t.title, artist:t.artist?.name || '', artistId:t.artist?.id,
  cover:t.album?.cover_medium || t.album?.cover_big || '',
  coverBig:t.album?.cover_xl || t.album?.cover_big || t.album?.cover_medium || '',
  preview:t.preview, duration:t.duration || 30
});
