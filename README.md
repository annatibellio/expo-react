# Spotifree — versão Expo / React Native

Projeto convertido de React + Vite para React Native com Expo.

## Como abrir

1. Extraia o ZIP.
2. Abra a pasta `spotifree-expo` no VS Code.
3. Instale Node.js LTS e, no terminal, execute:

```bash
npm install
npx expo start
```

4. Leia o QR Code com o Expo Go (Android) ou use um emulador.
   Para iOS, use o simulador no macOS ou Expo Go.

## Dependências principais

- Expo + React Native
- expo-av para reprodução de áudio
- AsyncStorage para salvar nome, favoritos e playlists
- API pública da Deezer

## Observações

- A versão mobile não usa o proxy do Vite: faz chamadas HTTPS diretamente à API da Deezer.
- A Deezer fornece prévias de aproximadamente 30 segundos, não músicas completas.
- A disponibilidade da API pública da Deezer pode variar por região/rede.
- O player e a interface foram adaptados para componentes nativos. A conversão preserva as funções centrais, mas não é uma cópia pixel a pixel do CSS web.
- `expo-av` está incluído por compatibilidade com o exemplo de player; caso o Expo recomende migração para `expo-audio` na versão instalada, siga a documentação da versão do SDK.
