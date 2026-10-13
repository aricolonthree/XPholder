const { SlashCommandBuilder } = require('@discordjs/builders');
const { isFactionModerator, moderatorFactionAutocomplete, factionOption, buildFactionEmbed } = require('../../factionUi');

const sectionOption = option => option.setName('section').setDescription('Choose the info section').setAutocomplete(true).setRequired(true);
const titleOption = option => option.setName('title').setDescription('Section heading').setMinLength(1).setMaxLength(80);
const textOption = option => option.setName('text').setDescription('Section content').setMinLength(1).setMaxLength(1024);

module.exports = {
    private: true,
    data: new SlashCommandBuilder().setName('faction_info').setDescription('Manage additional faction info sections [ MOD ]')
        .addSubcommand(command => command.setName('add').setDescription('Add an info section')
            .addStringOption(option => factionOption(option).setRequired(true))
            .addStringOption(option => titleOption(option).setRequired(true))
            .addStringOption(option => textOption(option).setRequired(true)))
        .addSubcommand(command => command.setName('edit').setDescription('Edit an info section')
            .addStringOption(option => factionOption(option).setRequired(true))
            .addStringOption(sectionOption).addStringOption(titleOption).addStringOption(textOption))
        .addSubcommand(command => command.setName('remove').setDescription('Remove an info section')
            .addStringOption(option => factionOption(option).setRequired(true)).addStringOption(sectionOption)),
    async autocomplete(service, interaction) {
        if (!isFactionModerator(service, interaction)) { await interaction.respond([]); return; }
        const focused = interaction.options.getFocused(true);
        if (focused.name !== 'section') { await moderatorFactionAutocomplete(service, interaction); return; }
        const faction = await service.factions.find(interaction.options.getString('faction'));
        const query = focused.value.trim().toLowerCase();
        await interaction.respond((faction?.info_sections || []).filter(section => section.title.toLowerCase().includes(query))
            .map(section => ({ name: section.title, value: section.id })));
    },
    async execute(service, interaction) {
        if (!isFactionModerator(service, interaction)) {
            await interaction.editReply('Only moderators and the server owner can edit faction info.'); return;
        }
        try {
            const faction = await service.factions.find(interaction.options.getString('faction'));
            if (!faction) { await interaction.editReply('That faction is not available.'); return; }
            const action = interaction.options.getSubcommand();
            const changes = {};
            for (const key of ['title', 'text']) {
                const value = interaction.options.getString(key);
                if (value !== null) { changes[key] = value; }
            }
            if (action === 'edit' && !Object.keys(changes).length) { await interaction.editReply('Provide a title or text to edit.'); return; }
            const updated = await service.factions.editInfo(faction.faction_id, action, interaction.options.getString('section'), changes);
            await interaction.editReply({ content: 'Faction info updated.', embeds: [buildFactionEmbed(updated)], allowedMentions: { parse: [] } });
        } catch (error) { await interaction.editReply(error.message); }
    },
};
