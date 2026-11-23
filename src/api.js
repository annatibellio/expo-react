const BASE = 'https://api.deezer.com';

async function get(path) {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) throw new Error('Falha ao acessar a Deezer');
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'Erro da Deezer');
  return data;
}

export const chartTracks = () => get('/chart/0/tracks?limit=15').then(x => x.data);
export const chartArtists = () => get('/chart/0/artists?limit=12').then(x => x.data);
export const chartAlbums = () => get('/chart/0/albums?limit=12').then(x => x.data);
export const search = q => get(`/search?q=${encodeURIComponent(q)}&limit=30`).then(x => x.data);
export const artistTop = id => get(`/artist/${id}/top?limit=25`).then(x => x.data);
export const albumTracks = id => get(`/album/${id}`).then(a => a.tracks.data.map(t => ({...t, album:a, artist:t.artist || a.artist})));

export const norm = t => ({
  id:t.id, title:t.title, artist:t.artist?.name || '', artistId:t.artist?.id,
  cover:t.album?.cover_medium || t.album?.cover_big || '',
  coverBig:t.album?.cover_xl || t.album?.cover_big || t.album?.cover_medium || '',
  preview:t.preview, duration:t.duration || 30
});
