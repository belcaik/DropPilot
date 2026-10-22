import fs from 'node:fs/promises';
import path from 'node:path';
import {validateConfig, defaults} from './config.js';

export async function atomicWrite(filename, content) {
  await fs.mkdir(path.dirname(filename), {recursive:true,mode:0o700});
  const temp = `${filename}.tmp`;
  await fs.writeFile(temp,content,{mode:0o600});
  await fs.rename(temp,filename);
}
export class Store {
  constructor(directory) {this.directory=directory;this.filename=path.join(directory,'config.json');}
  async read() {
    try { return validateConfig(JSON.parse(await fs.readFile(this.filename,'utf8'))); }
    catch(error) {if(error.code==='ENOENT')return {version:1,settings:{...defaults},channels:[]};throw new Error('No se puede leer la configuración. Conserva config.json para recuperarla.');}
  }
  async write(config) {await atomicWrite(this.filename,JSON.stringify({version:1,settings:config.settings,channels:config.channels},null,2));}
}
export class SessionVault {
  constructor(directory, safeStorage) {this.directory=directory;this.crypto=safeStorage;}
  file(p) {if(!['twitch','kick'].includes(p))throw new Error('Plataforma inválida');return path.join(this.directory,`${p}.session`);}
  available() {return this.crypto.isEncryptionAvailable() && this.crypto.getSelectedStorageBackend?.() !== 'basic_text';}
  async read(p) {
    try {if(!this.available())throw new Error('No hay almacén seguro del sistema. Habilita el llavero antes de autenticarte.');return JSON.parse(this.crypto.decryptString(await fs.readFile(this.file(p))));}
    catch(error) {if(error.code==='ENOENT')return undefined;throw error;}
  }
  async write(p,state) {if(!this.available())throw new Error('El llavero del sistema no está disponible; no se guardó la sesión.');await atomicWrite(this.file(p),this.crypto.encryptString(JSON.stringify(state)));}
  async clear(p) {await fs.rm(this.file(p),{force:true});}
}
