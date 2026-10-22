import {app,BrowserWindow,ipcMain,dialog,safeStorage,shell} from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {Store,SessionVault,atomicWrite} from './core/store.js';
import {platform,normalizeChannel,validateConfig,validateSettings} from './core/config.js';
import {BrowserManager} from './core/browser.js';
import {Scheduler,isComplete,campaignActive} from './core/scheduler.js';
import {createAdapter} from './adapters/index.js';
import {fetchCampaign} from './adapters/facepunch.js';

const directory=path.dirname(fileURLToPath(import.meta.url));
const uiFile=path.join(directory,'ui','index.html');
const uiURL=pathToFileURL(uiFile).href;
let window,store,browsers,scheduler,config,quitting=false;
const inventory={twitch:[],kick:[]},logs=[];
let browserReady=false,queue=Promise.resolve();
const state=()=>({...config,channels:config?.channels.map(c=>({...c,completedConfirmed:!c.completed&&isComplete(c,inventory[c.platform]),campaignActive:campaignActive(c)})),inventory,logs,running:scheduler?.running??false,active:scheduler?.active??{twitch:null,kick:null},loginPending:[...(browsers?.pending??[])],browserReady});
function emit(){if(window&&!window.isDestroyed())window.webContents.send('drop-pilot-state',state());}
function log(level,message){if(message===undefined){message=level;level='info';}logs.push({time:new Date().toISOString(),level,message:String(message).replace(/(Bearer\s+|auth-token[=:]\s*|access_token[=:]\s*)[^\s&]+/gi,'$1[redacted]').slice(0,1000)});if(logs.length>300)logs.shift();emit();}
async function persist(){await store.write(config);emit();}
function channel(id){const c=config.channels.find(c=>c.id===id);if(!c)throw new Error('Canal no encontrado');return c;}
function addRows(rows){let count=0;for(const input of rows){const c=normalizeChannel(input);const old=config.channels.find(x=>x.platform===c.platform&&x.login===c.login&&x.game.toLowerCase()===c.game.toLowerCase()&&x.campaignTitle===c.campaignTitle);if(old){if(c.rewardIds.length)old.rewardIds=c.campaignTitle?c.rewardIds:[...new Set([...old.rewardIds,...c.rewardIds])];if(c.campaignTitle){old.startsAt=c.startsAt;old.endsAt=c.endsAt;}continue;}if(config.channels.length>=1000)throw new Error('Límite de 1000 canales');config.channels.push(c);count++;}return count;}
async function fileInput(filters){const selected=await dialog.showOpenDialog(window,{properties:['openFile'],filters});if(selected.canceled)return null;const info=await fs.stat(selected.filePaths[0]);if(info.size>2*1024*1024)throw new Error('Archivo demasiado grande: máximo 2 MB');return fs.readFile(selected.filePaths[0],'utf8');}
async function dispatch(action,payload={}) {
  switch(action) {
    case 'getState':return state();
    case 'saveSettings':await scheduler.stop();config.settings=validateSettings(payload.settings??payload);browserReady=await browsers.ready();await persist();return state();
    case 'addChannels':{const p=platform(payload.platform);const rows=String(payload.text??'').split(/[\s,;]+/).filter(Boolean).map(login=>({login,platform:p,game:payload.game??config.settings.game}));const validated=rows.map(normalizeChannel);const count=addRows(validated);await persist();return {count};}
    case 'importFile':{const text=await fileInput([{name:'Canales JSON o texto',extensions:['json','txt','csv']}]);if(text===null)return null;let rows;try{const data=JSON.parse(text);rows=Array.isArray(data)?data:data.channels;}catch{rows=text.split(/[\s,;]+/).filter(Boolean).map(login=>({login,platform:platform(payload.platform??'twitch'),game:config.settings.game}));}if(!Array.isArray(rows)||rows.length>1000)throw new Error('Lista inválida');const validated=rows.map(normalizeChannel);const count=addRows(validated);await persist();return {count};}
    case 'importFacepunch':{const campaign=await fetchCampaign(platform(payload.platform));const rows=campaign.channels.map(c=>({...c,rewardIds:c.rewardNames??c.rewardIds.map(id=>campaign.rewards.find(r=>r.id===id)?.name??id)}));const count=addRows(rows);await persist();for(const warning of campaign.warnings??[])log('warn',warning);log('info',`Facepunch: ${count} canales importados.`);return {count,campaign};}
    case 'removeChannel':config.channels=config.channels.filter(c=>c.id!==payload.id);await persist();return state();
    case 'toggleChannel':channel(payload.id).enabled=payload.enabled===true;await persist();return state();
    case 'markCompleted':channel(payload.id).completed=payload.completed===true;await persist();return state();
    case 'setPriority':{const c=channel(payload.id);const n=Number(payload.priority);if(!Number.isFinite(n)||Math.abs(n)>1000)throw new Error('Prioridad inválida');c.priority=n;await persist();return state();}
    case 'setRewards':{const c=channel(payload.id);if(!Array.isArray(payload.rewardIds))throw new Error('Lista de drops inválida');c.rewardIds=normalizeChannel({...c,rewardIds:payload.rewardIds}).rewardIds;await persist();return state();}
    case 'start':if(browsers.pending.size)throw new Error('Guarda o cierra el inicio de sesión antes de comenzar.');if(!config.channels.some(c=>c.enabled&&!c.completed))throw new Error('Añade un canal pendiente primero.');if(!await browsers.ready())throw new Error('Prepara el navegador primero.');await scheduler.start();return state();
    case 'stop':await scheduler.stop();return state();
    case 'login':await scheduler.stop();await browsers.login(platform(payload.platform));return state();
    case 'finishLogin':await browsers.finish(platform(payload.platform));return state();
    case 'clearSession':{const p=platform(payload.platform);await scheduler.stop();await browsers.close(p);await browsers.vault.clear(p);inventory[p]=[];log('info',`${p}: sesión eliminada.`);return state();}
    case 'refreshInventory':{const p=platform(payload.platform);if(scheduler.running)throw new Error('Pausa la rotación para actualizar manualmente.');try{const context=await browsers.get(p,config.settings.headless);const adapter=createAdapter(p,{context,settings:config.settings,log});inventory[p]=await adapter.inventory();await adapter.close();emit();return state();}finally{await browsers.close(p);}}
    case 'openInventory':await shell.openExternal(platform(payload.platform)==='twitch'?'https://www.twitch.tv/drops/inventory':'https://kick.com/drops/inventory');return null;
    case 'exportConfig':{const result=await dialog.showSaveDialog(window,{defaultPath:'droppilot-config.json',filters:[{name:'JSON',extensions:['json']}]});if(!result.canceled)await atomicWrite(result.filePath,JSON.stringify({version:1,settings:config.settings,channels:config.channels.map(({live,...c})=>c)},null,2));return null;}
    case 'importConfig':{const text=await fileInput([{name:'Configuración',extensions:['json']}]);if(text===null)return null;const next=validateConfig(JSON.parse(text));await scheduler.stop();config=next;inventory.twitch=[];inventory.kick=[];await persist();return state();}
    case 'installBrowser':{
      if(app.isPackaged){browserReady=await browsers.ready();emit();if(!browserReady)throw new Error('La distribución no contiene Chromium. Reinstala el paquete completo.');return state();}
      const cli=path.join(directory,'..','node_modules','playwright','cli.js');
      log('info','Descargando Chromium; puede tardar varios minutos.');
      await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,'install','chromium'],{windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',PLAYWRIGHT_BROWSERS_PATH:browsers.browserPath},stdio:['ignore','pipe','pipe']});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('Falló la descarga de Chromium. Revisa la conexión y vuelve a intentar.')));});
      browserReady=await browsers.ready();log('info','Navegador preparado.');return state();
    }
    default:throw new Error('Acción desconocida');
  }
}

