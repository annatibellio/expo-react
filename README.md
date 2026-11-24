# Spotifree

## Configuração do Firebase

1. Crie um projeto no [Firebase Console](https://console.firebase.google.com/).
2. Cadastre um app Web e copie os valores de configuração para `.env`, usando `.env.example` como modelo.
3. Em **Authentication > Sign-in method**, ative **E-mail/senha**. O modo convidado também requer **Anônimo**.
4. Crie o banco em **Firestore Database** e publique as regras abaixo.
5. Reinicie o Expo depois de criar ou alterar `.env`.

O cadastro cria a conta no Firebase Authentication e o documento `users/{uid}` no Firestore. A configuração `.env` usa valores públicos do app Firebase; nunca coloque chaves de conta de serviço ou arquivos privados no app.

## Regras do Firestore

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```
Estrutura: `users/{uid}` -> `{ name, saved: [faixas], playlists: [{id,name,tracks}] }`

## Música

Pesquisa, destaques e prévias de 30 segundos usam a API da Deezer. No navegador, o app usa JSONP e proxies CORS como alternativas.
