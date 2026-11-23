import React, {useEffect, useRef, useState, useCallback} from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Image, StyleSheet,
  SafeAreaView, StatusBar, ActivityIndicator, Modal, Alert, Platform
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Audio} from 'expo-av';
import {Ionicons} from '@expo/vector-icons';
import * as api from './src/api';

const C = {bg:'#08130e', surface:'#121d17', surface2:'#1b2922', line:'#1f2d26', green:'#22e06b', text:'#f2f7f4', muted:'#8c9d94', pink:'#b5456d'};
const fmt = s => `${Math.floor((s||0)/60)}:${String(Math.floor((s||0)%60)).padStart(2,'0')}`;
const playable = arr => (arr||[]).map(api.norm).filter(t=>t.preview);

function Btn({children,onPress,style,green=false}) {
  return <TouchableOpacity onPress={onPress} activeOpacity={.75} style={[styles.button,green&&styles.greenButton,style]}>{children}</TouchableOpacity>;
}
function Cover({src,size=52,round=false}) {
  return <View style={[styles.cover,{width:size,height:size,borderRadius:round?size/2:10}]}>
    {src ? <Image source={{uri:src}} style={{width:'100%',height:'100%',borderRadius:round?size/2:10}}/> :
      <Ionicons name="musical-notes" size={24} color={C.muted}/>}
  </View>;
}
function TrackRow({track,onPlay,onMore,active}) {
  return <View style={styles.trackRow}>
    <TouchableOpacity style={styles.trackMain} onPress={onPlay}>
      <Cover src={track.cover}/>
      <View style={{flex:1}}>
        <Text numberOfLines={1} style={[styles.trackTitle,active&&{color:C.green}]}>{track.title}</Text>
        <Text numberOfLines={1} style={styles.small}>{track.artist}{active?' • tocando':''}</Text>
      </View>
    </TouchableOpacity>
    {onMore && <Btn onPress={onMore} style={styles.iconButton}><Ionicons name="ellipsis-vertical" size={20} color={C.text}/></Btn>}
  </View>;
}
function Section({title,children}) {
  return <><Text style={styles.sectionTitle}>{title}</Text>{children}</>;
}

