# Spotifree

Regras do Firestore (Firestore Database > Regras):

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
