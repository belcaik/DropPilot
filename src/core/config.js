import { randomUUID } from 'node:crypto';

export const PLATFORMS = ['twitch', 'kick'];
export const defaults = Object.freeze({pollSeconds:120, inventorySeconds:180, rotationMinutes:30, headless:true, autoClaim:false, browserChannel:'auto', game:'Rust', selectors:{twitch:{},kick:{}}});
export function platform(value) { if (!PLATFORMS.includes(value)) throw new Error('Plataforma inválida'); return value; }
export function validateSettings(input = {}) {
  const result = {...defaults};
  for (const [key,min,max] of [['pollSeconds',30,3600],['inventorySeconds',60,3600],['rotationMinutes',1,1440]]) {
    const number = Number(input[key] ?? defaults[key]);
    if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${key}: debe estar entre ${min} y ${max}`);
    result[key] = number;
  }
  for (const key of ['headless','autoClaim']) result[key] = input[key] === undefined ? defaults[key] : input[key] === true;
  result.browserChannel=input.browserChannel??'auto';
  if(!['auto','chrome','msedge','chromium'].includes(result.browserChannel))throw new Error('Navegador inválido');
  result.game = String(input.game ?? 'Rust').trim().slice(0,100) || 'Rust';
  result.selectors = {twitch:{},kick:{}};
  for (const p of PLATFORMS) for (const [key,value] of Object.entries(input.selectors?.[p] ?? {})) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,50}$/.test(key) || typeof value !== 'string' || value.length > 1000) throw new Error('Selector inválido');
    if (value.trim()) result.selectors[p][key] = value.trim();
  }
  return result;
}
export function normalizeLogin(input, p) {
  platform(p);
  let value = String(input).trim();
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    if (![`${p}.com`,`www.${p}.com`,...(p === 'twitch' ? ['twitch.tv','www.twitch.tv']:[])].includes(url.hostname)) throw new Error('URL de canal ajena a la plataforma');
    value = url.pathname.split('/').filter(Boolean)[0] ?? '';
  }
  value = value.replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_][a-z0-9_-]{0,49}$/.test(value) || ['directory','drops','videos','settings','login','signup'].includes(value)) throw new Error(`Canal inválido: ${value.slice(0,50)}`);
  return value;
}
export function normalizeChannel(c) {
  const p = platform(c.platform);
  const rewards = Array.isArray(c.rewardIds) ? c.rewardIds : [];
  const priority = Number(c.priority ?? 0);
  if (!Number.isFinite(priority) || Math.abs(priority)>1000) throw new Error('Prioridad inválida');
  const dates={};
  for(const k of ['startsAt','endsAt']) {if(c[k] && !Number.isFinite(Date.parse(c[k])))throw new Error('Fecha de campaña inválida');dates[k]=c[k]?new Date(c[k]).toISOString():null;}
  return {id:randomUUID(),platform:p,login:normalizeLogin(c.login,p),game:String(c.game ?? 'Rust').slice(0,100),campaignId:String(c.campaignId??'').slice(0,300),campaignTitle:String(c.campaignTitle??'').slice(0,300),...dates,priority,enabled:c.enabled!==false,rewardIds:rewards.map(x=>String(x).trim().slice(0,300)).filter(Boolean).slice(0,100),completed:c.completed===true};
}
export function validateConfig(data) {
  if (!data || !Array.isArray(data.channels) || data.channels.length>1000) throw new Error('Configuración inválida: máximo 1000 canales');
  const seen = new Set();
  const channels = data.channels.map(normalizeChannel).filter(c=>{const key=`${c.platform}:${c.login}:${c.game.toLowerCase()}:${c.campaignTitle}`;if(seen.has(key))return false;seen.add(key);return true;});
  return {version:1,settings:validateSettings(data.settings),channels};
}
