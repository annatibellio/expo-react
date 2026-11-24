// @ts-nocheck
import React, {useEffect, useRef, useState, useCallback} from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Image, StyleSheet,
  SafeAreaView, StatusBar, ActivityIndicator, Modal, Platform, KeyboardAvoidingView
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Audio} from 'expo-av';
import {Ionicons} from '@expo/vector-icons';
import * as api from './api';
import * as fb from './firebase';

const C = {bg:'#08130e', surface:'#121d17', surface2:'#1b2922', line:'#1f2d26', green:'#22e06b', text:'#f2f7f4', muted:'#8c9d94', pink:'#b5456d'};
const fmt = s => `${Math.floor((s||0)/60)}:${String(Math.floor((s||0)%60)).padStart(2,'0')}`;
const playable = arr => (arr||[]).map(api.norm).filter(t=>t.preview);

function Btn({children,onPress,style,green=false,disabled}) {
  return <TouchableOpacity disabled={disabled} onPress={onPress} activeOpacity={.75} style={[styles.button,green&&styles.greenButton,disabled&&{opacity:.5},style]}>{children}</TouchableOpacity>;
}
function Cover({src,size=52,round=false,icon='musical-notes',bg}) {
  const r = round?size/2:10;
  return <View style={[styles.cover,{width:size,height:size,borderRadius:r},bg&&{backgroundColor:bg}]}>
    {src ? <Image source={{uri:src}} style={{width:size,height:size,borderRadius:r}}/> :
      <Ionicons name={icon} size={size*.45} color={bg?'#fff':C.muted}/>}
  </View>;
}
function TrackRow({track,onPlay,onMore,active}) {
  return <View style={styles.trackRow}>
    <TouchableOpacity style={styles.trackMain} onPress={onPlay}>
      <Cover src={track.cover}/>
      <View style={{flex:1,minWidth:0}}>
        <Text numberOfLines={1} style={[styles.trackTitle,active&&{color:C.green}]}>{track.title}</Text>
        <Text numberOfLines={1} style={styles.small}>{track.artist}{active?' • tocando':''}</Text>
      </View>
    </TouchableOpacity>
    {onMore && <Btn onPress={onMore} style={styles.iconButton}><Ionicons name="ellipsis-horizontal" size={20} color={C.text}/></Btn>}
  </View>;
}
function Section({title,children}) {
  return <><Text style={styles.sectionTitle}>{title}</Text>{children}</>;
}
function SearchBox({children}) {
  return <View style={styles.searchPill}><Ionicons name="search" size={20} color={C.muted}/>{children}</View>;
}

