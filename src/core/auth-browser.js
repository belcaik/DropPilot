import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';

export function browserCandidates(system=process.platform,env=process.env,home=os.homedir()) {
  if(system==='win32') {
    const roots=[env.PROGRAMFILES,env['PROGRAMFILES(X86)'],env.ProgramFiles,env['ProgramFiles(x86)'],env.LOCALAPPDATA].filter(Boolean);
    return [...new Set(roots)].flatMap(root=>[{channel:'chrome',name:'Google Chrome',executablePath:path.join(root,'Google','Chrome','Application','chrome.exe')},{channel:'msedge',name:'Microsoft Edge',executablePath:path.join(root,'Microsoft','Edge','Application','msedge.exe')}]);
  }
  if(system==='darwin')return ['/Applications',path.join(home,'Applications')].flatMap(root=>[{channel:'chrome',name:'Google Chrome',executablePath:path.join(root,'Google Chrome.app','Contents','MacOS','Google Chrome')},{channel:'msedge',name:'Microsoft Edge',executablePath:path.join(root,'Microsoft Edge.app','Contents','MacOS','Microsoft Edge')}]);
  return [{channel:'chrome',name:'Google Chrome',executablePath:'/opt/google/chrome/chrome'},{channel:'chrome',name:'Google Chrome',executablePath:'/usr/bin/google-chrome'},{channel:'chrome',name:'Google Chrome',executablePath:'/usr/bin/google-chrome-stable'},{channel:'msedge',name:'Microsoft Edge',executablePath:'/opt/microsoft/msedge/msedge'},{channel:'msedge',name:'Microsoft Edge',executablePath:'/usr/bin/microsoft-edge'}];
}
export async function findInstalledBrowser(preference='auto', candidates=browserCandidates(), exists=async filename=>{try{return (await fs.stat(filename)).isFile();}catch{return false;}}) {
  const order=preference==='auto'?['chrome','msedge']:[preference];
  for(const channel of order)for(const candidate of candidates.filter(c=>c.channel===channel))if(await exists(candidate.executablePath))return candidate;
  return null;
}
export function manualLoginArgs(profilePath,port,url) {
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Puerto de sesión inválido');
  if(!['https://www.twitch.tv/login','https://kick.com/login'].includes(url))throw new Error('Destino de autenticación inválido');
  return [`--user-data-dir=${profilePath}`,'--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,'--no-first-run','--no-default-browser-check','--new-window',url];
}
async function freePort() {
  const server=net.createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({host:'127.0.0.1',port:0,exclusive:true},resolve);});
  const port=server.address().port;
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  return port;
}
export async function removeLoginProfile(profilePath) {
  const resolved=await fs.realpath(profilePath).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(!resolved)return;
  const temp=await fs.realpath(os.tmpdir());
  if(path.dirname(resolved)!==temp||!path.basename(resolved).startsWith('droppilot-auth-'))throw new Error('Directorio de autenticación no reconocido; no se eliminó.');
  await fs.rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
async function waitExit(child,milliseconds) {
  if(child.exitCode!==null||child.signalCode!==null)return true;
  return new Promise(resolve=>{const handler=()=>{clearTimeout(timer);resolve(true);};const timer=setTimeout(()=>{child.removeListener('exit',handler);resolve(false);},milliseconds);child.once('exit',handler);});
}
export async function closeManualLogin(entry,chromium) {
  entry.closing=true;clearTimeout(entry.expiry);
  try {
    if(entry.child.exitCode===null&&entry.child.signalCode===null) {
      try{const browser=entry.connection??await chromium.connectOverCDP(entry.endpoint,{timeout:3000});const session=await browser.newBrowserCDPSession();await session.send('Browser.close');await browser.close().catch(()=>{});}catch{}
      if(!await waitExit(entry.child,4000)) {
        if(process.platform==='win32')await promisify(execFile)('taskkill',['/PID',String(entry.child.pid),'/T','/F'],{windowsHide:true,timeout:5000}).catch(()=>{});
        else entry.child.kill('SIGTERM');
        await waitExit(entry.child,3000);
      }
    }
  }finally{await removeLoginProfile(entry.profilePath);}
}
export async function launchManualLogin(browser,url) {
  const profilePath=await fs.mkdtemp(path.join(os.tmpdir(),'droppilot-auth-'));
  const port=await freePort();
  const child=spawn(browser.executablePath,manualLoginArgs(profilePath,port,url),{windowsHide:false,stdio:'ignore'});
  const entry={child,profilePath,endpoint:`http://127.0.0.1:${port}`,browser,closing:false};
  try {
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    for(let attempt=0;attempt<50;attempt++) {
      if(child.exitCode!==null)throw new Error('El navegador de autenticación se cerró.');
      try{const response=await fetch(`${entry.endpoint}/json/version`,{signal:AbortSignal.timeout(1000)});if(response.ok&&(await response.json()).webSocketDebuggerUrl)return entry;}catch{}
      await delay(200);
    }
    throw new Error('No se pudo conectar con el navegador instalado. Prueba Chrome o Edge desde Configuración.');
  }catch(error){if(child.pid&&child.exitCode===null)child.kill();await waitExit(child,2000);await removeLoginProfile(profilePath).catch(()=>{});throw error;}
}
export function twitchAuthenticated(state) {
  return state.cookies?.some(cookie=>cookie.name==='auth-token'&&cookie.value && /(^|\.)twitch\.tv$/.test(cookie.domain.replace(/^\./,'')) && (cookie.expires===-1||cookie.expires>Date.now()/1000));
}
