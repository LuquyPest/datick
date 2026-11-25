// OVH Eco Watch: members are mentioned in a channel when an OVHcloud Eco server they wait for is
// back in stock. Off by default, turned on per space (Paramètres → Fonctionnalités): the slash
// commands /dispo and /alerte only exist on the servers where it is on.
// The stock is the same for everyone: one reading per minute for the whole instance (job
// « eco-watch »), kept in Redis; the alerts live in each space's database.
const { EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const ovh = require('./ecoWatchOvh');
const { getRedis } = require('./redis');
const { getTenantDb } = require('./tenantDb');
const { parseJsonField } = require('./jsonField');
const { fetchGuildChannel } = require('./discordGuard');
const logger = require('./logger');

const SNAPSHOT_KEY = 'eco:snapshot'; // what the page and the commands show
const STATE_KEY = 'eco:state';       // « fqn@dc » already available: only what appears is announced
const STATE_TTL = 24 * 3600;         // after a day without reading, the next one announces nothing
const CATALOG_TTL = 3600 * 1000;
const COOLDOWN_MINUTES = 15;         // per alert and server, when a stock flickers
const MAX_ALERTS_PER_USER = 25;
const MAX_PLANS = 100;
const CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const SNOWFLAKE = /^\d{17,20}$/;

// Replaced by the tests
const source = { fetchCatalog: ovh.fetchCatalog, fetchAvailabilities: ovh.fetchAvailabilities, fetchLinks: ovh.fetchLinks };
let catalog = { at: 0, plans: null };

async function settings(db) {
  const [row] = await db('SELECT eco_watch_enabled, eco_watch_channel_id FROM guild_config WHERE id = 1').catch(() => []);
  return { enabled: Number(row?.eco_watch_enabled) === 1, channelId: row?.eco_watch_channel_id || null };
}

async function readSnapshot() {
  const raw = await getRedis().get(SNAPSHOT_KEY);
  return raw ? JSON.parse(raw) : { servers: [], datacenters: [], lastPollAt: null, lastError: null };
}

// ── Reading the stock ──

function build(rows, plans) {
  const entries = new Map();
  const dcs = new Set();
  const servers = new Map();
  for (const row of rows) {
    if (!servers.has(row.planCode)) servers.set(row.planCode, { ...plans[row.planCode], available: false, datacenters: {}, variants: [] });
    const server = servers.get(row.planCode);
    const plan = plans[row.planCode];
    const memory = ovh.rowOption(plan, 'memory', row.memory);
    const storage = ovh.rowOption(plan, 'storage', row.storage);
    const variant = {
      memory: row.memory, storage: row.storage, datacenters: [],
      memoryLabel: memory?.label || ovh.prettyMemory(row.memory), storageLabel: storage?.label || ovh.prettyStorage(row.storage),
      // Monthly price of this configuration: the plan plus what its memory and disks add
      price: memory && storage && plan.price !== null ? Math.round((plan.price + memory.price + storage.price) * 100) / 100 : null,
    };
    for (const dc of row.datacenters || []) {
      dcs.add(dc.datacenter);
      const ok = ovh.isAvailable(dc.availability);
      variant.datacenters.push({ datacenter: dc.datacenter, availability: dc.availability, available: ok });
      server.datacenters[dc.datacenter] ||= false;
      if (!ok) continue;
      server.available = true;
      server.datacenters[dc.datacenter] = true;
      entries.set(`${row.fqn}@${dc.datacenter}`, { planCode: row.planCode, fqn: row.fqn, memory: row.memory, storage: row.storage, datacenter: dc.datacenter, availability: dc.availability });
    }
    server.variants.push(variant);
  }
  const list = [...servers.values()]
    .map(s => ({ ...s, datacenters: Object.entries(s.datacenters).map(([datacenter, available]) => ({ datacenter, available })) }))
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  return { servers: list, datacenters: [...dcs].sort(), entries };
}

// → [{ server, entries }] of what became available since the previous reading
async function poll() {
  const redis = getRedis();
  try {
    if (!catalog.plans || Date.now() - catalog.at > CATALOG_TTL) {
      try {
        const plans = await source.fetchCatalog();
        // The product links come from the website: without it, the range pages are linked
        const links = await source.fetchLinks().catch(err => { logger.warn('Veille OVH : pages produit illisibles', { err: err.message }); return {}; });
        for (const plan of Object.values(plans)) Object.assign(plan, ovh.productLink(plan, links));
        catalog = { at: Date.now(), plans };
      } catch (err) { if (!catalog.plans) throw err; }
    }
    const rows = (await source.fetchAvailabilities()).filter(r => Object.hasOwn(catalog.plans, r.planCode));
    if (!rows.length) throw new Error('Aucune disponibilité pour les serveurs Eco (réponse ignorée)');
    const { servers, datacenters, entries } = build(rows, catalog.plans);
    const previous = parseJsonField(await redis.get(STATE_KEY), null);
    await redis.set(STATE_KEY, JSON.stringify([...entries.keys()]), 'EX', STATE_TTL);
    await redis.set(SNAPSHOT_KEY, JSON.stringify({ servers, datacenters, lastPollAt: new Date().toISOString(), lastError: null }));
    if (!previous) return [];
    const known = new Set(previous);
    const byPlan = new Map();
    for (const [key, e] of entries) {
      if (known.has(key)) continue;
      if (!byPlan.has(e.planCode)) byPlan.set(e.planCode, []);
      byPlan.get(e.planCode).push(e);
    }
    return [...byPlan].map(([planCode, list]) => ({ server: servers.find(s => s.planCode === planCode), entries: list }));
  } catch (err) {
    await redis.set(SNAPSHOT_KEY, JSON.stringify({ ...await readSnapshot(), lastError: err.message }));
    throw err;
  }
}

// ── Alerts ──

const shape = a => ({
  id: a.id, userId: a.user_id, username: a.username, label: a.label || '', planCodes: parseJsonField(a.plan_codes, []),
  datacenters: parseJsonField(a.datacenters, []), maxPrice: a.max_price === null ? null : Number(a.max_price), channelId: a.channel_id,
  enabled: !!Number(a.enabled), notifications: Number(a.notifications), lastNotifiedAt: a.last_notified_at,
});
async function listAlerts(db, userId = null) {
  const rows = await db(`SELECT * FROM eco_alerts${userId ? ' WHERE user_id = ?' : ''} ORDER BY id`, userId ? [userId] : []);
  return rows.map(shape);
}
async function getAlert(db, id) {
  const [row] = await db('SELECT * FROM eco_alerts WHERE id = ?', [parseInt(id) || 0]);
  return row ? shape(row) : null;
}

// The channel must belong to this server and take the bot's messages; unless it is the default one
// chosen by the founders, the person must be able to write in it too
async function channelProblem(client, guildId, channelId, userId, defaultChannelId) {
  const channel = await fetchGuildChannel(client, guildId, channelId);
  if (!channel || !CHANNEL_TYPES.includes(channel.type)) return 'Salon introuvable sur ce serveur';
  const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
  const me = await channel.guild.members.fetchMe().catch(() => null);
  if (!me || !channel.permissionsFor(me)?.has([...needed, PermissionFlagsBits.EmbedLinks])) return 'Le bot ne peut pas écrire dans ce salon';
  if (channelId === defaultChannelId) return null;
  const member = await channel.guild.members.fetch(userId).catch(() => null);
  if (!member || !channel.permissionsFor(member)?.has(needed)) return 'Tu n\'as pas le droit d\'écrire dans ce salon';
  return null;
}

// → { value } or { error }. « current » : the alert being edited (only the given fields change)
async function validateAlert({ client, guildId, db, userId }, body, current = null) {
  const out = {};
  const has = k => !current || body[k] !== undefined;
  const snap = await readSnapshot();
  if (has('planCodes')) {
    const codes = Array.isArray(body.planCodes) ? [...new Set(body.planCodes)] : [];
    if (!codes.length) return { error: 'Choisis au moins un serveur' };
    if (codes.length > MAX_PLANS) return { error: `${MAX_PLANS} serveurs au plus par alerte` };
    const known = new Set([...snap.servers.map(s => s.planCode), ...(current?.planCodes || [])]);
    if (codes.some(c => !known.has(c))) return { error: 'Serveur inconnu' };
    out.plan_codes = JSON.stringify(codes);
  }
  if (has('datacenters')) {
    const dcs = body.datacenters ?? [];
    if (!Array.isArray(dcs) || dcs.length > 40 || dcs.some(d => typeof d !== 'string' || !/^[a-z0-9-]{2,20}$/i.test(d))) return { error: 'Datacenters invalides' };
    out.datacenters = JSON.stringify([...new Set(dcs)]);
  }
  if (has('maxPrice')) {
    const p = body.maxPrice;
    if (p === null || p === undefined || p === '') out.max_price = null;
    else if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 100000) return { error: 'Prix maximum invalide' };
    else out.max_price = p;
  }
  if (has('label')) out.label = typeof body.label === 'string' ? body.label.trim().slice(0, 80) : '';
  if (current && body.enabled !== undefined) out.enabled = body.enabled ? 1 : 0;
  if (has('channelId')) {
    const { channelId: def } = await settings(db);
    const channelId = body.channelId || def;
    if (typeof channelId !== 'string' || !SNOWFLAKE.test(channelId)) return { error: 'Choisis un salon' };
    // The owner of the alert must be able to write there, also when a founder edits it
    const problem = await channelProblem(client, guildId, channelId, current?.userId || userId, def);
    if (problem) return { error: problem };
    out.channel_id = channelId;
  }
  return { value: out };
}

