const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { XPHOLDER_COLOUR } = require('../../config.json');
const { factionAutocomplete, factionOption, buildFactionEmbed, factionViewer } = require('../../factionUi');

const PAGE_SIZE = 10;

module.exports = {
    log: false,
    data: new SlashCommandBuilder().setName('factions').setDescription('List this server\'s registered factions or view a faction\'s details')
        .addStringOption(factionOption)
        .addBooleanOption(option => option.setName('public').setDescription('Share factions visible to you with everyone in this channel?')),
    autocomplete: factionAutocomplete,
    async execute(service, interaction) {
        const selection = interaction.options.getString('faction');
        if (selection) {
            const faction = await service.factions.find(selection, factionViewer(service, interaction));
            if (!faction) { await interaction.editReply('That faction is not available.'); return; }
            await interaction.editReply({ embeds: [buildFactionEmbed(faction)], allowedMentions: { parse: [] } });
            return;
        }
        let factions = await service.factions.list(null, factionViewer(service, interaction));
        if (!factions.length) { await interaction.editReply('No factions are visible to you.'); return; }
        let page = 0;
        const render = () => {
            const pages = Math.ceil(factions.length / PAGE_SIZE);
            const embed = new EmbedBuilder().setTitle('Registered Factions').setColor(XPHOLDER_COLOUR)
                .setDescription('Use /factions faction: to see full details and an image, or /renown to view your character\'s relations.')
                .addFields(factions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(faction => ({
                    name: faction.name,
                    value: faction.description.length > 200 ? `${faction.description.slice(0, 199)}…` : faction.description,
                })))
                .setFooter({ text: `${factions.length} factions • Page ${page + 1} of ${pages}` });
            const components = pages > 1 ? [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('factions_previous').setLabel('Previous page').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
                new ButtonBuilder().setCustomId('factions_next').setLabel('Next page').setStyle(ButtonStyle.Secondary).setDisabled(page === pages - 1),
            )] : [];
            return { embeds: [embed], components, allowedMentions: { parse: [] } };
        };
        const reply = await interaction.editReply(render());
        if (factions.length <= PAGE_SIZE) { return; }
        let expired = false;
        const collector = reply.createMessageComponentCollector({
            filter: component => !expired && component.user.id === interaction.user.id && component.message.id === reply.id &&
                ['factions_previous', 'factions_next'].includes(component.customId),
            idle: 120_000, time: 600_000,
        });
        let queue = Promise.resolve();
        collector.on('collect', component => {
            const acknowledged = component.deferUpdate().then(() => true, () => false);
            queue = queue.then(async () => {
                if (!await acknowledged || expired) { return; }
                await service.init();
                factions = await service.factions.list(null, factionViewer(service, {
                    user: interaction.user, guild: interaction.guild, member: component.member ?? interaction.member,
                }));
                if (!factions.length) {
                    collector.stop();
                    await interaction.editReply({ content: 'No factions are visible to you.', embeds: [], components: [] });
                    return;
                }
                const lastPage = Math.ceil(factions.length / PAGE_SIZE) - 1;
                page = Math.max(0, Math.min(lastPage, page + (component.customId === 'factions_next' ? 1 : -1)));
                await interaction.editReply(render());
            }).catch(async () => {
                collector.stop();
                await interaction.editReply({ content: 'Could not refresh factions. Please run /factions again.', components: [] }).catch(() => {});
            });
            return queue;
        });
        collector.on('end', () => {
            expired = true;
            return queue.then(() => interaction.editReply({ components: [] })).catch(() => {});
        });
    },
};
