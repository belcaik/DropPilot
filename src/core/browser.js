import fs from 'node:fs/promises';
import {findInstalledBrowser,launchManualLogin,closeManualLogin,removeLoginProfile,twitchAuthenticated} from './auth-browser.js';

export class BrowserManager {
  constructor({vault,browserPath,log,onChange,getSettings=()=>({})}) {Object.assign(this,{vault,browserPath,log,onChange,getSettings});this.sessions=new Map();this.pending=new Set();this.logins=new Map();}
  async chromium() {process.env.PLAYWRIGHT_BROWSERS_PATH=this.browserPath;return (await import('playwright')).chromium;}
  async selectedBrowser(forLogin=false) {
    const preference=this.getSettings().browserChannel??'auto';
    const installed=await findInstalledBrowser(preference==='chromium'&&forLogin?'auto':preference);
    if(installed)return installed;
    if(forLogin||!['auto','chromium'].includes(preference))throw new Error('Para iniciar sesión instala o actualiza Google Chrome o Microsoft Edge, y elige ese navegador en Configuración.');
    return {channel:'chromium',name:'Chromium incluido'};
  }
  async ready() {try{const selected=await this.selectedBrowser();return selected.executablePath?true:(await fs.stat((await this.chromium()).executablePath())).isFile();}catch{return false;}}
  async get(p,headless=true) {
    if(this.pending.has(p))throw new Error('Guarda la sesión del navegador antes de iniciar.');
    if(this.sessions.has(p))return this.sessions.get(p).context;
    if(!await this.vault.read(p))throw new Error('Inicia sesión en esta plataforma antes de ejecutar el planificador.');
    return this.create(p,headless);
  }
  async create(p,headless) {
    if(!await this.ready())throw new Error('El navegador seleccionado no está disponible. Revisa Configuración.');
    const selected=await this.selectedBrowser();
    const storageState=await this.vault.read(p);
    const browser=await (await this.chromium()).launch({headless,chromiumSandbox:true,timeout:30000,...(selected.executablePath?{executablePath:selected.executablePath}:{})});
    const context=await browser.newContext({storageState,viewport:{width:1280,height:800},locale:'en-US'});
    context.setDefaultTimeout(12000);context.setDefaultNavigationTimeout(25000);
    this.sessions.set(p,{browser,context});
    browser.on('disconnected',()=>{this.sessions.delete(p);this.onChange();});
    return context;
  }
  async login(p) {
    if(!['twitch','kick'].includes(p))throw new Error('Plataforma inválida');
    await this.close(p);
    if(!this.vault.available())throw new Error('El llavero del sistema no permite cifrar la sesión.');
    const selected=await this.selectedBrowser(true);
    // Authentication is manual in an installed browser. Attach only on Save.
    const entry=await launchManualLogin(selected,p==='twitch'?'https://www.twitch.tv/login':'https://kick.com/login');
    this.logins.set(p,entry);this.pending.add(p);this.onChange();
    entry.child.once('exit',()=>{
      if(entry.closing||this.logins.get(p)!==entry)return;
      this.logins.delete(p);this.pending.delete(p);clearTimeout(entry.expiry);
      removeLoginProfile(entry.profilePath).catch(()=>{});
      this.log('warn',`${p}: el navegador se cerró sin guardar. Vuelve a conectar y pulsa Guardar sesión antes de cerrar la ventana.`);this.onChange();
    });
    entry.expiry=setTimeout(()=>{this.log('warn',`${p}: el inicio de sesión venció después de 20 minutos.`);this.close(p).catch(()=>{});},20*60*1000);entry.expiry.unref();
    this.log('info',`${p}: inicia sesión en ${selected.name}. Cuando veas tu cuenta conectada, pulsa Guardar sesión en DropPilot sin cerrar el navegador.`);
  }
  async save(p) {const session=this.sessions.get(p);if(session)await this.vault.write(p,await session.context.storageState({indexedDB:true}));}
  async finish(p) {
    const entry=this.logins.get(p);
    if(!entry||!this.pending.has(p))throw new Error('No hay un inicio de sesión abierto.');
    const browser=entry.connection??await (await this.chromium()).connectOverCDP(entry.endpoint,{timeout:15000});entry.connection=browser;
    const context=browser.contexts()[0];
    if(!context)throw new Error('No se encontró la sesión del navegador.');
    const storageState=await context.storageState({indexedDB:true});
    if(p==='twitch'&&!twitchAuthenticated(storageState))throw new Error('Twitch todavía no está autenticado. Completa el inicio de sesión en Chrome o Edge antes de guardar.');
    if(p==='kick'&&!storageState.cookies.some(c=>/(^|\.)kick\.com$/.test(c.domain.replace(/^\./,''))))throw new Error('No hay una sesión de Kick para guardar.');
    await this.vault.write(p,storageState);
    await this.close(p);this.log('info',`${p}: sesión guardada cifrada.`);
  }
  async close(p) {
    const login=this.logins.get(p);
    if(login){this.logins.delete(p);this.pending.delete(p);try{await closeManualLogin(login,await this.chromium());}catch(error){this.log('warn',`No se pudo limpiar el perfil temporal: ${error.message}`);}this.onChange();}
    const session=this.sessions.get(p);
    if(!session)return;
    try{await this.save(p);}catch(error){this.log('warn',`${p}: ${error.message}`);}
    await session.browser.close();this.sessions.delete(p);this.onChange();
  }
  async closeAll() {await Promise.allSettled([...new Set([...this.sessions.keys(),...this.logins.keys()])].map(p=>this.close(p)));}
}
