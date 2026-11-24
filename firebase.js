import {Platform} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {initializeApp, getApps, getApp} from 'firebase/app';
import * as FA from 'firebase/auth';
import {initializeFirestore, getFirestore, doc, getDoc, setDoc} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || '',
};

export const fbReady = Object.values(firebaseConfig).every(Boolean);

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

const requireFirebase = () => {
  if (!auth || !db) throw {code: 'auth/firebase-not-configured'};
};

export const onUser = cb => auth ? FA.onAuthStateChanged(auth, cb) : (cb(null), () => {});
export const guestLogin = () => {
  requireFirebase();
  return FA.signInAnonymously(auth);
};
export const login = (email, pass) => {
  requireFirebase();
  return FA.signInWithEmailAndPassword(auth, email, pass);
};
export const register = async (name, email, pass) => {
  requireFirebase();
  const c = await FA.createUserWithEmailAndPassword(auth, email, pass);
  await FA.updateProfile(c.user, {displayName: name});
  await setDoc(doc(db, 'users', c.user.uid), {
    name,
    email: c.user.email,
    saved: [],
    playlists: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return c;
};
export const logout = () => {
  requireFirebase();
  return FA.signOut(auth);
};
export const loadData = async uid => {
  requireFirebase();
  const s = await getDoc(doc(db, 'users', uid));
  return s.exists() ? s.data() : null;
};
export const saveData = (uid, data) => {
  requireFirebase();
  return setDoc(doc(db, 'users', uid), {...data, updatedAt: Date.now()}, {merge: true});
};

export const authMessage = e => ({
  'auth/firebase-not-configured': 'Configure as credenciais do Firebase no arquivo .env para criar uma conta.',
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/user-not-found': 'Usuário não encontrado.',
  'auth/wrong-password': 'Senha incorreta.',
  'auth/email-already-in-use': 'Este e-mail já está em uso.',
  'auth/weak-password': 'A senha precisa ter ao menos 6 caracteres.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/operation-not-allowed': 'Ative este método de login no Firebase.',
  'auth/network-request-failed': 'Sem conexão com a internet.',
}[e?.code] || 'Não foi possível entrar. Tente novamente.');
