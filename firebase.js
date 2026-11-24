import {Platform} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {initializeApp, getApps, getApp} from 'firebase/app';
import * as FA from 'firebase/auth';
import {initializeFirestore, getFirestore, doc, getDoc, setDoc} from 'firebase/firestore';

// 1) console.firebase.google.com -> criar projeto -> adicionar app Web (</>) -> copie a config aqui
// 2) Authentication -> Sign-in method: ative "E-mail/senha" e "Anônimo"
// 3) Firestore Database -> criar banco (modo produção) e cole as regras do README abaixo
const firebaseConfig = {
  apiKey: 'COLE_AQUI',
  authDomain: 'COLE_AQUI.firebaseapp.com',
  projectId: 'COLE_AQUI',
  storageBucket: 'COLE_AQUI.appspot.com',
  messagingSenderId: 'COLE_AQUI',
  appId: 'COLE_AQUI',
};

export const fbReady = !firebaseConfig.apiKey.startsWith('COLE');

let auth = null, db = null;
if (fbReady) {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  try {
    auth = Platform.OS === 'web' || !FA.getReactNativePersistence
      ? FA.getAuth(app)
      : FA.initializeAuth(app, {persistence: FA.getReactNativePersistence(AsyncStorage)});
  } catch (e) { auth = FA.getAuth(app); }
  try {
    db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  } catch (e) {
    // If Firestore was already initialized, reuse the existing instance.
    db = getFirestore(app);
  }
}

export const onUser = cb => auth ? FA.onAuthStateChanged(auth, cb) : (cb(null), () => {});
export const guestLogin = () => FA.signInAnonymously(auth);
export const login = (email, pass) => FA.signInWithEmailAndPassword(auth, email, pass);
export const register = async (name, email, pass) => {
  const c = await FA.createUserWithEmailAndPassword(auth, email, pass);
  if (name) await FA.updateProfile(c.user, {displayName: name});
  return c;
};
export const logout = () => FA.signOut(auth);
export const loadData = async uid => {
  const s = await getDoc(doc(db, 'users', uid));
  return s.exists() ? s.data() : null;
};
export const saveData = (uid, data) => setDoc(doc(db, 'users', uid), {...data, updatedAt: Date.now()}, {merge: true});

export const authMessage = e => ({
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/user-not-found': 'Usuário não encontrado.',
  'auth/wrong-password': 'Senha incorreta.',
  'auth/email-already-in-use': 'Este e-mail já está em uso.',
  'auth/weak-password': 'A senha precisa ter ao menos 6 caracteres.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/operation-not-allowed': 'Ative este método de login no Firebase.',
  'auth/network-request-failed': 'Sem conexão com a internet.',
}[e?.code] || 'Não foi possível entrar. Tente novamente.');
