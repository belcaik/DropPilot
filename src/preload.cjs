const { contextBridge, ipcRenderer } = require('electron');
const actions = new Set(['getState','saveSettings','addChannels','importFile','importFacepunch','removeChannel','toggleChannel','start','stop','login','finishLogin','clearSession','exportConfig','importConfig','openInventory','markCompleted','setPriority','setRewards','refreshInventory','installBrowser']);
contextBridge.exposeInMainWorld('dropPilot', {
  invoke: async (action,payload={}) => {
    if(!actions.has(action))throw new Error('Acción no autorizada');
    const result=await ipcRenderer.invoke('drop-pilot',action,payload);
    if(!result.ok)throw new Error(result.error);
    return result.value;
  },
  onEvent: callback => {const handler=(_event,value)=>callback(value);ipcRenderer.on('drop-pilot-state',handler);return ()=>ipcRenderer.removeListener('drop-pilot-state',handler);}
});
