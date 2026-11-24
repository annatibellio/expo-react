# Spotifree — Expo / React Native

Aplicativo de música com busca e prévias da Deezer, biblioteca local e conta opcional com sincronização Firebase.

## Como abrir

1. Instale Node.js LTS.
2. Na pasta do projeto, instale as dependências e inicie o app web:

```bash
npm install
npm run web
```

O comando inicia o Expo e o proxy local da Deezer, necessário no navegador por causa do CORS. Para Android/iOS, use `npm start` e abra no Expo Go; o app nativo acessa a API diretamente.

## Configurar Firebase (opcional)

1. Crie um projeto no Firebase e registre um app Web.
2. Em Authentication, habilite o provedor **E-mail/senha**.
3. Crie o banco Cloud Firestore.
4. Copie `.env.example` para `.env` e preencha as quatro variáveis obrigatórias `EXPO_PUBLIC_FIREBASE_*` com a configuração do app. Bucket e sender ID são opcionais neste aplicativo.
5. Publique as regras com Firebase CLI (`firebase deploy --only firestore:rules`) ou copie `firestore.rules` para o console do Firestore.
6. Reinicie o Expo após editar `.env`.

O modo visitante continua disponível na tela inicial e mantém dados neste dispositivo. Depois de entrar como visitante, é possível conectar uma conta real nas configurações. Favoritos e playlists são sincronizados no documento `users/{uid}`. Músicas importadas do dispositivo permanecem somente no aparelho e não são enviadas ao Firebase.

Com Firebase configurado, o app oferece login por e-mail/senha, Google na versão web e telefone. Para SMS, habilite as regiões de envio permitidas no Firebase Authentication. Google no app nativo requer IDs OAuth específicos para Android/iOS; telefone no app nativo requer configuração nativa de verificação.

## Recursos

- Início com destaques de músicas, artistas e álbuns.
- Busca da Deezer por músicas, artistas e álbuns, com filtros por categoria.
- Reprodução de prévias da Deezer e arquivos de áudio importados do dispositivo.
- Favoritos e playlists com armazenamento local.
- Importação de arquivos de áudio do dispositivo para a biblioteca local.
- Cadastro, login, redefinição de senha e sincronização opcional pelo Firebase.
- Aba de configurações para gerenciar a conta.