async function createAlert(ctx, user, body) {
  if (!SNOWFLAKE.test(String(user.id))) return { error: 'Connecte-toi avec Discord : l\'alerte te mentionne sur le serveur' };
  const [{ n }] = await ctx.db('SELECT COUNT(*) AS n FROM eco_alerts WHERE user_id = ?', [user.id]);
  if (Number(n) >= MAX_ALERTS_PER_USER) return { error: `${MAX_ALERTS_PER_USER} alertes au plus par personne` };
  const v = await validateAlert({ ...ctx, userId: user.id }, body);
  if (v.error) return v;
  const row = { ...v.value, user_id: user.id, username: String(user.username || '').slice(0, 100) };
  const cols = Object.keys(row);
  const { insertId } = await ctx.db(`INSERT INTO eco_alerts (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map(c => row[c]));
  return { alert: await getAlert(ctx.db, insertId) };
}

async function updateAlert(ctx, alert, body) {
  const v = await validateAlert(ctx, body, alert);
  if (v.error) return v;
  const cols = Object.keys(v.value);
  if (cols.length) await ctx.db(`UPDATE eco_alerts SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map(c => v.value[c]), alert.id]);
  return { alert: await getAlert(ctx.db, alert.id) };
}

const removeAlert = (db, id) => db('DELETE FROM eco_alerts WHERE id = ?', [id]);