if(!app.isPackaged && process.env.DROP_PILOT_TEST_DATA_DIR){await fs.mkdir(process.env.DROP_PILOT_TEST_DATA_DIR,{recursive:true});app.setPath('userData',process.env.DROP_PILOT_TEST_DATA_DIR);}
if(!app.requestSingleInstanceLock())app.quit();
else {
  app.on('second-instance',()=>{window?.show();window?.focus();});
  app.whenReady().then(async()=>{
  app.setName('DropPilot');
  store=new Store(app.getPath('userData'));
  try {config=await store.read();}catch(error){dialog.showErrorBox('Configuración dañada',error.message);app.exit(1);}
  const vault=new SessionVault(path.join(app.getPath('userData'),'sessions'),safeStorage);
  const browserPath=app.isPackaged?path.join(process.resourcesPath,'browsers'):path.join(directory,'..','.browsers');
  browsers=new BrowserManager({vault,browserPath,log,onChange:emit,getSettings:()=>config.settings});
  scheduler=new Scheduler({getState:()=>({...config,inventory}),browsers,adapterFactory:createAdapter,emit,log});
  browserReady=await browsers.ready();
  window=new BrowserWindow({width:1360,height:920,minWidth:900,minHeight:650,backgroundColor:'#0c1018',title:'DropPilot',webPreferences:{preload:path.join(directory,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(url!==uiURL)event.preventDefault();});
  window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  ipcMain.handle('drop-pilot',(event,action,payload)=>{
    if(event.sender!==window.webContents||event.senderFrame.url!==uiURL)return {ok:false,error:'Origen no autorizado'};
    const task=queue.then(()=>dispatch(action,payload)).then(value=>({ok:true,value})).catch(error=>{log('error',error.message);return {ok:false,error:error.message};});queue=task.then(()=>{});return task;
  });
  await window.loadFile(uiFile);
  app.on('before-quit',event=>{if(quitting)return;event.preventDefault();quitting=true;scheduler.stop().finally(()=>app.quit());});
  app.on('window-all-closed',()=>app.quit());
  }).catch(error=>{dialog.showErrorBox('No se pudo iniciar DropPilot',error.message);app.exit(1);});
}
