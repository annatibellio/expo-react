import React, {useEffect, useRef, useState, useCallback} from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Image, StyleSheet,
  SafeAreaView, StatusBar, ActivityIndicator, Modal, Platform
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Audio} from 'expo-av';
import Slider from '@react-native-community/slider';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {Ionicons} from '@expo/vector-icons';
import * as api from './src/api';
import {createUserWithEmailAndPassword, GoogleAuthProvider, onAuthStateChanged, PhoneAuthProvider, RecaptchaVerifier, sendPasswordResetEmail, signInWithCredential, signInWithEmailAndPassword, signInWithPopup, signOut, updateProfile} from 'firebase/auth';
import {doc, getDoc, serverTimestamp, setDoc} from 'firebase/firestore';
import {firebaseConfigured, db} from './src/firebase';
import {auth} from './src/firebaseAuth';

const C = {bg:'#08130e', surface:'#121d17', surface2:'#1b2922', line:'#1f2d26', green:'#22e06b', text:'#f2f7f4', muted:'#8c9d94', pink:'#b5456d'};
const fmt = s => `${Math.floor((s||0)/60)}:${String(Math.floor((s||0)%60)).padStart(2,'0')}`;
const playable = arr => (arr||[]).map(t=>t.isLocal?t:api.norm(t)).filter(t=>t.isLocal?t.localUri:t.preview);
const emptyPlaylists = () => [{id:'fav',name:'Minhas Favoritas',tracks:[]}];
const withoutLocalTracks = tracks => tracks.filter(track=>!track.isLocal);
const authMessage = error => ({
  'auth/email-already-in-use':'Este e-mail já possui uma conta.',
  'auth/invalid-email':'Digite um e-mail válido.',
  'auth/invalid-credential':'E-mail ou senha incorretos.',
  'auth/weak-password':'A senha precisa ter pelo menos 6 caracteres.',
  'auth/network-request-failed':'Sem conexão. Verifique a internet e tente novamente.',
  'auth/too-many-requests':'Muitas tentativas. Aguarde um pouco e tente novamente.',
  'auth/operation-not-allowed':'Este método não está disponível. Para SMS, confira também se a região está habilitada nas configurações de Authentication.',
  'auth/popup-closed-by-user':'A janela de login do Google foi fechada antes de concluir.',
}[error?.code] || error?.message || 'Não foi possível concluir a operação.');