// ── Notifications ──

const priceLabel = s => (s.price === null || s.price === undefined ? '—' : `${s.price.toFixed(2).replace('.', ',')} € HT/mois`);
const cut = (str, n) => (str.length > n ? `${str.slice(0, n - 1)}…` : str);

function availabilityEmbed(server, entries) {
  const byVariant = new Map();
  for (const e of entries) {
    if (!byVariant.has(e.fqn)) byVariant.set(e.fqn, { ...e, dcs: [] });
    byVariant.get(e.fqn).dcs.push(`${ovh.dcLabel(e.datacenter)} (${ovh.availabilityLabel(e.availability)})`);
  }
  const lines = [...byVariant.values()].map(v => `**${[ovh.prettyMemory(v.memory), ovh.prettyStorage(v.storage)].filter(Boolean).join(' · ') || v.fqn}**\n${v.dcs.join(', ')}`);
  let configs = '';
  for (const [i, line] of lines.entries()) {
    if ((configs + line).length > 980) { configs += `\n… +${lines.length - i}`; break; }
    configs += (configs ? '\n\n' : '') + line;
  }
  const specs = [server.cpu, server.cores && `${server.cores}c/${server.threads ?? server.cores}t`, server.memory].filter(Boolean).join(' · ');
  return new EmbedBuilder().setColor(0x22c55e).setTitle(cut(`🟢 ${server.name} est disponible !`, 256)).setURL(server.url || ovh.ECO_URL)
    .setDescription(specs || null)
    .addFields(
      { name: 'Gamme', value: ovh.RANGE_LABELS[server.range] || server.range, inline: true },
      { name: 'Prix', value: priceLabel(server), inline: true },
      { name: 'Code', value: `\`${server.planCode}\``, inline: true },
      { name: 'Configurations disponibles', value: cut(configs || '—', 1024) },
      { name: 'Commander', value: `[Voir sur OVHcloud](${server.url || ovh.ECO_URL})` },
    )
    .setFooter({ text: 'Commande sur eco.ovhcloud.com — premier arrivé, premier servi !' }).setTimestamp(new Date());
}