export default function App() {
  const [user,setUser]=useState(null), [saved,setSaved]=useState([]), [playlists,setPlaylists]=useState([{id:'fav',name:'Minhas Favoritas',tracks:[]}]);
  const [page,setPage]=useState('welcome'), [stack,setStack]=useState([]);
  const [homeData,setHomeData]=useState(null), [homeError,setHomeError]=useState(false);
  const [query,setQuery]=useState(''), [results,setResults]=useState([]), [searchState,setSearchState]=useState('idle');
  const [collection,setCollection]=useState(null), [collectionTracks,setCollectionTracks]=useState(null);
  const [sound,setSound]=useState(null), [current,setCurrent]=useState(null), [queue,setQueue]=useState([]), [index,setIndex]=useState(-1);
  const [playing,setPlaying]=useState(false), [position,setPosition]=useState(0), [duration,setDuration]=useState(30000);
  const [fullPlayer,setFullPlayer]=useState(false), [addTrack,setAddTrack]=useState(null), [newName,setNewName]=useState('');
  const [welcomeName,setWelcomeName]=useState('');

  useEffect(()=>{(async()=>{
    try {
      const [u,s,p]=await Promise.all(['sf_user','sf_saved','sf_playlists'].map(k=>AsyncStorage.getItem(k)));
      if(u) setUser(JSON.parse(u)); if(s) setSaved(JSON.parse(s)); if(p) setPlaylists(JSON.parse(p));
    } catch(e){}
  })();},[]);
  useEffect(()=>{AsyncStorage.setItem('sf_user',JSON.stringify(user)).catch(()=>{});},[user]);
  useEffect(()=>{AsyncStorage.setItem('sf_saved',JSON.stringify(saved)).catch(()=>{});},[saved]);
  useEffect(()=>{AsyncStorage.setItem('sf_playlists',JSON.stringify(playlists)).catch(()=>{});},[playlists]);

  useEffect(()=>{if(page!=='home'||homeData)return; let live=true;
    Promise.all([api.chartTracks(),api.chartArtists(),api.chartAlbums()])
      .then(([t,a,b])=>{if(live)setHomeData({tracks:playable(t),artists:a,albums:b});})
      .catch(()=>{if(live)setHomeError(true);});
    return ()=>{live=false;};
  },[page,homeData]);
  useEffect(()=>{if(page!=='search')return;
    if(query.trim().length<2){setResults([]);setSearchState('idle');return;}
    let live=true;setSearchState('loading');
    const timer=setTimeout(()=>api.search(query.trim()).then(d=>{if(live){setResults(playable(d));setSearchState('done');}})
      .catch(()=>{if(live)setSearchState('error');}),450);
    return ()=>{live=false;clearTimeout(timer);};
  },[query,page]);

  const stopSound=useCallback(async()=>{if(sound){try{await sound.unloadAsync();}catch(e){} setSound(null);}},[sound]);
  useEffect(()=>()=>{if(sound)sound.unloadAsync().catch(()=>{});},[sound]);
  const playAt=async(list,i)=>{
    const track=list?.[i]; if(!track?.preview)return;
    await stopSound();
    setQueue(list);setIndex(i);setCurrent(track);setPosition(0);setPlaying(true);
    try {
      const {sound:next}=await Audio.Sound.createAsync({uri:track.preview},{shouldPlay:true,progressUpdateIntervalMillis:500},
        status=>{if(status.isLoaded){setPosition(status.positionMillis||0);setDuration(status.durationMillis||30000);setPlaying(status.isPlaying);if(status.didJustFinish)nextStep(list,i);}});
      setSound(next);
    } catch(e){setPlaying(false);Alert.alert('Não foi possível reproduzir','Tente outra música.');}
  };
  const nextStep=async(list=queue,idx=index)=>{
    if(!list?.length)return;
    const n=(idx+1)%list.length; await playAt(list,n);
  };
  const toggle=async()=>{if(!sound)return;try{if(playing)await sound.pauseAsync();else await sound.playAsync();setPlaying(!playing);}catch(e){}};
  const step=async(dir)=>{if(!queue.length)return;await playAt(queue,(index+dir+queue.length)%queue.length);};
  const seek=async(v)=>{setPosition(v);if(sound)try{await sound.setPositionAsync(v);}catch(e){}};
  const isSaved=t=>saved.some(x=>x.id===t.id);
  const toggleSave=t=>setSaved(old=>old.some(x=>x.id===t.id)?old.filter(x=>x.id!==t.id):[t,...old]);
  const createPlaylist=name=>{const id='p'+Date.now();setPlaylists(p=>[...p,{id,name:name.trim()||'Nova playlist',tracks:[]}]);return id;};
  const addToPlaylist=(pid,t)=>setPlaylists(p=>p.map(x=>x.id===pid&&!x.tracks.some(y=>y.id===t.id)?{...x,tracks:[...x.tracks,t]}:x));
  const removeFromPlaylist=(pid,tid)=>setPlaylists(p=>p.map(x=>x.id===pid?{...x,tracks:x.tracks.filter(t=>t.id!==tid)}:x));
  const openCollection=async item=>{
    setCollection(item);setCollectionTracks(item.type==='playlist'?playlists.find(p=>p.id===item.id)?.tracks:null);
    setStack(s=>[...s,page]);setPage('collection');
    if(item.type!=='playlist'){
      setCollectionTracks(null);
      try {const d=item.type==='artist'?await api.artistTop(item.id):await api.albumTracks(item.id);setCollectionTracks(playable(d));}
      catch(e){setCollectionTracks([]);}
    }
  };
  const back=()=>{setPage(stack[stack.length-1]||'home');setStack(s=>s.slice(0,-1));};
  const enter=()=>{setPage('home');setStack([]);};
  const addNewPlaylist=()=>{if(!newName.trim())return;createPlaylist(newName);setNewName('');};
  const addToNewOrExisting=pid=>{addToPlaylist(pid,addTrack);setAddTrack(null);};

  const renderTrack=(t,list,i,removable=false,pid=null)=><TrackRow key={`${t.id}-${i}`} track={t} active={current?.id===t.id}
    onPlay={()=>playAt(list,i)} onMore={removable?()=>Alert.alert('Remover música','Deseja remover esta música da playlist?',[
      {text:'Cancelar',style:'cancel'},{text:'Remover',style:'destructive',onPress:()=>removeFromPlaylist(pid,t.id)}]):()=>setAddTrack(t)}/>;

  const renderHome=()=> <ScrollView contentContainerStyle={styles.screen}>
    <View style={styles.header}><View><Text style={styles.small}>Olá{user?`, ${user}`:''}! 👋</Text><Text style={styles.h1}>Início</Text></View></View>
    <Btn style={styles.searchPill} onPress={()=>{setPage('search');setQuery('');}}><Ionicons name="search" size={20} color={C.muted}/><Text style={styles.placeholder}>Pesquisar músicas, artistas, álbuns...</Text></Btn>
    {homeError&&<Text style={styles.message}>Não foi possível carregar a Deezer. Verifique sua conexão.</Text>}
    {!homeData&&!homeError&&<ActivityIndicator color={C.green} style={{marginTop:28}}/>}
    {homeData&&<>
      <Section title="Destaques"><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontal}>
        {homeData.tracks.map((t,i)=><TouchableOpacity key={t.id} style={styles.card} onPress={()=>playAt(homeData.tracks,i)}><Cover src={t.coverBig||t.cover} size={112}/><Text numberOfLines={1} style={styles.cardTitle}>{t.title}</Text><Text numberOfLines={1} style={styles.small}>{t.artist}</Text></TouchableOpacity>)}
      </ScrollView></Section>
      <Section title="Artistas em alta"><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontal}>
        {homeData.artists.map(a=><TouchableOpacity key={a.id} style={[styles.card,{width:82,alignItems:'center'}]} onPress={()=>openCollection({type:'artist',id:a.id,title:a.name,sub:'Mais tocadas',cover:a.picture_medium})}><Cover src={a.picture_medium} size={76} round/><Text numberOfLines={1} style={styles.small}>{a.name}</Text></TouchableOpacity>)}
      </ScrollView></Section>
      <Section title="Álbuns recomendados"><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontal}>
        {homeData.albums.map(a=><TouchableOpacity key={a.id} style={styles.card} onPress={()=>openCollection({type:'album',id:a.id,title:a.title,sub:a.artist?.name,cover:a.cover_medium})}><Cover src={a.cover_big||a.cover_medium} size={112}/><Text numberOfLines={1} style={styles.cardTitle}>{a.title}</Text><Text numberOfLines={1} style={styles.small}>{a.artist?.name}</Text></TouchableOpacity>)}
      </ScrollView></Section>
    </>}
  </ScrollView>;

  const renderSearch=()=> <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
    <Text style={styles.h1}>Pesquisar</Text>
    <View style={[styles.searchPill,{marginTop:18}]}><Ionicons name="search" size={20} color={C.muted}/><TextInput value={query} onChangeText={setQuery} placeholder="Músicas, artistas, álbuns..." placeholderTextColor={C.muted} style={styles.searchInput}/></View>
    {searchState==='idle'&&<Text style={styles.message}>Digite pelo menos 2 letras para buscar.</Text>}
    {searchState==='loading'&&<ActivityIndicator color={C.green} style={{marginTop:24}}/>}
    {searchState==='error'&&<Text style={styles.message}>A busca falhou. Tente novamente.</Text>}
    {searchState==='done'&&!results.length&&<Text style={styles.message}>Nada encontrado para “{query}”.</Text>}
    {results.map((t,i)=>renderTrack(t,results,i))}
  </ScrollView>;

  const renderLibrary=()=> <ScrollView contentContainerStyle={styles.screen}>
    <Text style={styles.h1}>Biblioteca</Text>
    <View style={styles.tabs}><Text style={styles.tabLabel}>Playlists</Text></View>
    <Btn style={styles.newPlaylist} onPress={()=>Alert.prompt?Alert.prompt('Nova playlist','Nome da playlist',v=>v&&createPlaylist(v)):(setNewName(''),Alert.alert('Criar playlist','Use o campo abaixo para nomear sua playlist.'))}>
      <Ionicons name="add-circle-outline" size={25} color={C.text}/><Text style={styles.trackTitle}>Nova playlist</Text>
    </Btn>
    <View style={styles.inlineCreate}><TextInput value={newName} onChangeText={setNewName} placeholder="Nome da playlist" placeholderTextColor={C.muted} style={styles.searchInput}/><Btn green onPress={addNewPlaylist} style={{width:85,height:40}}><Text style={{color:'#04150b',fontWeight:'700'}}>Criar</Text></Btn></View>
    {playlists.map(p=><View key={p.id} style={styles.trackRow}>
      <TouchableOpacity style={styles.trackMain} onPress={()=>{setCollection({type:'playlist',id:p.id,title:p.name});setCollectionTracks(p.tracks);setStack(s=>[...s,'library']);setPage('collection');}}>
        <Cover src={p.tracks[0]?.cover} size={56}/><View><Text style={styles.trackTitle}>{p.name}</Text><Text style={styles.small}>{p.tracks.length} músicas</Text></View>
      </TouchableOpacity>
      {p.id!=='fav'&&<Btn style={styles.iconButton} onPress={()=>Alert.alert('Excluir playlist',`Excluir "${p.name}"?`,[{text:'Cancelar',style:'cancel'},{text:'Excluir',style:'destructive',onPress:()=>setPlaylists(x=>x.filter(y=>y.id!==p.id))}])}><Ionicons name="trash-outline" size={19} color={C.text}/></Btn>}
    </View>)}
    <Section title="Músicas salvas">{saved.length?saved.map((t,i)=>renderTrack(t,saved,i)):<Text style={styles.message}>Nenhuma música salva. Use o coração no player.</Text>}</Section>
  </ScrollView>;

  const renderCollection=()=> <ScrollView contentContainerStyle={styles.screen}>
    <View style={styles.header}><Btn style={styles.iconButton} onPress={back}><Ionicons name="chevron-back" size={25} color={C.text}/></Btn><View style={{flex:1}}><Text style={styles.h2}>{collection?.title}</Text>{!!collection?.sub&&<Text style={styles.small}>{collection.sub}</Text>}</View>
    {!!collectionTracks?.length&&<Btn green style={styles.playSmall} onPress={()=>playAt(collectionTracks,0)}><Ionicons name="play" size={19} color="#04150b"/></Btn>}</View>
    {collectionTracks===null?<ActivityIndicator color={C.green}/>:collectionTracks.length?collectionTracks.map((t,i)=>renderTrack(t,collectionTracks,i,collection?.type==='playlist',collection?.id)):<Text style={styles.message}>{collection?.type==='playlist'?'Playlist vazia. Adicione músicas pelo menu de cada faixa.':'Nenhuma música disponível.'}</Text>}
  </ScrollView>;

  const renderWelcome=()=> <View style={styles.welcome}>
    <View style={styles.brand}><View style={styles.logo}><Ionicons name="play" size={42} color={C.green}/></View><Text style={styles.brandTitle}>spotifree</Text><Text style={styles.welcomeSub}>Ouça suas músicas favoritas{'\n'}sem pagar nada.</Text></View>
    <View style={{width:'100%',gap:12}}><Btn green onPress={enter}><Ionicons name="play" size={18} color="#04150b"/><Text style={styles.greenText}>Começar agora</Text></Btn>
      <TextInput value={welcomeName} onChangeText={setWelcomeName} placeholder="Seu nome (opcional)" placeholderTextColor={C.muted} style={styles.nameInput}/>
      <Btn onPress={()=>{setUser(welcomeName.trim()||null);enter();}} style={styles.outlineButton}><Text style={styles.trackTitle}>Entrar</Text></Btn></View>
  </View>;

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
        {current&&<TouchableOpacity style={styles.miniPlayer} onPress={()=>setFullPlayer(true)}>
          <Cover src={current.cover} size={40}/><View style={{flex:1}}><Text numberOfLines={1} style={styles.trackTitle}>{current.title}</Text><Text numberOfLines={1} style={styles.small}>{current.artist}</Text></View>
          <Btn style={styles.iconButton} onPress={toggle}><Ionicons name={playing?'pause':'play'} size={23} color={C.text}/></Btn>
          <View style={[styles.progress,{width:`${Math.min(100,position/(duration||30000)*100)}%`}]}/>
        </TouchableOpacity>}
        <View style={styles.nav}>
          {['home','search','library'].map((p,i)=><TouchableOpacity key={p} style={styles.navItem} onPress={()=>{setPage(p);setStack([]);}}>
            <Ionicons name={['home','search','library'][i]} size={22} color={page===p?C.green:C.muted}/><Text style={[styles.navText,page===p&&{color:C.green}]}>{['Início','Pesquisar','Biblioteca'][i]}</Text>
          </TouchableOpacity>)}
        </View>
      </>}
    </View>

    <Modal visible={fullPlayer} animationType="slide" presentationStyle="fullScreen" onRequestClose={()=>setFullPlayer(false)}>
      <SafeAreaView style={styles.playerScreen}>
        <View style={styles.playerTop}><Btn style={styles.iconButton} onPress={()=>setFullPlayer(false)}><Ionicons name="chevron-down" size={27} color={C.text}/></Btn><Text style={styles.small}>Tocando agora</Text><View style={{width:40}}/></View>
        <View style={{alignItems:'center',marginTop:24}}><Cover src={current?.coverBig||current?.cover} size={300}/></View>
        <View style={styles.playerInfo}><View style={{flex:1}}><Text style={styles.playerTitle} numberOfLines={2}>{current?.title}</Text><Text style={styles.small}>{current?.artist}</Text></View>
          <Btn style={styles.iconButton} onPress={()=>current&&toggleSave(current)}><Ionicons name={current&&isSaved(current)?'heart':'heart-outline'} size={28} color={current&&isSaved(current)?C.green:C.text}/></Btn>
        </View>
        <View style={{marginTop:26}}><View style={styles.seekTrack}><View style={[styles.seekFill,{width:`${Math.min(100,position/(duration||30000)*100)}%`}]}/></View>
          <View style={styles.times}><Text style={styles.small}>{fmt(position/1000)}</Text><Text style={styles.small}>{fmt(duration/1000)}</Text></View></View>
        <View style={styles.controls}>
          <Btn style={styles.iconButton} onPress={()=>step(-1)}><Ionicons name="play-skip-back" size={27} color={C.text}/></Btn>
          <Btn green style={styles.bigPlay} onPress={toggle}><Ionicons name={playing?'pause':'play'} size={30} color="#04150b"/></Btn>
          <Btn style={styles.iconButton} onPress={()=>step(1)}><Ionicons name="play-skip-forward" size={27} color={C.text}/></Btn>
        </View>
        <Btn style={{marginTop:24,alignSelf:'center'}} onPress={()=>setAddTrack(current)}><Ionicons name="list" size={19} color={C.muted}/><Text style={styles.small}>  Adicionar à playlist</Text></Btn>
        <Text style={[styles.small,{textAlign:'center',marginTop:'auto',paddingBottom:20}]}>Prévia de 30 segundos fornecida pela Deezer.</Text>
      </SafeAreaView>
    </Modal>

    <Modal visible={!!addTrack} transparent animationType="slide" onRequestClose={()=>setAddTrack(null)}>
      <View style={styles.modalShade}><View style={styles.sheet}>
        <View style={styles.sheetHandle}/><Text style={styles.h2}>Adicionar à playlist</Text>
        <Text style={styles.small}>{addTrack?.title} • {addTrack?.artist}</Text>
        <ScrollView style={{maxHeight:360}}>{playlists.map(p=><TouchableOpacity key={p.id} style={styles.sheetItem} onPress={()=>addToNewOrExisting(p.id)}>
          <Text style={styles.trackTitle}>{p.name}</Text><Text style={styles.small}>{p.tracks.some(t=>t.id===addTrack?.id)?'Já está aqui':`${p.tracks.length} músicas`}</Text>
        </TouchableOpacity>)}</ScrollView>
        <Btn onPress={()=>setAddTrack(null)} style={styles.outlineButton}><Text style={styles.trackTitle}>Fechar</Text></Btn>
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
 searchPill:{height:48,borderRadius:25,backgroundColor:C.surface,borderWidth:1,borderColor:C.line,justifyContent:'flex-start',paddingHorizontal:15,marginBottom:6},
 placeholder:{color:C.muted,fontSize:13},searchInput:{flex:1,color:C.text,fontSize:14,paddingVertical:8},
 sectionTitle:{fontSize:19,fontWeight:'700',color:C.text,marginTop:24,marginBottom:12},
 horizontal:{gap:14,paddingRight:20},card:{width:112},cardTitle:{fontSize:13,fontWeight:'600',color:C.text,marginTop:8},
 cover:{backgroundColor:C.surface2,alignItems:'center',justifyContent:'center',overflow:'hidden'},
 trackRow:{flexDirection:'row',alignItems:'center',borderBottomWidth:1,borderBottomColor:C.line,gap:4},
 trackMain:{flex:1,minWidth:0,flexDirection:'row',alignItems:'center',gap:13,paddingVertical:9},
 trackTitle:{fontSize:14,fontWeight:'600',color:C.text},iconButton:{width:40,minHeight:40,paddingHorizontal:5},
 tabs:{marginTop:18,backgroundColor:C.surface,borderRadius:22,padding:12},tabLabel:{color:C.green,fontWeight:'700'},
 newPlaylist:{justifyContent:'flex-start',marginTop:12,backgroundColor:C.surface2,padding:12,borderRadius:12},
 inlineCreate:{flexDirection:'row',alignItems:'center',gap:8,marginTop:8},
 nav:{height:62,flexDirection:'row',borderTopWidth:1,borderTopColor:C.line,backgroundColor:'#0a1510'},
 navItem:{flex:1,alignItems:'center',justifyContent:'center',gap:2},navText:{fontSize:11,color:C.muted},
 miniPlayer:{marginHorizontal:10,marginBottom:7,padding:8,borderRadius:13,backgroundColor:C.surface2,flexDirection:'row',alignItems:'center',gap:10,overflow:'hidden'},
 progress:{position:'absolute',height:2,bottom:0,left:8,backgroundColor:C.green},
 welcome:{flex:1,justifyContent:'space-between',alignItems:'center',paddingHorizontal:28,paddingTop:85,paddingBottom:40},
 brand:{alignItems:'center',marginTop:35},logo:{width:90,height:90,borderWidth:8,borderColor:C.green,borderRadius:50,alignItems:'center',justifyContent:'center'},
 brandTitle:{fontSize:48,fontWeight:'800',color:C.text,letterSpacing:-1},welcomeSub:{fontSize:15,color:C.muted,textAlign:'center',lineHeight:24,marginTop:10},
 nameInput:{height:45,borderRadius:24,backgroundColor:C.surface,paddingHorizontal:18,color:C.text},
 playerScreen:{flex:1,backgroundColor:C.bg,paddingHorizontal:24,paddingTop:12,paddingBottom:20},
 playerTop:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
 playerInfo:{flexDirection:'row',alignItems:'center',marginTop:26,gap:12},playerTitle:{fontSize:23,fontWeight:'800',color:C.text,marginBottom:5},
 seekTrack:{height:4,backgroundColor:'#ffffff30',borderRadius:4,overflow:'hidden'},seekFill:{height:4,backgroundColor:C.green},
 times:{flexDirection:'row',justifyContent:'space-between',marginTop:8},
 controls:{flexDirection:'row',alignItems:'center',justifyContent:'space-around',marginTop:28},
 bigPlay:{width:68,height:68,borderRadius:40},playSmall:{width:42,height:42,minHeight:42},
 modalShade:{flex:1,backgroundColor:'#000a',justifyContent:'flex-end'},sheet:{backgroundColor:C.surface,borderTopLeftRadius:22,borderTopRightRadius:22,padding:22,paddingBottom:30},
 sheetHandle:{width:42,height:4,borderRadius:3,backgroundColor:C.muted,alignSelf:'center',marginBottom:18},
 sheetItem:{paddingVertical:15,borderBottomWidth:1,borderBottomColor:C.line,flexDirection:'row',justifyContent:'space-between'}
});