export default function App() {
  const [user,setUser]=useState(null), [saved,setSaved]=useState([]), [playlists,setPlaylists]=useState([]);
  const [page,setPage]=useState('welcome'), [stack,setStack]=useState([]), [libTab,setLibTab]=useState('playlists');
  const [homeData,setHomeData]=useState(null), [homeError,setHomeError]=useState(false), [retry,setRetry]=useState(0);
  const [query,setQuery]=useState(''), [results,setResults]=useState([]), [searchState,setSearchState]=useState('idle');
  const [collection,setCollection]=useState(null), [remoteTracks,setRemoteTracks]=useState(null);
  const [current,setCurrent]=useState(null), [queue,setQueue]=useState([]), [index,setIndex]=useState(-1);
  const [playing,setPlaying]=useState(false), [position,setPosition]=useState(0), [duration,setDuration]=useState(30000);
  const [shuffle,setShuffle]=useState(false), [repeat,setRepeat]=useState('off');
  const [fullPlayer,setFullPlayer]=useState(false), [addTrack,setAddTrack]=useState(null);
  const [createOpen,setCreateOpen]=useState(false), [createTrack,setCreateTrack]=useState(null), [newName,setNewName]=useState('');
  const [dialog,setDialog]=useState(null);
  const [authOpen,setAuthOpen]=useState(false), [mode,setMode]=useState('login'), [fName,setFName]=useState(''), [fEmail,setFEmail]=useState(''), [fPass,setFPass]=useState('');
  const [authErr,setAuthErr]=useState(''), [busy,setBusy]=useState(false), [seekW,setSeekW]=useState(1);
  const [sleepMinutes,setSleepMinutes]=useState(0);
  const sleepRef=useRef(null);

  const soundRef=useRef(null), reqId=useRef(0), hydrated=useRef(null);
  const queueRef=useRef([]), indexRef=useRef(-1), shuffleRef=useRef(false), repeatRef=useRef('off');
  queueRef.current=queue; indexRef.current=index; shuffleRef.current=shuffle; repeatRef.current=repeat;

  // ---------- dados (Firebase + cache local) ----------
  const keyFor=uid=>`sf_data_${uid||'guest'}`;
  const applyData=d=>{setSaved(d?.saved||[]);setPlaylists((d?.playlists||[]).filter(p=>p.id!=='fav'));};
  useEffect(()=>fb.onUser(async u=>{
    if(!u){hydrated.current=null;setUser(null);return;}
    const info={uid:u.uid,anon:u.isAnonymous,name:u.displayName||'',email:u.email||''};
    setUser(info);
    let data=null;
    try{data=await fb.loadData(u.uid);}catch(e){
      setDialog({title:'Falha ao carregar dados',msg:'Sua conta entrou, mas os dados do Firestore não puderam ser carregados. Verifique a conexão e as regras do banco.',actions:[{text:'Ok'}]});
    }
    if(!data){try{const l=await AsyncStorage.getItem(keyFor(u.uid));if(l)data=JSON.parse(l);}catch(e){}}
    applyData(data);hydrated.current=u.uid;
    setPage(p=>p==='welcome'?'home':p);
  }),[]);
  useEffect(()=>{ // convidado sem Firebase: cache local
    if(fb.fbReady)return;
    AsyncStorage.getItem(keyFor(null)).then(l=>l&&applyData(JSON.parse(l))).catch(()=>{});
    hydrated.current='guest';
  },[]);
  useEffect(()=>{
    const uid=fb.fbReady?user?.uid:'guest';
    if(!uid||hydrated.current!==uid)return;
    const data={saved,playlists,name:user?.name||''};
    AsyncStorage.setItem(keyFor(fb.fbReady?uid:null),JSON.stringify(data)).catch(()=>{});
    if(!fb.fbReady)return;
    const t=setTimeout(()=>fb.saveData(uid,data).catch(()=>{
      setDialog({title:'Falha ao sincronizar',msg:'Não foi possível salvar suas alterações no Firebase. Verifique a conexão e as regras do Firestore.',actions:[{text:'Ok'}]});
    }),800);
    return ()=>clearTimeout(t);
  },[saved,playlists,user]);

  // ---------- Deezer ----------
  useEffect(()=>{if(page!=='home'||homeData)return; let live=true;setHomeError(false);
    Promise.all([api.chartTracks(),api.chartArtists(),api.chartAlbums()])
      .then(([t,a,b])=>{if(live)setHomeData({tracks:playable(t),artists:a,albums:b});})
      .catch(()=>{if(live)setHomeError(true);});
    return ()=>{live=false;};
  },[page,homeData,retry]);
  useEffect(()=>{if(page!=='search')return;
    const q=query.trim();
    if(q.length<2){setResults([]);setSearchState('idle');return;}
    let live=true;setSearchState('loading');
    const timer=setTimeout(()=>api.search(q).then(d=>{if(live){setResults(playable(d));setSearchState('done');}})
      .catch(()=>{if(live)setSearchState('error');}),450);
    return ()=>{live=false;clearTimeout(timer);};
  },[query,page]);

  // ---------- player ----------
  const unload=async()=>{const s=soundRef.current;soundRef.current=null;if(s){try{await s.unloadAsync();}catch(e){}}};
  useEffect(()=>{
    Audio.setAudioModeAsync({playsInSilentModeIOS:true,staysActiveInBackground:true}).catch(()=>{});
    return ()=>{unload();};
  },[]);
  useEffect(()=>{
    if(sleepRef.current){clearTimeout(sleepRef.current);sleepRef.current=null;}
    if(!sleepMinutes)return;
    sleepRef.current=setTimeout(async()=>{
      try{await soundRef.current?.pauseAsync();}catch(e){}
      setPlaying(false);
      setSleepMinutes(0);
      setDialog({title:'Timer concluído',msg:'A reprodução foi pausada.',actions:[{text:'Ok'}]});
    },sleepMinutes*60*1000);
    return ()=>{if(sleepRef.current){clearTimeout(sleepRef.current);sleepRef.current=null;}};
  },[sleepMinutes]);
  const playAt=async(list,i)=>{
    const track=list?.[i]; if(!track?.preview)return;
    const id=++reqId.current;
    await unload();
    setQueue(list);setIndex(i);setCurrent(track);setPosition(0);setDuration(30000);setPlaying(true);
    try {
      const {sound}=await Audio.Sound.createAsync(
        {uri:track.preview},
        {shouldPlay:true,progressUpdateIntervalMillis:500},
        status=>{
          if(id!==reqId.current||!status.isLoaded)return;
          setPosition(status.positionMillis||0);
          setDuration(status.durationMillis||30000);
          setPlaying(status.isPlaying);
          if(status.didJustFinish)onEnd();
        },
      );
      if(id!==reqId.current){sound.unloadAsync().catch(()=>{});return;}
      soundRef.current=sound;
    } catch(e) {
      if(id===reqId.current){
        setPlaying(false);
        setDialog({title:'Não foi possível reproduzir',msg:'Tente outra música.',actions:[{text:'Ok'}]});
      }
    }
  };
  const onEnd=()=>{
    const q=queueRef.current,i=indexRef.current; if(!q.length)return;
    if(repeatRef.current==='one')return playAt(q,i);
    if(shuffleRef.current&&q.length>1){let n;do{n=Math.floor(Math.random()*q.length);}while(n===i);return playAt(q,n);}
    if(i+1>=q.length&&repeatRef.current==='off'){setPlaying(false);return;}
    playAt(q,(i+1)%q.length);
  };
  const toggle=async()=>{const sound=soundRef.current;if(!sound)return;try{if(playing)await sound.pauseAsync();else await sound.playAsync();}catch(e){}};
  const step=dir=>{const q=queueRef.current;if(!q.length)return;
    const n=shuffleRef.current&&dir>0&&q.length>1?Math.floor(Math.random()*q.length):(indexRef.current+dir+q.length)%q.length;
    playAt(q,n);};
  const seek=async e=>{const v=Math.max(0,Math.min(1,e.nativeEvent.locationX/seekW))*duration;setPosition(v);
    if(soundRef.current)try{await soundRef.current.setPositionAsync(v);}catch(error){}};

  // ---------- biblioteca ----------
  const isSaved=t=>saved.some(x=>x.id===t.id);
  const toggleSave=t=>setSaved(old=>old.some(x=>x.id===t.id)?old.filter(x=>x.id!==t.id):[t,...old]);
  const createPlaylist=(name,track)=>{const id='p'+Date.now();
    setPlaylists(p=>[...p,{id,name:name.trim()||'Nova playlist',tracks:track?[track]:[]}]);};
  const addToPlaylist=(pid,t)=>setPlaylists(p=>p.map(x=>x.id===pid&&!x.tracks.some(y=>y.id===t.id)?{...x,tracks:[...x.tracks,t]}:x));
  const removeFromPlaylist=(pid,tid)=>setPlaylists(p=>p.map(x=>x.id===pid?{...x,tracks:x.tracks.filter(t=>t.id!==tid)}:x));
  const confirmDo=(title,msg,text,fn)=>setDialog({title,msg,actions:[{text:'Cancelar'},{text,danger:true,onPress:fn}]});
  const openCreate=track=>{setCreateTrack(track||null);setNewName('');setCreateOpen(true);};
  const submitCreate=()=>{if(!newName.trim())return;createPlaylist(newName,createTrack);setCreateOpen(false);setAddTrack(null);};

  const openCollection=async item=>{
    setCollection(item);setRemoteTracks(null);setStack(s=>[...s,page]);setPage('collection');
    if(item.type==='artist'||item.type==='album'){
      try{const d=item.type==='artist'?await api.artistTop(item.id):await api.albumTracks(item.id);setRemoteTracks(playable(d));}
      catch(e){setRemoteTracks([]);}
    }
  };
  const back=()=>{setPage(stack[stack.length-1]||'home');setStack(s=>s.slice(0,-1));};
  const enter=()=>{setPage('home');setStack([]);};
  const collTracks=collection?.type==='fav'?saved:collection?.type==='playlist'?(playlists.find(p=>p.id===collection.id)?.tracks||[]):remoteTracks;

  // ---------- login ----------
  const startGuest=async()=>{
    if(fb.fbReady){setBusy(true);try{await fb.guestLogin();setBusy(false);return;}catch(e){setBusy(false);}}
    setUser({uid:null,anon:true,name:'',email:''});enter();
  };
  const submitAuth=async()=>{
    if(!fEmail.trim()||!fPass)return setAuthErr('Preencha e-mail e senha.');
    if(mode==='register'&&!fName.trim())return setAuthErr('Informe seu nome.');
    setBusy(true);setAuthErr('');
    try{
      if(mode==='login')await fb.login(fEmail.trim(),fPass); else await fb.register(fName.trim(),fEmail.trim(),fPass);
      setAuthOpen(false);setFPass('');
    }catch(e){setAuthErr(fb.authMessage(e));}
    setBusy(false);
  };
  const doLogout=async()=>{
    await unload();setCurrent(null);setPlaying(false);setQueue([]);setFullPlayer(false);
    try{if(fb.fbReady)await fb.logout();}catch(e){}
    hydrated.current=fb.fbReady?null:'guest';setUser(null);applyData(null);setPage('welcome');setStack([]);
  };
  const displayName=user?.name||(user?.email?user.email.split('@')[0]:'');

  const renderTrack=(t,list,i,removable=false,onRemove)=><TrackRow key={`${t.id}-${i}`} track={t} active={current?.id===t.id}
    onPlay={()=>playAt(list,i)} onMore={removable?()=>confirmDo('Remover música','Deseja remover esta música?','Remover',onRemove):()=>setAddTrack(t)}/>;

  const renderHome=()=> <ScrollView contentContainerStyle={styles.screen}>
    <View style={styles.header}><View style={{flex:1}}><Text style={styles.small}>Olá{displayName?`, ${displayName}`:''}! 👋</Text><Text style={styles.h1}>Início</Text></View>
      <Ionicons name="notifications-outline" size={24} color={C.text}/></View>
    <TouchableOpacity activeOpacity={.8} onPress={()=>{setPage('search');setQuery('');}}><SearchBox><Text style={styles.placeholder}>Pesquisar músicas, artistas, álbuns...</Text></SearchBox></TouchableOpacity>
    {homeError&&<><Text style={styles.message}>Não foi possível carregar as músicas gratuitas. Verifique sua conexão.</Text><Btn green style={{marginTop:12,alignSelf:'flex-start'}} onPress={()=>{setHomeError(false);setRetry(r=>r+1);}}><Text style={styles.greenText}>Tentar de novo</Text></Btn></>}
    {!homeData&&!homeError&&<ActivityIndicator color={C.green} style={{marginTop:28}}/>}
    {homeData&&<>
      <Section title="Destaques"><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontal}>
        {homeData.tracks.map((t,i)=><TouchableOpacity key={t.id} style={styles.card} onPress={()=>playAt(homeData.tracks,i)}><Cover src={t.coverBig||t.cover} size={112}/><Text numberOfLines={1} style={styles.cardTitle}>{t.title}</Text><Text numberOfLines={1} style={styles.small}>{t.artist}</Text></TouchableOpacity>)}
      </ScrollView></Section>
      <Section title="Artistas em alta"><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontal}>
        {homeData.artists.map(a=><TouchableOpacity key={a.id} style={[styles.card,{width:82,alignItems:'center'}]} onPress={()=>openCollection({type:'artist',id:a.id,title:a.name,sub:'Mais tocadas'})}><Cover src={a.picture_medium} size={76} round/><Text numberOfLines={1} style={[styles.small,{marginTop:6}]}>{a.name}</Text></TouchableOpacity>)}
      </ScrollView></Section>
      <Section title="Álbuns recomendados"><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontal}>
        {homeData.albums.map(a=><TouchableOpacity key={a.id} style={styles.card} onPress={()=>openCollection({type:'album',id:a.id,title:a.title,sub:a.artist?.name})}><Cover src={a.cover_big||a.cover_medium} size={112}/><Text numberOfLines={1} style={styles.cardTitle}>{a.title}</Text><Text numberOfLines={1} style={styles.small}>{a.artist?.name}</Text></TouchableOpacity>)}
      </ScrollView></Section>
    </>}
  </ScrollView>;

  const renderSearch=()=> <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
    <Text style={styles.h1}>Pesquisar</Text>
    <View style={{height:16}}/>
    <SearchBox>
      <TextInput value={query} onChangeText={setQuery} autoFocus placeholder="Músicas, artistas, álbuns..." placeholderTextColor={C.muted} style={styles.searchInput} returnKeyType="search"/>
      {!!query&&<TouchableOpacity onPress={()=>setQuery('')}><Ionicons name="close-circle" size={20} color={C.muted}/></TouchableOpacity>}
    </SearchBox>
    {searchState==='idle'&&<Text style={styles.message}>Digite pelo menos 2 letras para buscar.</Text>}
    {searchState==='loading'&&<ActivityIndicator color={C.green} style={{marginTop:24}}/>}
    {searchState==='error'&&<Text style={styles.message}>A busca falhou. Verifique a conexão e tente novamente.</Text>}
    {searchState==='done'&&!results.length&&<Text style={styles.message}>Nada encontrado para “{query}”.</Text>}
    <View style={{marginTop:8}}>{results.map((t,i)=>renderTrack(t,results,i))}</View>
  </ScrollView>;

  const renderLibrary=()=> <ScrollView contentContainerStyle={styles.screen}>
    <View style={styles.header}><Text style={[styles.h1,{flex:1}]}>Biblioteca</Text>
      <Btn style={styles.iconButton} onPress={()=>setDialog({title:'Conta',msg:user?.anon?'Você está como convidado.':(user?.email||'Sessão iniciada'),actions:[{text:'Fechar'},{text:'Sair',danger:true,onPress:doLogout}]})}><Ionicons name="settings-outline" size={22} color={C.text}/></Btn></View>
    <View style={styles.tabs}>{[['playlists','Playlists'],['saved','Músicas salvas']].map(([k,l])=>
      <TouchableOpacity key={k} style={[styles.tab,libTab===k&&styles.tabOn]} onPress={()=>setLibTab(k)}><Text style={[styles.tabLabel,libTab===k&&{color:'#04150b'}]}>{l}</Text></TouchableOpacity>)}</View>
    {libTab==='playlists'?<>
      <TouchableOpacity style={styles.trackRow} onPress={()=>openCreate()}><View style={styles.trackMain}>
        <View style={[styles.cover,{width:56,height:56,borderRadius:10}]}><Ionicons name="add" size={28} color={C.text}/></View><Text style={styles.trackTitle}>Nova playlist</Text></View></TouchableOpacity>
      <View style={styles.trackRow}>
        <TouchableOpacity style={styles.trackMain} onPress={()=>openCollection({type:'fav',title:'Minhas Favoritas',sub:`${saved.length} músicas`})}>
          <Cover size={56} icon="heart" bg={C.pink}/><View><Text style={styles.trackTitle}>Minhas Favoritas</Text><Text style={styles.small}>{saved.length} músicas</Text></View></TouchableOpacity></View>
      {playlists.map(p=><View key={p.id} style={styles.trackRow}>
        <TouchableOpacity style={styles.trackMain} onPress={()=>openCollection({type:'playlist',id:p.id,title:p.name,sub:`${p.tracks.length} músicas`})}>
          <Cover src={p.tracks[0]?.cover} size={56} icon="list"/><View style={{flex:1}}><Text numberOfLines={1} style={styles.trackTitle}>{p.name}</Text><Text style={styles.small}>{p.tracks.length} músicas</Text></View></TouchableOpacity>
        <Btn style={styles.iconButton} onPress={()=>confirmDo('Excluir playlist',`Excluir "${p.name}"?`,'Excluir',()=>setPlaylists(x=>x.filter(y=>y.id!==p.id)))}><Ionicons name="trash-outline" size={19} color={C.text}/></Btn>
      </View>)}
    </>:(saved.length?saved.map((t,i)=>renderTrack(t,saved,i)):<Text style={styles.message}>Nenhuma música salva. Toque no coração no player.</Text>)}
  </ScrollView>;

  const renderCollection=()=> <ScrollView contentContainerStyle={styles.screen}>
    <View style={styles.header}><Btn style={styles.iconButton} onPress={back}><Ionicons name="chevron-back" size={25} color={C.text}/></Btn><View style={{flex:1}}><Text numberOfLines={1} style={styles.h2}>{collection?.title}</Text>{!!collection?.sub&&<Text style={styles.small}>{collection.sub}</Text>}</View>
    {!!collTracks?.length&&<Btn green style={styles.playSmall} onPress={()=>playAt(collTracks,0)}><Ionicons name="play" size={19} color="#04150b"/></Btn>}</View>
    {collTracks===null?<ActivityIndicator color={C.green}/>:collTracks.length?collTracks.map((t,i)=>renderTrack(t,collTracks,i,collection?.type==='playlist'||collection?.type==='fav',()=>collection.type==='fav'?toggleSave(t):removeFromPlaylist(collection.id,t.id))):<Text style={styles.message}>{collection?.type==='playlist'?'Playlist vazia. Adicione músicas pelo menu (⋯) de cada faixa.':collection?.type==='fav'?'Nenhuma favorita ainda.':'Nenhuma música disponível.'}</Text>}
  </ScrollView>;

  const renderWelcome=()=> <View style={styles.welcome}>
    <View style={styles.brand}><Image source={require('./assets/logo.png')} style={styles.logoImg}/><Text style={styles.brandTitle}>spotifree</Text><Text style={styles.welcomeSub}>Ouça suas músicas favoritas{'\n'}sem pagar nada.</Text></View>
    <View style={{width:'100%',gap:12}}>
      <Btn green disabled={busy} onPress={startGuest}>{busy?<ActivityIndicator color="#04150b"/>:<><Ionicons name="play" size={18} color="#04150b"/><Text style={styles.greenText}>Começar agora</Text></>}</Btn>
      <Btn onPress={()=>{setMode('login');setAuthErr('');setAuthOpen(true);}} style={styles.outlineButton}><Text style={styles.trackTitle}>Entrar</Text></Btn>
      <Btn onPress={()=>{setMode('register');setAuthErr('');setAuthOpen(true);}} style={styles.outlineButton}><Text style={styles.trackTitle}>Criar conta</Text></Btn>
      {!fb.fbReady&&<Text style={[styles.small,{textAlign:'center'}]}>Para usar contas, configure o Firebase no arquivo .env.</Text>}</View>
  </View>;

  const progressPct=`${Math.min(100,position/(duration||30000)*100)}%`;
  return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle="light-content" backgroundColor={C.bg}/>
    <View style={styles.app}>
      {page==='welcome'?renderWelcome():<>
        <View style={{flex:1}}>
          {page==='home'&&renderHome()}
          {page==='search'&&renderSearch()}
          {page==='library'&&renderLibrary()}
          {page==='collection'&&renderCollection()}
        </View>
        {current&&<TouchableOpacity activeOpacity={.9} style={styles.miniPlayer} onPress={()=>setFullPlayer(true)}>
          <Cover src={current.cover} size={40}/><View style={{flex:1,minWidth:0}}><Text numberOfLines={1} style={styles.trackTitle}>{current.title}</Text><Text numberOfLines={1} style={styles.small}>{current.artist}</Text></View>
          <Btn style={styles.iconButton} onPress={toggle}><Ionicons name={playing?'pause':'play'} size={23} color={C.text}/></Btn>
          <View style={[styles.progress,{width:progressPct}]}/>
        </TouchableOpacity>}
        <View style={styles.nav}>
          {[['home','home','Início'],['search','search','Pesquisar'],['library','library','Biblioteca']].map(([p,ic,l])=><TouchableOpacity key={p} style={styles.navItem} onPress={()=>{setPage(p);setStack([]);}}>
            <Ionicons name={page===p?ic:ic+'-outline'} size={22} color={page===p?C.green:C.muted}/><Text style={[styles.navText,page===p&&{color:C.green}]}>{l}</Text>
          </TouchableOpacity>)}
        </View>
      </>}
    </View>

    <Modal visible={fullPlayer} animationType="slide" onRequestClose={()=>setFullPlayer(false)}>
      <SafeAreaView style={styles.playerScreen}>
        <View style={styles.playerTop}><Btn style={styles.iconButton} onPress={()=>setFullPlayer(false)}><Ionicons name="chevron-down" size={27} color={C.text}/></Btn><Text style={styles.trackTitle}>Tocando agora</Text><Btn style={styles.iconButton} onPress={()=>current&&setAddTrack(current)}><Ionicons name="ellipsis-horizontal" size={22} color={C.text}/></Btn></View>
        <View style={{alignItems:'center',marginTop:24}}><Cover src={current?.coverBig||current?.cover} size={300}/></View>
        <View style={styles.playerInfo}><View style={{flex:1}}><Text style={styles.playerTitle} numberOfLines={2}>{current?.title}</Text><Text style={styles.small}>{current?.artist}</Text></View>
          <Btn style={styles.iconButton} onPress={()=>current&&toggleSave(current)}><Ionicons name={current&&isSaved(current)?'heart':'heart-outline'} size={28} color={current&&isSaved(current)?C.green:C.text}/></Btn></View>
        <View style={{marginTop:22}}>
          <TouchableOpacity activeOpacity={1} onPress={seek} onLayout={e=>setSeekW(e.nativeEvent.layout.width||1)} style={{height:22,justifyContent:'center'}}>
            <View style={styles.seekTrack} pointerEvents="none"><View style={[styles.seekFill,{width:progressPct}]}/></View>
            <View pointerEvents="none" style={[styles.knob,{left:progressPct,marginLeft:-6}]}/>
          </TouchableOpacity>
          <View style={styles.times}><Text style={styles.small}>{fmt(position/1000)}</Text><Text style={styles.small}>{fmt(duration/1000)}</Text></View></View>
        <View style={styles.controls}>
          <Btn style={styles.iconButton} onPress={()=>setShuffle(s=>!s)}><Ionicons name="shuffle" size={24} color={shuffle?C.green:C.text}/></Btn>
          <Btn style={styles.iconButton} onPress={()=>step(-1)}><Ionicons name="play-skip-back" size={27} color={C.text}/></Btn>
          <Btn green style={styles.bigPlay} onPress={toggle}><Ionicons name={playing?'pause':'play'} size={30} color="#04150b"/></Btn>
          <Btn style={styles.iconButton} onPress={()=>step(1)}><Ionicons name="play-skip-forward" size={27} color={C.text}/></Btn>
          <Btn style={styles.iconButton} onPress={()=>setRepeat(r=>r==='off'?'all':r==='all'?'one':'off')}><Ionicons name={repeat==='one'?'repeat':'repeat'} size={24} color={repeat==='off'?C.text:C.green}/>{repeat==='one'&&<Text style={{color:C.green,fontSize:10,fontWeight:'800'}}>1</Text>}</Btn>
          <Btn style={styles.iconButton} onPress={()=>setDialog({title:sleepMinutes?'Timer ativo':'Timer de desligamento',msg:sleepMinutes?`A reprodução será pausada em ${sleepMinutes} minuto(s).`:'Escolha quanto tempo deve tocar.',actions:[
            {text:'Desligar',danger:sleepMinutes>0,onPress:sleepMinutes?()=>setSleepMinutes(0):undefined},
            {text:'15 min',onPress:()=>setSleepMinutes(15)},
            {text:'30 min',onPress:()=>setSleepMinutes(30)},
            {text:'60 min',onPress:()=>setSleepMinutes(60)},
          ]})}><Ionicons name="moon-outline" size={23} color={sleepMinutes?C.green:C.text}/></Btn>
        </View>
        <Text style={[styles.small,{textAlign:'center',marginTop:'auto',paddingBottom:20}]}>Prévia de 30 segundos fornecida pela Deezer.</Text>
      </SafeAreaView>
    </Modal>

    <Modal visible={!!addTrack} transparent animationType="slide" onRequestClose={()=>setAddTrack(null)}>
      <View style={styles.modalShade}><View style={styles.sheet}>
        <View style={styles.sheetHandle}/><Text style={styles.h2}>Adicionar à playlist</Text>
        <Text numberOfLines={1} style={styles.small}>{addTrack?.title} • {addTrack?.artist}</Text>
        <ScrollView style={{maxHeight:320,marginTop:8}}>
          <TouchableOpacity style={styles.sheetItem} onPress={()=>{const t=addTrack;setAddTrack(null);openCreate(t);}}><Text style={[styles.trackTitle,{color:C.green}]}>+ Nova playlist</Text></TouchableOpacity>
          <TouchableOpacity style={styles.sheetItem} onPress={()=>{toggleSave(addTrack);setAddTrack(null);}}><Text style={styles.trackTitle}>Minhas Favoritas</Text><Text style={styles.small}>{addTrack&&isSaved(addTrack)?'Remover ♥':'Adicionar ♡'}</Text></TouchableOpacity>
          {playlists.map(p=><TouchableOpacity key={p.id} style={styles.sheetItem} onPress={()=>{addToPlaylist(p.id,addTrack);setAddTrack(null);}}>
            <Text numberOfLines={1} style={[styles.trackTitle,{flex:1}]}>{p.name}</Text><Text style={styles.small}>{p.tracks.some(t=>t.id===addTrack?.id)?'Já está aqui':`${p.tracks.length} músicas`}</Text>
          </TouchableOpacity>)}
        </ScrollView>
        <Btn onPress={()=>setAddTrack(null)} style={[styles.outlineButton,{marginTop:14}]}><Text style={styles.trackTitle}>Fechar</Text></Btn>
      </View></View>
    </Modal>

    <Modal visible={createOpen} transparent animationType="fade" onRequestClose={()=>setCreateOpen(false)}>
      <View style={[styles.modalShade,{justifyContent:'center',padding:24}]}><View style={styles.dialog}>
        <Text style={styles.h2}>Nova playlist</Text>
        <TextInput autoFocus value={newName} onChangeText={setNewName} onSubmitEditing={submitCreate} placeholder="Nome da playlist" placeholderTextColor={C.muted} style={[styles.nameInput,{marginTop:14}]}/>
        <View style={styles.dialogBtns}><Btn onPress={()=>setCreateOpen(false)}><Text style={styles.trackTitle}>Cancelar</Text></Btn><Btn green onPress={submitCreate} style={{minHeight:42,paddingHorizontal:22}}><Text style={styles.greenText}>Criar</Text></Btn></View>
      </View></View>
    </Modal>

    <Modal visible={authOpen} transparent animationType="fade" onRequestClose={()=>setAuthOpen(false)}>
      <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={[styles.modalShade,{justifyContent:'center',padding:24}]}><View style={styles.dialog}>
        <Text style={styles.h2}>{mode==='login'?'Entrar':'Criar conta'}</Text>
        {mode==='register'&&<TextInput value={fName} onChangeText={setFName} placeholder="Seu nome" placeholderTextColor={C.muted} style={[styles.nameInput,{marginTop:14}]}/>}
        <TextInput value={fEmail} onChangeText={setFEmail} autoCapitalize="none" keyboardType="email-address" placeholder="E-mail" placeholderTextColor={C.muted} style={[styles.nameInput,{marginTop:12}]}/>
        <TextInput value={fPass} onChangeText={setFPass} secureTextEntry placeholder="Senha" placeholderTextColor={C.muted} onSubmitEditing={submitAuth} style={[styles.nameInput,{marginTop:12}]}/>
        {!!authErr&&<Text style={{color:'#ff6b81',marginTop:10,fontSize:13}}>{authErr}</Text>}
        <Btn green disabled={busy} onPress={submitAuth} style={{marginTop:16}}>{busy?<ActivityIndicator color="#04150b"/>:<Text style={styles.greenText}>{mode==='login'?'Entrar':'Criar conta'}</Text>}</Btn>
        <Btn onPress={()=>{setMode(m=>m==='login'?'register':'login');setAuthErr('');}}><Text style={styles.small}>{mode==='login'?'Não tem conta? Criar conta':'Já tem conta? Entrar'}</Text></Btn>
        <Btn onPress={()=>setAuthOpen(false)}><Text style={styles.small}>Cancelar</Text></Btn>
      </View></KeyboardAvoidingView>
    </Modal>

    <Modal visible={!!dialog} transparent animationType="fade" onRequestClose={()=>setDialog(null)}>
      <View style={[styles.modalShade,{justifyContent:'center',padding:24}]}><View style={styles.dialog}>
        <Text style={styles.h2}>{dialog?.title}</Text>{!!dialog?.msg&&<Text style={[styles.message,{marginTop:8}]}>{dialog.msg}</Text>}
        <View style={styles.dialogBtns}>{(dialog?.actions||[]).map((a,i)=><Btn key={i} onPress={()=>{const f=a.onPress;setDialog(null);f&&f();}}><Text style={[styles.trackTitle,a.danger&&{color:'#ff6b81'}]}>{a.text}</Text></Btn>)}</View>
      </View></View>
    </Modal>
  </SafeAreaView>;
}

