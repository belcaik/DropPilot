import { load } from 'cheerio';
import { createHash } from 'node:crypto';

export function channelLogin(value, platform) {
  const raw = typeof value === 'string' ? value : value?.login || value?.name || value?.url;
  if (!raw) throw new Error('Canal vacío');
  let login = raw.trim();
  if (/^https?:/i.test(login)) {
    const url = new URL(login);
    const allowed = platform === 'twitch' ? ['twitch.tv', 'www.twitch.tv'] : ['kick.com', 'www.kick.com'];
    if (url.protocol !== 'https:' || !allowed.includes(url.hostname) || url.pathname.split('/').filter(Boolean).length !== 1) throw new Error('URL de canal inválida');
    login = url.pathname.slice(1);
  }
  login = login.replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_][a-z0-9_-]{0,49}$/.test(login) || ['directory', 'drops', 'settings', 'login', 'videos', 'categories'].includes(login)) throw new Error('Nombre de canal inválido');
  return login;
}

export function parseCampaign(html, platform) {
  if (!['twitch', 'kick'].includes(platform)) throw new Error('Plataforma desconocida');
  const $ = load(html);
  const campaignTitle = $('.event-title').first().text().trim() || null;
  const dates = $('.event-date [data-date-id]').map((_, element) => {
    const seconds = $(element).attr('data-date-id')?.match(/-(\d{10})$/)?.[1];
    return seconds ? new Date(Number(seconds) * 1000).toISOString() : null;
  }).get();
  const rewards = [];
  const channelMap = new Map();
  $('.drop-box').each((index, element) => {
    const card = $(element);
    const name = card.find('.drop-type').first().text().trim();
    if (!name) return;
    const logins = new Set();
    card.find('a.streamer-info, a.drop-box-body').each((_, anchor) => {
      try { logins.add(channelLogin($(anchor).attr('href'), platform)); } catch { /* General category links are not channels. */ }
    });
    const itemId = card.find('[data-itemid]').first().attr('data-itemid');
    const image = card.find('.drop-box-body img').first().attr('src') || null;
    const timeText = card.find('.drop-time').text().replace(/\s+/g, ' ').trim();
    const hours = timeText.match(/([\d.]+)\s*(?:hours?|horas?)/i);
    const minutes = timeText.match(/([\d.]+)\s*(?:minutes?|minutos?)/i);
    const durationMinutes = hours ? Number(hours[1]) * 60 : minutes ? Number(minutes[1]) : null;
    const fingerprint = createHash('sha256').update([name, ...[...logins].sort(), image || '', index].join('|')).digest('hex').slice(0, 16);
    const id = `facepunch:${platform}:${itemId || fingerprint}`;
    const reward = { id, itemId: itemId || null, platform, name, game: 'Rust', campaignTitle, startsAt: dates[0] || null, endsAt: dates[1] || null, channels: [...logins], general: logins.size === 0, durationMinutes, image, source: `https://${platform}.facepunch.com/` };
    rewards.push(reward);
    for (const login of logins) {
      if (!channelMap.has(login)) channelMap.set(login, { id: `${platform}:${login}`, platform, login, name: login, url: `https://${platform === 'twitch' ? 'www.twitch.tv' : 'kick.com'}/${login}`, enabled: true, game: 'Rust', campaignTitle, startsAt: dates[0] || null, endsAt: dates[1] || null, rewardIds: [], rewardNames: [] });
      channelMap.get(login).rewardIds.push(id);
      channelMap.get(login).rewardNames.push(name);
    }
  });
  if (!$('title').text().includes('Drops') && !$('.section.drops').length) throw new Error('Facepunch devolvió una página no reconocida; posible bloqueo o cambio de formato');
  return { platform, title: campaignTitle || $('title').text().trim(), campaignTitle, startsAt: dates[0] || null, endsAt: dates[1] || null, source: `https://${platform}.facepunch.com/`, fetchedAt: new Date().toISOString(), channels: [...channelMap.values()], rewards, warnings: rewards.length ? [] : ['No se encontraron recompensas activas publicadas en Facepunch.'] };
}

export async function fetchCampaign(platform, { fetchImpl = globalThis.fetch } = {}) {
  if (!['twitch', 'kick'].includes(platform)) throw new Error('Plataforma desconocida');
  const response = await fetchImpl(`https://${platform}.facepunch.com/`, { signal: AbortSignal.timeout(20000), redirect: 'error', headers: { Accept: 'text/html' } });
  if (!response.ok) throw new Error(`Facepunch HTTP ${response.status}`);
  const html = await response.text();
  if (html.length > 5_000_000) throw new Error('Respuesta Facepunch demasiado grande');
  return parseCampaign(html, platform);
}