// One message per channel, mentioning everyone who waits for this server there
async function notifyGuild(client, guildId, db, events) {
  const { enabled, channelId: def } = await settings(db);
  if (!enabled) return 0;
  const alerts = (await listAlerts(db)).filter(a => a.enabled);
  if (!alerts.length) return 0;
  let sent = 0;
  for (const { server, entries } of events) {
    const groups = new Map();
    for (const a of alerts) {
      if (!a.planCodes.includes(server.planCode)) continue;
      if (a.maxPrice !== null && server.price !== null && server.price > a.maxPrice) continue;
      const matching = a.datacenters.length ? entries.filter(e => a.datacenters.includes(e.datacenter)) : entries;
      if (!matching.length) continue;
      const recent = await db('SELECT 1 FROM eco_alert_sent WHERE alert_id = ? AND plan_code = ? AND sent_at > NOW() - INTERVAL ? MINUTE', [a.id, server.planCode, COOLDOWN_MINUTES]);
      const channelId = a.channelId || def;
      if (recent.length || !channelId) continue;
      if (!groups.has(channelId)) groups.set(channelId, { users: new Set(), alerts: [], entries: new Map() });
      const g = groups.get(channelId);
      g.users.add(a.userId);
      g.alerts.push(a.id);
      for (const e of matching) g.entries.set(`${e.fqn}@${e.datacenter}`, e);
    }
    for (const [channelId, g] of groups) {
      try {
        const channel = await fetchGuildChannel(client, guildId, channelId);
        if (!channel?.isTextBased()) throw new Error('salon introuvable');
        const users = [...g.users].slice(0, 80); // fits in a Discord message
        await channel.send({
          content: `🔔 ${users.map(id => `<@${id}>`).join(' ')} — **${server.name}** vient de se libérer !`,
          embeds: [availabilityEmbed(server, [...g.entries.values()])],
          allowedMentions: { users },
        });
        sent++;
        for (const id of g.alerts) {
          await db('INSERT INTO eco_alert_sent (alert_id, plan_code, sent_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE sent_at = NOW()', [id, server.planCode]);
          await db('UPDATE eco_alerts SET notifications = notifications + 1, last_notified_at = NOW() WHERE id = ?', [id]);
        }
      } catch (err) {
        logger.warn('Veille OVH : envoi impossible', { guildId, channelId, err: err.message });
      }
    }
  }
  return sent;
}

async function sendTest(client, guildId, alert) {
  const channel = await fetchGuildChannel(client, guildId, alert.channelId);
  if (!channel?.isTextBased()) throw new Error('Salon introuvable ou inaccessible au bot');
  const { servers } = await readSnapshot();
  const names = alert.planCodes.map(p => servers.find(s => s.planCode === p)?.name || p).join(', ');
  await channel.send({ content: `🧪 <@${alert.userId}> test de l'alerte #${alert.id} : tu seras mentionné ici pour **${cut(names, 1500)}**.`, allowedMentions: { users: [alert.userId] } });
}

async function enabledGuilds() {
  const out = [];
  for (const { guild_id } of await require('./guildScan').getActiveGuilds()) {
    const db = getTenantDb(guild_id);
    if ((await settings(db)).enabled) out.push({ guildId: guild_id, db });
  }
  return out;
}

// Job « eco-watch »: nothing is asked to OVH while no space has turned the feature on
async function runEcoWatch(client) {
  const guilds = await enabledGuilds();
  if (!guilds.length) return;
  const events = await poll();
  if (!events.length) return;
  for (const { guildId, db } of guilds) {
    await notifyGuild(client, guildId, db, events).catch(err => logger.error('Veille OVH', { guildId, err: err.message }));
  }
}

// ── Slash commands: registered on the servers where the feature is on, removed elsewhere ──

const COMMAND_FILES = ['../commands/dispo', '../commands/alerte'];

async function syncCommands(client, guildId, enabled) {
  const manager = client?.application?.commands;
  if (!manager) return;
  const registered = await manager.fetch({ guildId });
  for (const file of COMMAND_FILES) {
    const data = require(file).data.toJSON();
    const existing = registered.find(c => c.name === data.name);
    if (enabled) await manager.create({ ...data, contexts: [0], integration_types: [0] }, guildId); // creates or replaces
    else if (existing) await manager.delete(existing.id, guildId);
  }
}

// At start: the commands of the servers where the feature is on follow the current version
async function syncAllCommands(client) {
  for (const { guildId } of await enabledGuilds()) {
    await syncCommands(client, guildId, true).catch(err => logger.warn('Veille OVH : commandes non enregistrées', { guildId, err: err.message }));
  }
}

module.exports = {
  CHANNEL_TYPES, MAX_ALERTS_PER_USER, source, settings, readSnapshot, poll, listAlerts, getAlert, createAlert, updateAlert, removeAlert,
  notifyGuild, sendTest, runEcoWatch, syncCommands, syncAllCommands, priceLabel,
};
