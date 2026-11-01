const { contextBridge, ipcRenderer } = require('electron');
const inv = (c) => (...a) => ipcRenderer.invoke(c, ...a);
contextBridge.exposeInMainWorld('iop', {
  getSettings: inv('get-settings'), saveSettings: inv('save-settings'), history: inv('history'), send: inv('send'), stop: inv('stop'), pause: inv('pause'), tokensInfo: inv('tokens-info'), unpause: inv('unpause'), lastReport: inv('last-report'), recipeSave: inv('recipe-save'), recipeList: inv('recipe-list'), recipeDelete: inv('recipe-delete'), scheduleAdd: inv('schedule-add'), scheduleList: inv('schedule-list'), scheduleRemove: inv('schedule-remove'), remoteInfo: inv('remote-info'), remoteStart: inv('remote-start'), remoteStop: inv('remote-stop'), remoteResetToken: inv('remote-reset-token'), remoteOpen: inv('remote-open'),
  openPrompt: inv('open-prompt'), readPrompt: inv('read-prompt'), writePrompt: inv('write-prompt'), resetPrompt: inv('reset-prompt'), previewEnv: inv('preview-env'), openData: inv('open-data'),
  listModels: inv('list-models'), guessProfile: inv('guess-profile'), testConnection: inv('test-connection'), ollamaStatus: inv('ollama-status'), ollamaSetup: inv('ollama-setup'),
  openUrl: inv('open-url'), installOllamaLinux: inv('install-ollama-linux'), shotTest: inv('shot-test'),
  interrupted: inv('interrupted'), resume: inv('resume'), engineStatus: inv('engine-status'), engineSetup: inv('engine-setup'), engineCancel: inv('engine-cancel'), engineStop: inv('engine-stop'), androidStatus: inv('android-status'), androidSetup: inv('android-setup'), webchatSites: inv('webchat-sites'), webchatLogin: inv('webchat-login'), webchatStatus: inv('webchat-status'), webchatClear: inv('webchat-clear'), webchatChats: inv('webchat-chats'), webchatPick: inv('webchat-pick'), auto: inv('auto'), onCompact: (f) => ipcRenderer.on('compact', (_e, d) => f(d)),
  onEvent: (f) => ipcRenderer.on('agent-event', (_e, d) => f(d)), onSetup: (f) => ipcRenderer.on('setup-progress', (_e, d) => f(d)),
});
