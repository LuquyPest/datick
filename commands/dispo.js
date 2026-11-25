// /dispo — OVH Eco servers in stock now (only on servers where the OVH watch is on, utils/ecoWatch.js)
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const E = require('../utils/ecoWatch');
const { dcLabel, RANGE_LABELS, ECO_URL } = require('../utils/ecoWatchOvh');
const { getTenantDb } = require('../utils/tenantDb');

module.exports = {
  feature: 'ecoWatch', // not registered globally (deploy-commands.js)
  data: new SlashCommandBuilder().setName('dispo').setDescription('Serveurs OVH Eco disponibles en ce moment')
    .addStringOption(o => o.setName('gamme').setDescription('Filtrer par gamme')
      .addChoices({ name: 'Kimsufi', value: 'kimsufi' }, { name: 'So you Start', value: 'soyoustart' }, { name: 'Rise', value: 'rise' })),

  async execute(client, interaction) {
    const ephemeral = { flags: MessageFlags.Ephemeral };
    if (!(await E.settings(getTenantDb(interaction.guildId))).enabled) return interaction.reply({ content: '❌ La veille OVH n\'est pas activée sur ce serveur.', ...ephemeral });
    const range = interaction.options.getString('gamme');
    const snap = await E.readSnapshot();
    const available = snap.servers.filter(s => s.available && (!range || s.range === range));
    const embed = new EmbedBuilder().setColor(available.length ? 0x22c55e : 0xf59e0b)
      .setTitle(`Serveurs OVH Eco disponibles${range ? ` — ${RANGE_LABELS[range]}` : ''}`).setURL(ECO_URL);
    if (snap.lastPollAt) embed.setFooter({ text: 'Dernière vérification' }).setTimestamp(new Date(snap.lastPollAt));
    let text = '';
    for (const [i, s] of available.entries()) {
      const line = `🟢 **${s.name}** — ${E.priceLabel(s)} ${s.datacenters.filter(d => d.available).map(d => dcLabel(d.datacenter).split(' ')[0]).join('')}\n`;
      if ((text + line).length > 3900) { text += `… +${available.length - i}`; break; }
      text += line;
    }
    embed.setDescription(text || (snap.lastPollAt ? 'Rien de disponible pour le moment 😢\nCrée une alerte avec `/alerte ajouter` !' : 'Première vérification en cours, réessaie dans une minute.'));
    return interaction.reply({ embeds: [embed], ...ephemeral });
  },
};
