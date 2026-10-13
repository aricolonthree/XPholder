const { SlashCommandBuilder } = require('@discordjs/builders');
const { isFactionModerator, moderatorFactionAutocomplete, factionOption } = require('../../factionUi');

module.exports = {
    private: true,
    data: new SlashCommandBuilder().setName('delete_faction').setDescription('Delete a faction and its renown records [ MOD ]')
        .addStringOption(option => factionOption(option).setRequired(true))
        .addBooleanOption(option => option.setName('confirm').setDescription('Confirm deletion of this faction and all its renown').setRequired(true)),
    autocomplete: moderatorFactionAutocomplete,
    async execute(service, interaction) {
        if (!isFactionModerator(service, interaction)) {
            await interaction.editReply('Only moderators and the server owner can delete factions.'); return;
        }
        if (!interaction.options.getBoolean('confirm')) { await interaction.editReply('Faction not deleted. Set confirm to true to delete it.'); return; }
        try {
            const faction = await service.factions.find(interaction.options.getString('faction'));
            if (!faction) { await interaction.editReply('That faction is not available.'); return; }
            await service.factions.delete(faction.faction_id);
            await interaction.editReply({ content: 'Faction deleted.', allowedMentions: { parse: [] } });
        } catch (error) { await interaction.editReply(error.message); }
    },
};
