// /alerte — a member's own OVH Eco alerts (only on servers where the OVH watch is on, utils/ecoWatch.js)
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const E = require('../utils/ecoWatch');
const { dcLabel, ECO_URL } = require('../utils/ecoWatchOvh');
const { getTenantDb } = require('../utils/tenantDb');

const cut = (str, n) => (str.length > n ? `${str.slice(0, n - 1)}…` : str);
const nameOf = (servers, plan) => servers.find(s => s.planCode === plan)?.name.split('|')[0].trim() || plan;
const title = (a, servers) => `#${a.id} ${a.enabled ? '' : '⏸️ '}${a.label || a.planCodes.map(p => nameOf(servers, p)).join(', ')}`;
const idOption = o => o.setName('id').setDescription('Alerte').setRequired(true).setAutocomplete(true);

module.exports = {
  feature: 'ecoWatch',
  data: new SlashCommandBuilder().setName('alerte').setDescription('Tes alertes de disponibilité OVH Eco')
    .addSubcommand(s => s.setName('ajouter').setDescription('Être prévenu quand un serveur se libère')
      .addStringOption(o => o.setName('serveur').setDescription('Serveur à surveiller').setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName('datacenter').setDescription('Limiter à un datacenter (tous par défaut)').setAutocomplete(true))
      .addNumberOption(o => o.setName('prix_max').setDescription('Prix max HT par mois, en €').setMinValue(0))
      .addChannelOption(o => o.setName('salon').setDescription('Salon où te mentionner').addChannelTypes(...E.CHANNEL_TYPES)))
    .addSubcommand(s => s.setName('liste').setDescription('Voir tes alertes'))
    .addSubcommand(s => s.setName('pause').setDescription('Mettre en pause ou réactiver une alerte').addIntegerOption(idOption))
    .addSubcommand(s => s.setName('supprimer').setDescription('Supprimer une alerte').addIntegerOption(idOption)),

  async autocomplete(client, interaction) {
    const db = getTenantDb(interaction.guildId);
    if (!(await E.settings(db)).enabled) return interaction.respond([]);
    const focused = interaction.options.getFocused(true);
    const q = String(focused.value).toLowerCase();
    const snap = await E.readSnapshot();
    let choices = [];
    if (focused.name === 'serveur') {
      choices = snap.servers.filter(s => `${s.name} ${s.planCode} ${s.cpu || ''}`.toLowerCase().includes(q))
        .map(s => ({ name: cut(`${s.available ? '🟢' : '🔴'} ${s.name} — ${E.priceLabel(s)}`, 100), value: s.planCode }));
    } else if (focused.name === 'datacenter') {
      choices = snap.datacenters.filter(d => `${d} ${dcLabel(d)}`.toLowerCase().includes(q)).map(d => ({ name: dcLabel(d), value: d }));
    } else if (focused.name === 'id') {
      choices = (await E.listAlerts(db, interaction.user.id)).map(a => ({ name: cut(title(a, snap.servers), 100), value: a.id }))
        .filter(c => c.name.toLowerCase().includes(q));
    }
    return interaction.respond(choices.slice(0, 25));
  },

  async execute(client, interaction) {
    const db = getTenantDb(interaction.guildId);
    const reply = content => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    const { enabled, channelId: defaultChannelId } = await E.settings(db);
    if (!enabled) return reply('❌ La veille OVH n\'est pas activée sur ce serveur.');
    const ctx = { client, guildId: interaction.guildId, db, userId: interaction.user.id };
    const sub = interaction.options.getSubcommand();

    if (sub === 'ajouter') {
      const datacenter = interaction.options.getString('datacenter');
      const plan = interaction.options.getString('serveur', true);
      const r = await E.createAlert(ctx, interaction.user, {
        planCodes: [plan], datacenters: datacenter ? [datacenter] : [], maxPrice: interaction.options.getNumber('prix_max'),
        channelId: interaction.options.getChannel('salon')?.id || defaultChannelId || interaction.channelId,
      });
      if (r.error) return reply(`❌ ${r.error}.`);
      const server = (await E.readSnapshot()).servers.find(s => s.planCode === plan);
      const now = server?.datacenters.filter(d => d.available && (!datacenter || d.datacenter === datacenter)) || [];
      return reply(`✅ Alerte **#${r.alert.id}** créée : je te mentionnerai dans <#${r.alert.channelId}> dès que **${server?.name || plan}** se libère.`
        + (now.length ? `\n⚡ Il est **déjà disponible** : ${now.map(d => dcLabel(d.datacenter)).join(', ')} — ${ECO_URL}` : ''));
    }

    if (sub === 'liste') {
      const { servers } = await E.readSnapshot();
      const lines = (await E.listAlerts(db, interaction.user.id)).map(a => {
        const filters = [a.datacenters.length ? a.datacenters.map(dcLabel).join(', ') : 'tous les datacenters', a.maxPrice !== null ? `≤ ${a.maxPrice} €` : null, `<#${a.channelId}>`];
        return `${a.enabled ? '🔔' : '⏸️'} ${title(a, servers)}\n└ ${filters.filter(Boolean).join(' · ')}`;
      });
      const embed = new EmbedBuilder().setColor(0x3b82f6).setTitle('Tes alertes OVH Eco').setURL(ECO_URL)
        .setDescription(cut(lines.join('\n') || 'Aucune alerte. Utilise `/alerte ajouter`.', 4000));
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    const alert = await E.getAlert(db, interaction.options.getInteger('id', true));
    if (!alert || alert.userId !== interaction.user.id) return reply('❌ Alerte introuvable.');
    if (sub === 'supprimer') {
      await E.removeAlert(db, alert.id);
      return reply(`🗑️ Alerte #${alert.id} supprimée.`);
    }
    // Pause does not recheck the channel: an alert can always be paused
    await db('UPDATE eco_alerts SET enabled = ? WHERE id = ?', [alert.enabled ? 0 : 1, alert.id]);
    return reply(alert.enabled ? `⏸️ Alerte #${alert.id} en pause.` : `🔔 Alerte #${alert.id} réactivée.`);
  },
};