const styles=StyleSheet.create({
 safe:{flex:1,backgroundColor:C.bg,paddingTop:Platform.OS==='android'?StatusBar.currentHeight:0},
 app:{flex:1,maxWidth:520,width:'100%',alignSelf:'center',backgroundColor:C.bg},
 screen:{paddingHorizontal:20,paddingTop:18,paddingBottom:28},
 header:{flexDirection:'row',alignItems:'center',gap:12,marginBottom:16},
 h1:{fontSize:28,fontWeight:'800',color:C.text},h2:{fontSize:20,fontWeight:'700',color:C.text},
 small:{fontSize:12,color:C.muted},message:{fontSize:14,color:C.muted,lineHeight:22,marginTop:24},
 button:{minHeight:42,paddingHorizontal:12,borderRadius:24,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:8},
 greenButton:{backgroundColor:C.green,minHeight:52},greenText:{color:'#04150b',fontSize:16,fontWeight:'700'},
 outlineButton:{borderWidth:1,borderColor:'#cfe0d6',minHeight:50},
 searchPill:{height:48,borderRadius:25,backgroundColor:C.surface,borderWidth:1,borderColor:C.line,flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:15,marginBottom:6},
 placeholder:{color:C.muted,fontSize:13,flex:1},searchInput:{flex:1,color:C.text,fontSize:14,paddingVertical:8,outlineStyle:'none'},
 sectionTitle:{fontSize:19,fontWeight:'700',color:C.text,marginTop:24,marginBottom:12},
 horizontal:{gap:14,paddingRight:20},card:{width:112},cardTitle:{fontSize:13,fontWeight:'600',color:C.text,marginTop:8},
 cover:{backgroundColor:C.surface2,alignItems:'center',justifyContent:'center',overflow:'hidden'},
 trackRow:{flexDirection:'row',alignItems:'center',borderBottomWidth:1,borderBottomColor:C.line,gap:4},
 trackMain:{flex:1,minWidth:0,flexDirection:'row',alignItems:'center',gap:13,paddingVertical:9},
 trackTitle:{fontSize:14,fontWeight:'600',color:C.text},iconButton:{width:40,minHeight:40,paddingHorizontal:5},
 tabs:{flexDirection:'row',marginBottom:12,backgroundColor:C.surface,borderRadius:24,padding:4},
 tab:{flex:1,height:38,borderRadius:20,alignItems:'center',justifyContent:'center'},tabOn:{backgroundColor:C.green},tabLabel:{color:C.text,fontWeight:'700',fontSize:13},
 nav:{height:62,flexDirection:'row',borderTopWidth:1,borderTopColor:C.line,backgroundColor:'#0a1510'},
 navItem:{flex:1,alignItems:'center',justifyContent:'center',gap:2},navText:{fontSize:11,color:C.muted},
 miniPlayer:{marginHorizontal:10,marginBottom:7,padding:8,borderRadius:13,backgroundColor:C.surface2,flexDirection:'row',alignItems:'center',gap:10,overflow:'hidden'},
 progress:{position:'absolute',height:2,bottom:0,left:0,backgroundColor:C.green},
 welcome:{flex:1,justifyContent:'space-between',alignItems:'center',paddingHorizontal:28,paddingTop:60,paddingBottom:40},
 brand:{alignItems:'center',marginTop:35},logoImg:{width:130,height:116,borderRadius:22},
 brandTitle:{fontSize:48,fontWeight:'800',color:C.text,letterSpacing:-1,marginTop:8},welcomeSub:{fontSize:15,color:C.muted,textAlign:'center',lineHeight:24,marginTop:10},
 nameInput:{height:46,borderRadius:24,backgroundColor:C.surface2,paddingHorizontal:18,color:C.text,outlineStyle:'none'},
 playerScreen:{flex:1,backgroundColor:C.bg,paddingHorizontal:24,paddingTop:12,paddingBottom:20},
 playerTop:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
 playerInfo:{flexDirection:'row',alignItems:'center',marginTop:26,gap:12},playerTitle:{fontSize:23,fontWeight:'800',color:C.text,marginBottom:5},
 seekTrack:{height:4,backgroundColor:'#ffffff30',borderRadius:4,overflow:'hidden'},seekFill:{height:4,backgroundColor:C.green},
 knob:{position:'absolute',width:12,height:12,borderRadius:6,backgroundColor:C.green},
 times:{flexDirection:'row',justifyContent:'space-between',marginTop:4},
 controls:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:24},
 bigPlay:{width:68,height:68,borderRadius:40,paddingHorizontal:0},playSmall:{width:42,height:42,minHeight:42,paddingHorizontal:0},
 modalShade:{flex:1,backgroundColor:'#000a',justifyContent:'flex-end'},sheet:{backgroundColor:C.surface,borderTopLeftRadius:22,borderTopRightRadius:22,padding:22,paddingBottom:30,width:'100%',maxWidth:520,alignSelf:'center'},
 dialog:{backgroundColor:C.surface,borderRadius:20,padding:22,width:'100%',maxWidth:420,alignSelf:'center'},
 dialogBtns:{flexDirection:'row',justifyContent:'flex-end',gap:8,marginTop:18},
 sheetHandle:{width:42,height:4,borderRadius:3,backgroundColor:C.muted,alignSelf:'center',marginBottom:18},
 sheetItem:{paddingVertical:15,borderBottomWidth:1,borderBottomColor:C.line,flexDirection:'row',justifyContent:'space-between',gap:10}
});
