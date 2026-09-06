const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atpDesktop', {
  changeLibraryLocation: (libraryLocation) => ipcRenderer.invoke('library-location:change', libraryLocation),
  chooseLibraryLocation: (currentPath) => ipcRenderer.invoke('library-location:choose', currentPath),
  getLibraryLocationState: () => ipcRenderer.invoke('library-location:get-state'),
  controlWindow: (action) => ipcRenderer.send('window-control', action)
});