function Btn({children,onPress,style,green=false,disabled=false}) {
  return <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={.75} style={[styles.button,green&&styles.greenButton,style,disabled&&{opacity:.55}]}>{children}</TouchableOpacity>;
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
  const [user,setUser]=useState(null), [authUser,setAuthUser]=useState(null), [saved,setSaved]=useState([]), [playlists,setPlaylists]=useState(emptyPlaylists);
  const [page,setPage]=useState('welcome'), [stack,setStack]=useState([]);
  const [homeData,setHomeData]=useState(null), [homeError,setHomeError]=useState(false);
  const [query,setQuery]=useState(''), [results,setResults]=useState([]), [artistResults,setArtistResults]=useState([]), [albumResults,setAlbumResults]=useState([]), [searchState,setSearchState]=useState('idle'), [searchCategory,setSearchCategory]=useState('all');
  const [collection,setCollection]=useState(null), [collectionTracks,setCollectionTracks]=useState(null);
  const [sound,setSound]=useState(null), [current,setCurrent]=useState(null), [queue,setQueue]=useState([]), [index,setIndex]=useState(-1);
  const [playing,setPlaying]=useState(false), [position,setPosition]=useState(0), [duration,setDuration]=useState(30000);
  const seeking=useRef(false);
  const [fullPlayer,setFullPlayer]=useState(false), [addTrack,setAddTrack]=useState(null), [newName,setNewName]=useState('');
  const [playlistError,setPlaylistError]=useState('');
  const playlistInputRef=useRef(null);
  const [welcomeName,setWelcomeName]=useState('');
  const [authLoading,setAuthLoading]=useState(true), [cloudReady,setCloudReady]=useState(false);
  const [authMode,setAuthMode]=useState('login'), [email,setEmail]=useState(''), [password,setPassword]=useState('');
  const [authReturnPage,setAuthReturnPage]=useState('settings');
  const [authBusy,setAuthBusy]=useState(false), [authError,setAuthError]=useState('');
  const [phone,setPhone]=useState(''), [phoneCode,setPhoneCode]=useState(''), [phoneVerificationId,setPhoneVerificationId]=useState('');
  const recaptchaRef=useRef(null);
  const [storageError,setStorageError]=useState(''), [cloudError,setCloudError]=useState('');
  const [dialog,setDialog]=useState(null);
  const [importing,setImporting]=useState(false), [importError,setImportError]=useState('');
  const showMessage=useCallback((title,message)=>setDialog({title,message}),[]);
  const askConfirm=useCallback((title,message,onConfirm)=>setDialog({title,message,onConfirm}),[]);

  useEffect(()=>{
    let active=true,unsubscribe;
    (async()=>{
    let localSaved=[],localPlaylists=emptyPlaylists();
    try {
      const [u,s,p]=await Promise.all(['sf_user','sf_saved','sf_playlists'].map(k=>AsyncStorage.getItem(k)));
      if(!active)return;
      if(u) setUser(JSON.parse(u));
      if(s){localSaved=JSON.parse(s);setSaved(localSaved);}
      if(p){localPlaylists=JSON.parse(p);setPlaylists(localPlaylists);}
    } catch(e){if(active)setStorageError('Não foi possível carregar os dados deste dispositivo.');}
    if(!firebaseConfigured){if(active)setAuthLoading(false);return;}
    unsubscribe=onAuthStateChanged(auth,async current=>{
      if(!active)return;
      if(current?.isAnonymous){
        setAuthUser(null);
        setCloudReady(false);
        setUser(null);
        setPage('welcome');
        setStack([]);
        setAuthLoading(false);
        signOut(auth).catch(()=>{if(active)setCloudError('Não foi possível encerrar a sessão de visitante.');});
        return;
      }
      setAuthUser(current);
      setCloudReady(false);
      if(current){
        setUser(current.displayName||current.email||null);
        setPage('home');
        try {
          const ref=doc(db,'users',current.uid), snapshot=await getDoc(ref);
          if(!active)return;
          if(snapshot.exists()){
            const data=snapshot.data();
            if(Array.isArray(data.saved))setSaved(current=>[...data.saved,...current.filter(track=>track.isLocal)]);
            if(Array.isArray(data.playlists))setPlaylists(current=>{
              const remote=data.playlists.filter(playlist=>playlist.id!=='device');
              const merged=remote.map(playlist=>{
                const local=current.find(item=>item.id===playlist.id);
                return {...playlist,tracks:[...(playlist.tracks||[]),...(local?.tracks||[]).filter(track=>track.isLocal)]};
              });
              return [...merged,...current.filter(playlist=>playlist.id==='device'||!remote.some(item=>item.id===playlist.id))];
            });
          } else {
            await setDoc(ref,{displayName:current.displayName||'',email:current.email||'',saved:withoutLocalTracks(localSaved),playlists:localPlaylists.map(playlist=>({...playlist,tracks:withoutLocalTracks(playlist.tracks)})).filter(playlist=>playlist.id!=='device'),updatedAt:serverTimestamp()});
          }
          setCloudError('');
          setCloudReady(true);
        } catch(e){if(active)setCloudError('Não foi possível carregar sua biblioteca na nuvem. Verifique a configuração do Firestore.');}
      }
      setAuthLoading(false);
    },()=>{if(active){setCloudError('Não foi possível verificar sua sessão no Firebase.');setAuthLoading(false);}});
    })();
    return ()=>{active=false;if(unsubscribe)unsubscribe();};
  },[]);
  useEffect(()=>{if(!authLoading)AsyncStorage.setItem('sf_user',JSON.stringify(user)).catch(()=>setStorageError('Falha ao salvar dados neste dispositivo.'));},[user,authLoading]);
  useEffect(()=>{if(!authLoading)AsyncStorage.setItem('sf_saved',JSON.stringify(Platform.OS==='web'?withoutLocalTracks(saved):saved)).catch(()=>setStorageError('Falha ao salvar dados neste dispositivo.'));},[saved,authLoading]);
  useEffect(()=>{if(!authLoading)AsyncStorage.setItem('sf_playlists',JSON.stringify(Platform.OS==='web'?playlists.filter(playlist=>playlist.id!=='device').map(playlist=>({...playlist,tracks:withoutLocalTracks(playlist.tracks)})):playlists)).catch(()=>setStorageError('Falha ao salvar dados neste dispositivo.'));},[playlists,authLoading]);
  useEffect(()=>{
    if(!authUser||!cloudReady)return;
    setDoc(doc(db,'users',authUser.uid),{displayName:authUser.displayName||user||'',email:authUser.email||'',saved:withoutLocalTracks(saved),playlists:playlists.filter(playlist=>playlist.id!=='device').map(playlist=>({...playlist,tracks:withoutLocalTracks(playlist.tracks)})),updatedAt:serverTimestamp()},{merge:true})
      .then(()=>setCloudError(''))
      .catch(()=>setCloudError('Não foi possível sincronizar sua biblioteca com o Firestore.'));
  },[authUser,cloudReady,saved,playlists,user]);

  useEffect(()=>{if(page!=='home'||homeData)return; let live=true;
    Promise.all([api.chartTracks(),api.chartArtists(),api.chartAlbums()])
      .then(([t,a,b])=>{if(live)setHomeData({tracks:playable(t),artists:a,albums:b});})
      .catch(()=>{if(live)setHomeError(true);});
    return ()=>{live=false;};
  },[page,homeData]);
  useEffect(()=>{if(page!=='search')return;
    const term=query.trim();
    setSearchCategory('all');
    if(term.length<2){setResults([]);setArtistResults([]);setAlbumResults([]);setSearchState('idle');return;}
    let live=true;setSearchState('loading');setResults([]);setArtistResults([]);setAlbumResults([]);
    const timer=setTimeout(()=>Promise.all([api.search(term),api.searchArtists(term),api.searchAlbums(term)])
      .then(([tracks,artists,albums])=>{if(live){setResults(playable(tracks));setArtistResults(artists);setAlbumResults(albums);setSearchState('done');}})
      .catch(()=>{if(live)setSearchState('error');}),350);
    return ()=>{live=false;clearTimeout(timer);};
  },[query,page]);

  const stopSound=useCallback(async()=>{if(sound){try{await sound.unloadAsync();}catch(e){showMessage('Erro no player','Não foi possível parar a reprodução anterior.');} setSound(null);}},[sound,showMessage]);
  useEffect(()=>()=>{if(sound)sound.unloadAsync().catch(()=>{});},[sound]);
  const playAt=async(list,i)=>{
    const track=list?.[i], source=track?.localUri||track?.preview; if(!source)return;
    await stopSound();
    setQueue(list);setIndex(i);setCurrent(track);setPosition(0);setPlaying(true);
    try {
      const {sound:next}=await Audio.Sound.createAsync({uri:source},{shouldPlay:true,progressUpdateIntervalMillis:500},
        status=>{if(status.isLoaded){if(!seeking.current)setPosition(status.positionMillis||0);setDuration(status.durationMillis||30000);setPlaying(status.isPlaying);if(status.didJustFinish)nextStep(list,i);}});
      setSound(next);
    } catch(e){setPlaying(false);showMessage('Não foi possível reproduzir','Tente outra música.');}
  };
  const nextStep=async(list=queue,idx=index)=>{
    if(!list?.length)return;
    const n=(idx+1)%list.length; await playAt(list,n);
  };
  const toggle=async()=>{if(!sound)return;try{if(playing)await sound.pauseAsync();else await sound.playAsync();setPlaying(!playing);}catch(e){showMessage('Erro no player','Não foi possível alterar a reprodução.');}};
  const step=async(dir)=>{if(!queue.length)return;await playAt(queue,(index+dir+queue.length)%queue.length);};
  const seek=async(v)=>{const target=Math.max(0,Math.min(v,duration||30000));setPosition(target);if(sound)try{await sound.setPositionAsync(target);}catch(e){showMessage('Erro no player','Não foi possível buscar esse trecho da música.');}};
  const seekBy=seconds=>seek(position+seconds*1000);
  const isSaved=t=>saved.some(x=>x.id===t.id);
  const toggleSave=t=>setSaved(old=>old.some(x=>x.id===t.id)?old.filter(x=>x.id!==t.id):[t,...old]);
  const createPlaylist=name=>{const id=`p${Date.now()}${Math.random().toString(36).slice(2,7)}`;setPlaylists(p=>[...p,{id,name:name.trim(),tracks:[]}]);return id;};
  const addToPlaylist=(pid,t)=>setPlaylists(p=>p.map(x=>x.id===pid&&!x.tracks.some(y=>y.id===t.id)?{...x,tracks:[...x.tracks,t]}:x));
  const removeFromPlaylist=(pid,tid)=>{
    setPlaylists(p=>p.map(x=>x.id===pid?{...x,tracks:x.tracks.filter(t=>t.id!==tid)}:x));
    if(collection?.type==='playlist'&&collection.id===pid)setCollectionTracks(tracks=>tracks?.filter(track=>track.id!==tid)||[]);
  };
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
  const addNewPlaylist=()=>{
    const name=newName.trim();
    if(!name){setPlaylistError('Digite um nome para a playlist.');playlistInputRef.current?.focus();return;}
    createPlaylist(name);setNewName('');setPlaylistError('');
  };
  const importAudio=async()=>{
    setImporting(true);setImportError('');
    const copiedFiles=[];
    try{
      const selection=await DocumentPicker.getDocumentAsync({type:'audio/*',multiple:true,copyToCacheDirectory:true,base64:false});
      if(selection.canceled)return;
      const directory=FileSystem.documentDirectory?`${FileSystem.documentDirectory}music/`:null;
      if(Platform.OS!=='web'&&!directory)throw new Error('O armazenamento do dispositivo não está disponível.');
      if(directory){
        const info=await FileSystem.getInfoAsync(directory);
        if(!info.exists)await FileSystem.makeDirectoryAsync(directory,{intermediates:true});
      }
      const imported=[];
      for(const [index,asset] of selection.assets.entries()){
        const isAudio=asset.mimeType?.startsWith('audio/')||/\.(mp3|m4a|aac|wav|flac|ogg|opus|aiff?)$/i.test(asset.name);
        if(!isAudio)continue;
        const id=`local-${Date.now()}-${index}-${Math.random().toString(36).slice(2,7)}`;
        let localUri=asset.uri;
        if(directory){
          const extension=asset.name.match(/\.[a-z0-9]{2,6}$/i)?.[0]||'.audio';
          localUri=`${directory}${id}${extension}`;
          await FileSystem.copyAsync({from:asset.uri,to:localUri});
          copiedFiles.push(localUri);
        }else if(asset.file&&typeof URL!=='undefined'&&typeof URL.createObjectURL==='function'){
          localUri=URL.createObjectURL(asset.file);
        }
        imported.push({
          id,title:asset.name.replace(/\.[^.]+$/,'')||'Música local',
          artist:'Do seu dispositivo',cover:'',coverBig:'',preview:null,
          localUri,isLocal:true,
        });
      }
      if(!imported.length)throw new Error('Selecione arquivos de áudio compatíveis.');
      setPlaylists(current=>{
        const localPlaylist=current.find(playlist=>playlist.id==='device');
        if(localPlaylist)return current.map(playlist=>playlist.id==='device'?{...playlist,tracks:[...playlist.tracks,...imported]}:playlist);
        return [...current,{id:'device',name:'Músicas do dispositivo',tracks:imported}];
      });
    }catch(error){
      await Promise.all(copiedFiles.map(uri=>FileSystem.deleteAsync(uri,{idempotent:true}).catch(()=>{})));
      setImportError(error.message||'Não foi possível importar os arquivos selecionados.');
    }finally{setImporting(false);}
  };
  const addToNewOrExisting=pid=>{addToPlaylist(pid,addTrack);setAddTrack(null);};
  const submitAccount=async()=>{
    setAuthError('');
    if(!firebaseConfigured){setAuthError('Configure o Firebase no arquivo .env para conectar ou criar uma conta.');return;}
    if(!email.trim()||!password){setAuthError('Informe seu e-mail e sua senha.');return;}
    setAuthBusy(true);
    try {
      if(authMode==='create'){
        const credential=await createUserWithEmailAndPassword(auth,email.trim(),password);
        if(welcomeName.trim())await updateProfile(credential.user,{displayName:welcomeName.trim()});
        await         setDoc(doc(db,'users',credential.user.uid),{
          displayName:welcomeName.trim(),
          email:email.trim(),
          saved:withoutLocalTracks(saved),
          playlists:playlists.filter(playlist=>playlist.id!=='device').map(playlist=>({...playlist,tracks:withoutLocalTracks(playlist.tracks)})),
          updatedAt:serverTimestamp(),
        });
      } else await signInWithEmailAndPassword(auth,email.trim(),password);
      setPassword('');
      setPhoneCode('');
      setPage('home');setStack([]);
    } catch(e){setAuthError(authMessage(e));}
    finally{setAuthBusy(false);}
  };
  const continueWithGoogle=async()=>{
    setAuthError('');
    if(Platform.OS!=='web'){setAuthError('O login Google no aplicativo nativo precisa de IDs OAuth Android/iOS no Firebase. No momento, use e-mail/senha ou visitante.');return;}
    setAuthBusy(true);
    try{await signInWithPopup(auth,new GoogleAuthProvider());setPage('home');setStack([]);}
    catch(e){setAuthError(authMessage(e));}
    finally{setAuthBusy(false);}
  };
  const sendPhoneCode=async()=>{
    setAuthError('');
    if(Platform.OS!=='web'){setAuthError('A verificação por telefone precisa da configuração nativa de reCAPTCHA. Use e-mail/senha ou visitante no aplicativo.');return;}
    if(!phone.trim()){setAuthError('Informe o telefone com código do país, por exemplo +5511999999999.');return;}
    setAuthBusy(true);
    try{
      if(recaptchaRef.current){recaptchaRef.current.clear();recaptchaRef.current=null;}
      const verifier=new RecaptchaVerifier(auth,'firebase-recaptcha',{size:'normal'});
      recaptchaRef.current=verifier;
      const id=await new PhoneAuthProvider(auth).verifyPhoneNumber(phone.trim(),verifier);
      setPhoneVerificationId(id);
      setAuthError('');
    }catch(e){setAuthError(authMessage(e));}
    finally{setAuthBusy(false);}
  };
  const verifyPhoneCode=async()=>{
    setAuthError('');
    if(!phoneCode.trim()){setAuthError('Digite o código recebido por SMS.');return;}
    setAuthBusy(true);
    try{
      const credential=PhoneAuthProvider.credential(phoneVerificationId,phoneCode.trim());
      await signInWithCredential(auth,credential);
      setPhoneVerificationId('');setPhoneCode('');setPage('home');setStack([]);
    }catch(e){setAuthError(authMessage(e));}
    finally{setAuthBusy(false);}
  };
  const resetPassword=async()=>{
    setAuthError('');
    if(!firebaseConfigured){setAuthError('Configure o Firebase no arquivo .env para usar esta opção.');return;}
    if(!email.trim()){setAuthError('Informe seu e-mail para receber o link de redefinição.');return;}
    try{await sendPasswordResetEmail(auth,email.trim());showMessage('E-mail enviado','Confira sua caixa de entrada para redefinir a senha.');}
    catch(e){setAuthError(authMessage(e));}
  };
  const leaveAccount=async()=>{
    try{await signOut(auth);setAuthUser(null);setCloudReady(false);setUser(null);setPassword('');setPage('welcome');setStack([]);}
    catch(e){showMessage('Não foi possível sair',authMessage(e));}
  };
  const openAccount=(mode,returnPage)=>{
    setAuthMode(mode);
    setAuthReturnPage(returnPage);
    setAuthError('');
    setPage('account');
  };
  const renderTrack=(t,list,i,removable=false,pid=null)=><TrackRow key={`${t.id}-${i}`} track={t} active={current?.id===t.id}
    onPlay={()=>playAt(list,i)} onMore={removable?()=>askConfirm('Remover música','Deseja remover esta música da playlist?',()=>removeFromPlaylist(pid,t.id)):()=>setAddTrack(t)}/>;

  const renderHome=()=> <ScrollView contentContainerStyle={styles.screen}>
    <View style={styles.header}><View><Text style={styles.small}>Olá{user?`, ${user}`:''}! 👋</Text><Text style={styles.h1}>Início</Text></View></View>
    <Btn style={styles.searchPill} onPress={()=>{setPage('search');setQuery('');}}><Ionicons name="search" size={20} color={C.muted}/><Text style={styles.placeholder}>Pesquisar músicas, artistas, álbuns...</Text></Btn>
    {homeError&&<><Text style={styles.message}>Não foi possível carregar as recomendações agora.</Text><Btn onPress={()=>{setHomeError(false);setHomeData(null);}} style={{alignSelf:'flex-start',marginTop:8}}><Text style={styles.trackTitle}>Tentar novamente</Text></Btn></>}
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
    <View style={[styles.searchPill,{marginTop:18}]}><Ionicons name="search" size={20} color={C.muted}/><TextInput value={query} onChangeText={setQuery} placeholder="Músicas, artistas, álbuns..." placeholderTextColor={C.muted} style={styles.searchInput} returnKeyType="search"/></View>
    {searchState==='idle'&&<Text style={styles.message}>Digite pelo menos 2 letras para buscar.</Text>}
    {searchState==='loading'&&<ActivityIndicator color={C.green} style={{marginTop:24}}/>}
    {searchState==='error'&&<Text style={styles.message}>A busca falhou. Verifique a conexão e tente novamente.</Text>}
    {searchState==='done'&&<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.searchFilters}>
      {[['all','Tudo'],['tracks','Músicas'],['artists','Artistas'],['albums','Álbuns']].map(([key,label])=><TouchableOpacity key={key} onPress={()=>setSearchCategory(key)} style={[styles.searchFilter,searchCategory===key&&styles.searchFilterActive]}><Text style={[styles.searchFilterText,searchCategory===key&&styles.searchFilterTextActive]}>{label}</Text></TouchableOpacity>)}
    </ScrollView>}
    {searchState==='done'&&searchCategory==='all'&&!results.length&&!artistResults.length&&!albumResults.length&&<Text style={styles.message}>Nada encontrado para “{query}”.</Text>}
    {searchState==='done'&&searchCategory==='tracks'&&!results.length&&<Text style={styles.message}>Nenhuma música encontrada.</Text>}
    {searchState==='done'&&searchCategory==='artists'&&!artistResults.length&&<Text style={styles.message}>Nenhum artista encontrado.</Text>}
    {searchState==='done'&&searchCategory==='albums'&&!albumResults.length&&<Text style={styles.message}>Nenhum álbum encontrado.</Text>}
    {(searchCategory==='all'||searchCategory==='tracks')&&!!results.length&&<><Section title="Músicas"/>{results.map((t,i)=>renderTrack(t,results,i))}</>}
    {(searchCategory==='all'||searchCategory==='artists')&&!!artistResults.length&&<><Section title="Artistas"/>{artistResults.map(a=><TouchableOpacity key={`artist-${a.id}`} style={styles.trackMain} onPress={()=>openCollection({type:'artist',id:a.id,title:a.name,sub:'Mais tocadas',cover:a.picture_medium})}><Cover src={a.picture_medium} size={48} round/><View style={{flex:1}}><Text numberOfLines={1} style={styles.trackTitle}>{a.name}</Text><Text style={styles.small}>Artista</Text></View><Ionicons name="chevron-forward" size={18} color={C.muted}/></TouchableOpacity>)}</>}
    {(searchCategory==='all'||searchCategory==='albums')&&!!albumResults.length&&<><Section title="Álbuns"/>{albumResults.map(a=><TouchableOpacity key={`album-${a.id}`} style={styles.trackMain} onPress={()=>openCollection({type:'album',id:a.id,title:a.title,sub:a.artist?.name,cover:a.cover_medium})}><Cover src={a.cover_medium} size={48}/><View style={{flex:1}}><Text numberOfLines={1} style={styles.trackTitle}>{a.title}</Text><Text numberOfLines={1} style={styles.small}>{a.artist?.name||'Álbum'}</Text></View><Ionicons name="chevron-forward" size={18} color={C.muted}/></TouchableOpacity>)}</>}
  </ScrollView>;

  const renderLibrary=()=> <ScrollView contentContainerStyle={styles.screen}>
    <Text style={styles.h1}>Biblioteca</Text>
    <View style={styles.tabs}><Text style={styles.tabLabel}>Playlists</Text></View>
    <Btn onPress={importAudio} disabled={importing} style={[styles.newPlaylist,{marginTop:12}]}>{importing?<ActivityIndicator color={C.green}/>:<Ionicons name="folder-open-outline" size={23} color={C.green}/>}<Text style={styles.trackTitle}>{importing?'Importando...':'Adicionar músicas do dispositivo'}</Text></Btn>
    {importError!==''&&<Text style={styles.formError}>{importError}</Text>}
    <Btn style={styles.newPlaylist} onPress={()=>{setPlaylistError('');playlistInputRef.current?.focus();}}>
      <Ionicons name="add-circle-outline" size={25} color={C.text}/><Text style={styles.trackTitle}>Nova playlist</Text>
    </Btn>
    <View style={styles.inlineCreate}><TextInput ref={playlistInputRef} value={newName} onChangeText={value=>{setNewName(value);if(playlistError)setPlaylistError('');}} onSubmitEditing={addNewPlaylist} returnKeyType="done" placeholder="Nome da playlist" placeholderTextColor={C.muted} style={[styles.searchInput,styles.playlistNameInput]}/><Btn green onPress={addNewPlaylist} style={{width:85,height:40}}><Text style={{color:'#04150b',fontWeight:'700'}}>Criar</Text></Btn></View>
    {playlistError!==''&&<Text style={styles.formError}>{playlistError}</Text>}
    {playlists.map(p=><View key={p.id} style={styles.trackRow}>
      <TouchableOpacity style={styles.trackMain} onPress={()=>{setCollection({type:'playlist',id:p.id,title:p.name});setCollectionTracks(p.tracks);setStack(s=>[...s,'library']);setPage('collection');}}>
        <Cover src={p.tracks[0]?.cover} size={56}/><View><Text style={styles.trackTitle}>{p.name}</Text><Text style={styles.small}>{p.tracks.length} músicas</Text></View>
      </TouchableOpacity>
      {!['fav','device'].includes(p.id)&&<Btn style={styles.iconButton} onPress={()=>askConfirm('Excluir playlist',`Excluir "${p.name}"?`,()=>setPlaylists(x=>x.filter(y=>y.id!==p.id)))}><Ionicons name="trash-outline" size={19} color={C.text}/></Btn>}
    </View>)}
    <Section title="Músicas salvas">{saved.length?saved.map((t,i)=>renderTrack(t,saved,i)):<Text style={styles.message}>Nenhuma música salva. Use o coração no player.</Text>}</Section>
  </ScrollView>;

  const renderSettings=()=> <ScrollView contentContainerStyle={styles.screen}>
    <Text style={styles.h1}>Configurações</Text>
    <Section title="Conta">
      <View style={styles.settingsCard}>
        {authUser?<>
          <Text style={styles.trackTitle}>{authUser.displayName||authUser.email||'Conta Spotifree'}</Text>
          {!!authUser.email&&<Text style={styles.small}>{authUser.email}</Text>}
          <Text style={[styles.small,{marginTop:10}]}>{cloudError|| (cloudReady?'Biblioteca sincronizada com o Firebase.':'Conectando ao Firebase...')}</Text>
          <Btn onPress={leaveAccount} style={[styles.outlineButton,{marginTop:14}]}><Text style={styles.trackTitle}>Sair da conta</Text></Btn>
        </>:<>
          <Text style={styles.trackTitle}>{user?`Visitante, ${user}`:'Visitante'}</Text>
          <Text style={[styles.small,{marginTop:6}]}>Conecte uma conta para sincronizar suas músicas e playlists.</Text>
          <Btn green onPress={()=>openAccount('login','settings')} style={{marginTop:14}}><Text style={styles.greenText}>Conectar conta</Text></Btn>
        </>}
        {!firebaseConfigured&&<Text style={[styles.message,{marginTop:12}]}>Firebase ainda não configurado. Preencha as variáveis EXPO_PUBLIC_FIREBASE no arquivo .env e reinicie o app.</Text>}
        {storageError!==''&&<Text style={[styles.message,{marginTop:12}]}>{storageError}</Text>}
      </View>
    </Section>
    <Section title="Sobre">
      <View style={styles.settingsCard}>
        <Text style={styles.trackTitle}>Spotifree</Text>
        <Text style={[styles.small,{marginTop:6}]}>Suas músicas e playlists, em um só lugar.</Text>
      </View>
    </Section>
  </ScrollView>;

  const renderAccount=()=> <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
    <View style={styles.header}>
      <Btn style={styles.iconButton} onPress={()=>{setPage(authReturnPage);setAuthError('');}}><Ionicons name="chevron-back" size={25} color={C.text}/></Btn>
      <Text style={styles.h1}>{authMode==='create'?'Criar conta':'Conectar conta'}</Text>
    </View>
    <Text style={styles.message}>Use seu e-mail para salvar e sincronizar sua biblioteca.</Text>
    {!firebaseConfigured&&<Text style={[styles.message,{marginTop:12}]}>O Firebase precisa ser configurado pelo responsável pelo projeto antes de habilitar contas.</Text>}
    {authMode==='create'&&<TextInput value={welcomeName} onChangeText={setWelcomeName} placeholder="Seu nome" placeholderTextColor={C.muted} style={[styles.nameInput,{marginTop:20}]}/>}
    {phoneVerificationId?<>
      <Text style={[styles.small,{marginTop:18}]}>Digite o código enviado para {phone}.</Text>
      <TextInput value={phoneCode} onChangeText={setPhoneCode} placeholder="Código SMS" placeholderTextColor={C.muted} keyboardType="number-pad" style={[styles.nameInput,{marginTop:12}]}/>
      <Btn green onPress={verifyPhoneCode} style={{marginTop:16}}>{authBusy?<ActivityIndicator color="#04150b"/>:<Text style={styles.greenText}>Verificar código</Text>}</Btn>
      <Btn onPress={()=>{setPhoneVerificationId('');setPhoneCode('');}}><Text style={styles.small}>Usar outro telefone</Text></Btn>
    </>:<>
    <TextInput value={email} onChangeText={setEmail} placeholder="E-mail" placeholderTextColor={C.muted} keyboardType="email-address" autoCapitalize="none" autoComplete="email" style={[styles.nameInput,{marginTop:12}]}/>
    <TextInput value={password} onChangeText={setPassword} placeholder="Senha (mínimo 6 caracteres)" placeholderTextColor={C.muted} secureTextEntry autoCapitalize="none" autoComplete={authMode==='create'?'new-password':'current-password'} style={[styles.nameInput,{marginTop:12}]}/>
    <Btn green onPress={submitAccount} style={{marginTop:18}}>{authBusy?<ActivityIndicator color="#04150b"/>:<Text style={styles.greenText}>{authMode==='create'?'Criar conta':'Entrar'}</Text>}</Btn>
    {authMode==='login'&&<Btn onPress={resetPassword} style={{marginTop:8}}><Text style={styles.small}>Esqueci minha senha</Text></Btn>}
    <Btn onPress={()=>{setAuthMode(authMode==='login'?'create':'login');setAuthError('');}} style={[styles.outlineButton,{marginTop:8}]}>
      <Text style={styles.trackTitle}>{authMode==='create'?'Já tenho uma conta':'Criar conta'}</Text>
    </Btn>
    <View style={styles.authDivider}><View style={styles.authDividerLine}/><Text style={styles.small}>ou continue com</Text><View style={styles.authDividerLine}/></View>
    <Btn onPress={continueWithGoogle} style={[styles.outlineButton,{marginTop:12}]}>{authBusy?<ActivityIndicator color={C.green}/>:<><Ionicons name="logo-google" size={18} color={C.text}/><Text style={styles.trackTitle}>Google</Text></>}</Btn>
    <TextInput value={phone} onChangeText={setPhone} placeholder="Telefone (+5511999999999)" placeholderTextColor={C.muted} keyboardType="phone-pad" style={[styles.nameInput,{marginTop:18}]}/>
    {Platform.OS==='web'&&<View nativeID="firebase-recaptcha" style={{alignItems:'center',marginTop:12}}/>}
    <Btn onPress={sendPhoneCode} style={[styles.outlineButton,{marginTop:12}]}>{authBusy?<ActivityIndicator color={C.green}/>:<Text style={styles.trackTitle}>Enviar código por SMS</Text>}</Btn>
    {authError!==''&&<Text style={styles.message}>{authError}</Text>}
    </>}
  </ScrollView>;

  const renderCollection=()=> <ScrollView contentContainerStyle={styles.screen}>
    <View style={styles.header}><Btn style={styles.iconButton} onPress={back}><Ionicons name="chevron-back" size={25} color={C.text}/></Btn><View style={{flex:1}}><Text style={styles.h2}>{collection?.title}</Text>{!!collection?.sub&&<Text style={styles.small}>{collection.sub}</Text>}</View>
    {!!collectionTracks?.length&&<Btn green style={styles.playSmall} onPress={()=>playAt(collectionTracks,0)}><Ionicons name="play" size={19} color="#04150b"/></Btn>}</View>
    {collectionTracks===null?<ActivityIndicator color={C.green}/>:collectionTracks.length?collectionTracks.map((t,i)=>renderTrack(t,collectionTracks,i,collection?.type==='playlist',collection?.id)):<Text style={styles.message}>{collection?.type==='playlist'&&collection?.id==='device'?'Adicione arquivos de áudio pela sua biblioteca.':collection?.type==='playlist'?'Playlist vazia. Adicione músicas pelo menu de cada faixa.':'Nenhuma música disponível.'}</Text>}
  </ScrollView>;

  const renderWelcome=()=> <View style={styles.welcome}>
    <View style={styles.brand}><View style={styles.logo}><Ionicons name="play" size={42} color={C.green}/></View><Text style={styles.brandTitle}>spotifree</Text><Text style={styles.welcomeSub}>Ouça suas músicas favoritas{'\n'}sem pagar nada.</Text></View>
    <View style={{width:'100%',gap:10}}>
      <Btn green onPress={()=>openAccount('login','welcome')}><Text style={styles.greenText}>Entrar na minha conta</Text></Btn>
      <Btn onPress={()=>openAccount('create','welcome')} style={styles.outlineButton}><Text style={styles.trackTitle}>Criar conta</Text></Btn>
      <View style={styles.authDivider}><View style={styles.authDividerLine}/><Text style={styles.small}>ou</Text><View style={styles.authDividerLine}/></View>
      <Btn onPress={()=>{setUser(welcomeName.trim()||null);enter();}}><Ionicons name="play" size={18} color={C.green}/><Text style={styles.trackTitle}>Continuar como visitante</Text></Btn>
      <TextInput value={welcomeName} onChangeText={setWelcomeName} placeholder="Seu nome (opcional)" placeholderTextColor={C.muted} style={styles.nameInput}/>
    </View>
  </View>;

  return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle="light-content" backgroundColor={C.bg}/>
    <View style={styles.app}>
      {page==='welcome'?renderWelcome():<>
        <View style={{flex:1}}>
          {page==='home'&&renderHome()}
          {page==='search'&&renderSearch()}
          {page==='library'&&renderLibrary()}
          {page==='settings'&&renderSettings()}
          {page==='account'&&renderAccount()}
          {page==='collection'&&renderCollection()}
        </View>
        {current&&<TouchableOpacity style={styles.miniPlayer} onPress={()=>setFullPlayer(true)}>
          <Cover src={current.cover} size={40}/><View style={{flex:1}}><Text numberOfLines={1} style={styles.trackTitle}>{current.title}</Text><Text numberOfLines={1} style={styles.small}>{current.artist}</Text></View>
          <Btn style={styles.iconButton} onPress={toggle}><Ionicons name={playing?'pause':'play'} size={23} color={C.text}/></Btn>
          <View style={[styles.progress,{width:`${Math.min(100,position/(duration||30000)*100)}%`}]}/>
        </TouchableOpacity>}
        {!(page==='account'&&authReturnPage==='welcome')&&<View style={styles.nav}>
          {['home','search','library','settings'].map((p,i)=><TouchableOpacity key={p} style={styles.navItem} onPress={()=>{setPage(p);setStack([]);}}>
            <Ionicons name={['home','search','library','settings-outline'][i]} size={22} color={page===p||page==='account'&&p==='settings'?C.green:C.muted}/><Text style={[styles.navText,(page===p||page==='account'&&p==='settings')&&{color:C.green}]}>{['Início','Pesquisar','Biblioteca','Config.'][i]}</Text>
          </TouchableOpacity>)}
        </View>}
      </>}
    </View>

    <Modal visible={fullPlayer} animationType="slide" presentationStyle="fullScreen" onRequestClose={()=>setFullPlayer(false)}>
      <SafeAreaView style={styles.playerScreen}>
        <View style={styles.playerTop}><Btn style={styles.iconButton} onPress={()=>setFullPlayer(false)}><Ionicons name="chevron-down" size={27} color={C.text}/></Btn><Text style={styles.small}>Tocando agora</Text><View style={{width:40}}/></View>
        <View style={{alignItems:'center',marginTop:24}}><Cover src={current?.coverBig||current?.cover} size={300}/></View>
        <View style={styles.playerInfo}><View style={{flex:1}}><Text style={styles.playerTitle} numberOfLines={2}>{current?.title}</Text><Text style={styles.small}>{current?.artist}</Text></View>
          <Btn style={styles.iconButton} onPress={()=>current&&toggleSave(current)}><Ionicons name={current&&isSaved(current)?'heart':'heart-outline'} size={28} color={current&&isSaved(current)?C.green:C.text}/></Btn>
        </View>
        <View style={{marginTop:26}}>
          <Slider
            style={styles.seekSlider}
            minimumValue={0}
            maximumValue={duration||30000}
            value={Math.min(position,duration||30000)}
            minimumTrackTintColor={C.green}
            maximumTrackTintColor="#ffffff30"
            thumbTintColor={C.green}
            onSlidingStart={()=>{seeking.current=true;}}
            onValueChange={value=>setPosition(value)}
            onSlidingComplete={value=>{seeking.current=false;seek(value);}}
            accessibilityLabel="Posição da música"
          />
          <View style={styles.times}><Text style={styles.small}>{fmt(position/1000)}</Text><Text style={styles.small}>{fmt(duration/1000)}</Text></View>
        </View>
        <View style={styles.controls}>
          <Btn style={styles.iconButton} onPress={()=>step(-1)}><Ionicons name="play-skip-back" size={27} color={C.text}/></Btn>
          <Btn style={styles.iconButton} onPress={()=>seekBy(-10)}><Ionicons name="play-back" size={24} color={C.text}/><Text style={styles.small}>10</Text></Btn>
          <Btn green style={styles.bigPlay} onPress={toggle}><Ionicons name={playing?'pause':'play'} size={30} color="#04150b"/></Btn>
          <Btn style={styles.iconButton} onPress={()=>seekBy(10)}><Ionicons name="play-forward" size={24} color={C.text}/><Text style={styles.small}>10</Text></Btn>
          <Btn style={styles.iconButton} onPress={()=>step(1)}><Ionicons name="play-skip-forward" size={27} color={C.text}/></Btn>
        </View>
        <Btn style={{marginTop:24,alignSelf:'center'}} onPress={()=>setAddTrack(current)}><Ionicons name="list" size={19} color={C.muted}/><Text style={styles.small}>  Adicionar à playlist</Text></Btn>
        <Text style={[styles.small,{textAlign:'center',marginTop:'auto',paddingBottom:20}]}>{current?.isLocal?'Música do dispositivo':'Deezer'}</Text>
      </SafeAreaView>
    </Modal>

    <Modal visible={!!addTrack} transparent animationType="slide" onRequestClose={()=>setAddTrack(null)}>
      <View style={styles.modalShade}><View style={styles.sheet}>
        <View style={styles.sheetHandle}/><Text style={styles.h2}>Adicionar à playlist</Text>
        <Text style={styles.small}>{addTrack?.title} • {addTrack?.artist}</Text>
        <ScrollView style={{maxHeight:360}}>{playlists.filter(p=>p.id!=='device').map(p=><TouchableOpacity key={p.id} style={styles.sheetItem} onPress={()=>addToNewOrExisting(p.id)}>
          <Text style={styles.trackTitle}>{p.name}</Text><Text style={styles.small}>{p.tracks.some(t=>t.id===addTrack?.id)?'Já está aqui':`${p.tracks.length} músicas`}</Text>
        </TouchableOpacity>)}</ScrollView>
        <Btn onPress={()=>setAddTrack(null)} style={styles.outlineButton}><Text style={styles.trackTitle}>Fechar</Text></Btn>
      </View></View>
    </Modal>
    <Modal visible={!!dialog} transparent animationType="fade" onRequestClose={()=>setDialog(null)}>
      <View style={styles.dialogShade}><View style={styles.dialogCard}>
        <Text style={styles.h2}>{dialog?.title}</Text>
        <Text style={[styles.small,{fontSize:14,lineHeight:21,marginTop:10}]}>{dialog?.message}</Text>
        <View style={styles.dialogActions}>
          {dialog?.onConfirm&&<Btn onPress={()=>setDialog(null)} style={styles.outlineButton}><Text style={styles.trackTitle}>Cancelar</Text></Btn>}
          <Btn green={!dialog?.onConfirm} onPress={()=>{const action=dialog?.onConfirm;setDialog(null);if(action)action();}} style={dialog?.onConfirm?styles.confirmButton:styles.dialogOkButton}><Text style={dialog?.onConfirm?styles.confirmText:styles.greenText}>{dialog?.onConfirm?'Confirmar':'OK'}</Text></Btn>
        </View>
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
 settingsCard:{backgroundColor:C.surface,borderRadius:14,borderWidth:1,borderColor:C.line,padding:16,marginTop:4},
 authDivider:{flexDirection:'row',alignItems:'center',gap:12,marginTop:22},authDividerLine:{flex:1,height:1,backgroundColor:C.line},
 newPlaylist:{justifyContent:'flex-start',marginTop:12,backgroundColor:C.surface2,padding:12,borderRadius:12},
 inlineCreate:{flexDirection:'row',alignItems:'center',gap:8,marginTop:8},
 playlistNameInput:{minWidth:0,height:42,borderRadius:22,backgroundColor:C.surface,paddingHorizontal:14},
 formError:{fontSize:12,color:'#ff8b8b',marginTop:6,marginLeft:12},
 searchFilters:{gap:8,paddingVertical:14},searchFilter:{borderWidth:1,borderColor:C.line,borderRadius:18,paddingVertical:8,paddingHorizontal:14,backgroundColor:C.surface},searchFilterActive:{borderColor:C.green,backgroundColor:C.surface2},searchFilterText:{fontSize:13,color:C.muted,fontWeight:'600'},searchFilterTextActive:{color:C.green},
 nav:{height:62,flexDirection:'row',borderTopWidth:1,borderTopColor:C.line,backgroundColor:'#0a1510'},
 navItem:{flex:1,alignItems:'center',justifyContent:'center',gap:2},navText:{fontSize:11,color:C.muted},
 miniPlayer:{marginHorizontal:10,marginBottom:7,padding:8,borderRadius:13,backgroundColor:C.surface2,flexDirection:'row',alignItems:'center',gap:10,overflow:'hidden'},
 progress:{position:'absolute',height:2,bottom:0,left:8,backgroundColor:C.green},
 welcome:{flex:1,justifyContent:'space-between',alignItems:'center',paddingHorizontal:28,paddingTop:42,paddingBottom:28},
 brand:{alignItems:'center',marginTop:12},logo:{width:90,height:90,borderWidth:8,borderColor:C.green,borderRadius:50,alignItems:'center',justifyContent:'center'},
 brandTitle:{fontSize:48,fontWeight:'800',color:C.text,letterSpacing:-1},welcomeSub:{fontSize:15,color:C.muted,textAlign:'center',lineHeight:24,marginTop:10},
 nameInput:{height:45,borderRadius:24,backgroundColor:C.surface,paddingHorizontal:18,color:C.text},
 playerScreen:{flex:1,backgroundColor:C.bg,paddingHorizontal:24,paddingTop:12,paddingBottom:20},
 playerTop:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
 playerInfo:{flexDirection:'row',alignItems:'center',marginTop:26,gap:12},playerTitle:{fontSize:23,fontWeight:'800',color:C.text,marginBottom:5},
 seekSlider:{width:'100%',height:36,marginVertical:0},
 times:{flexDirection:'row',justifyContent:'space-between',marginTop:8},
 controls:{flexDirection:'row',alignItems:'center',justifyContent:'space-around',marginTop:28},
 bigPlay:{width:68,height:68,borderRadius:40},playSmall:{width:42,height:42,minHeight:42},
 modalShade:{flex:1,backgroundColor:'#000a',justifyContent:'flex-end'},sheet:{backgroundColor:C.surface,borderTopLeftRadius:22,borderTopRightRadius:22,padding:22,paddingBottom:30},
 sheetHandle:{width:42,height:4,borderRadius:3,backgroundColor:C.muted,alignSelf:'center',marginBottom:18},
 sheetItem:{paddingVertical:15,borderBottomWidth:1,borderBottomColor:C.line,flexDirection:'row',justifyContent:'space-between'},
 dialogShade:{flex:1,backgroundColor:'#000a',justifyContent:'center',alignItems:'center',padding:24},dialogCard:{width:'100%',maxWidth:380,backgroundColor:C.surface,borderWidth:1,borderColor:C.line,borderRadius:18,padding:20},dialogActions:{flexDirection:'row',justifyContent:'flex-end',gap:10,marginTop:20},confirmButton:{backgroundColor:C.pink,minHeight:44},confirmText:{color:C.text,fontWeight:'700'},dialogOkButton:{minWidth:80,minHeight:44}
});
