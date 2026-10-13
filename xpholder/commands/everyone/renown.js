const { SlashCommandBuilder } = require('@discordjs/builders');
const { getActiveCharacterIndex } = require('../../utils');
const { factionAutocomplete, factionOption, buildRenownEmbed, renownComponents, factionViewer } = require('../../factionUi');

module.exports = {
    log: false,
    data: new SlashCommandBuilder().setName('renown').setDescription('Browse a character\'s relations and ranks with this server\'s factions')
        .addIntegerOption(option => option.setName('character').setDescription('Character to view; defaults to the active character').setMinValue(1).setMaxValue(10))
        .addStringOption(factionOption)
        .addUserOption(option => option.setName('player').setDescription('View another player\'s character'))
        .addBooleanOption(option => option.setName('public').setDescription('Share factions visible to you with everyone in this channel?')),
    autocomplete: factionAutocomplete,
    async execute(service, interaction) {
        const user = interaction.options.getUser('player') || interaction.user;
        const player = await interaction.guild.members.fetch(user.id);
        const characterIndex = interaction.options.getInteger('character') ?? getActiveCharacterIndex(service.config, player._roles);
        const characterId = `${user.id}-${characterIndex}`;
        let character = await service.getCharacter(characterId);
        if (!character) { await interaction.editReply('That character does not exist. A moderator can create one with /approve_player.'); return; }
        let factions = await service.factions.list(characterId, factionViewer(service, interaction));
        if (!factions.length) { await interaction.editReply('No factions are visible to you.'); return; }
        let index = 0;
        const selection = interaction.options.getString('faction');
        if (selection) {
            const faction = await service.factions.find(selection, factionViewer(service, interaction));
            index = factions.findIndex(item => item.faction_id === faction?.faction_id);
            if (index < 0) { await interaction.editReply('That faction is not available.'); return; }
        }
        const render = () => ({
            embeds: [buildRenownEmbed(service, character, factions[index])
                .setFooter({ text: `Faction ${index + 1} of ${factions.length} • Character ${characterIndex}` })],
            components: renownComponents(factions, index), allowedMentions: { parse: [] },
        });
        const reply = await interaction.editReply(render());
        const ids = new Set(['renown_previous', 'renown_next', 'renown_select', 'renown_previous_page', 'renown_next_page']);
        let expired = false;
        const collector = reply.createMessageComponentCollector({
            filter: component => !expired && component.user.id === interaction.user.id && component.message.id === reply.id && ids.has(component.customId),
            idle: 120_000, time: 600_000,
        });
        let queue = Promise.resolve();
        collector.on('collect', component => {
            // Acknowledge immediately, then serialize clicks to keep selection stable.
            const acknowledged = component.deferUpdate().then(() => true, () => false);
            queue = queue.then(async () => {
                if (!await acknowledged || expired) { return; }
                const previousId = factions[index].faction_id;
                await service.init();
                character = await service.getCharacter(characterId);
                factions = await service.factions.list(characterId, factionViewer(service, {
                    user: interaction.user, guild: interaction.guild, member: component.member ?? interaction.member,
                }));
                if (!character || !factions.length) {
                    collector.stop();
                    await interaction.editReply({ content: !character ? 'This character has been retired.' : 'No factions are visible to you.', embeds: [], components: [] });
                    return;
                }
                index = Math.max(0, factions.findIndex(faction => faction.faction_id === previousId));
                switch (component.customId) {
                    case 'renown_previous': index = Math.max(0, index - 1); break;
                    case 'renown_next': index = Math.min(factions.length - 1, index + 1); break;
                    case 'renown_previous_page': index = Math.max(0, (Math.floor(index / 25) - 1) * 25); break;
                    case 'renown_next_page': index = Math.min(factions.length - 1, (Math.floor(index / 25) + 1) * 25); break;
                    case 'renown_select': {
                        const selected = factions.findIndex(faction => String(faction.faction_id) === component.values[0]);
                        if (selected >= 0) { index = selected; }
                        break;
                    }
                }
                await interaction.editReply(render());
            }).catch(async () => {
                collector.stop();
                await interaction.editReply({ content: 'Could not refresh renown. Please run /renown again.', components: [] }).catch(() => {});
            });
            return queue;
        });
        collector.on('end', () => {
            expired = true;
            return queue.then(() => interaction.editReply({ components: [] })).catch(() => {});
        });
    },
};
