const { SlashCommandBuilder } = require('@discordjs/builders');
const { isFactionModerator, moderatorFactionAutocomplete, factionOption } = require('../../factionUi');

module.exports = {
    private: true,
    data: new SlashCommandBuilder().setName('faction_visibility').setDescription('Reveal a faction to a player or remove a manual reveal [ MOD ]')
        .addStringOption(option => factionOption(option).setRequired(true))
        .addUserOption(option => option.setName('player').setDescription('Player whose faction visibility to change').setRequired(true))
        .addBooleanOption(option => option.setName('visible').setDescription('Reveal the faction, or remove its manual reveal').setRequired(true)),
    autocomplete: moderatorFactionAutocomplete,
    async execute(service, interaction) {
        if (!isFactionModerator(service, interaction)) {
            await interaction.editReply('Only moderators and the server owner can change faction visibility.'); return;
        }
        try {
            const faction = await service.factions.find(interaction.options.getString('faction'));
            if (!faction) { await interaction.editReply('That faction is not available.'); return; }
            const player = interaction.options.getUser('player');
            const visible = interaction.options.getBoolean('visible');
            const result = await service.factions.setVisibility(faction.faction_id, player.id, visible);
            let content = visible ? 'Faction revealed to this player.' : 'Manual reveal removed.';
            if (!visible && result.renown_visible) { content += ' Renown has permanently revealed this faction to them.'; }
            else if (!visible && result.is_public) { content += ' This faction is still fully public.'; }
            await interaction.editReply({ content, allowedMentions: { parse: [] } });
        } catch (error) { await interaction.editReply(error.message); }
    },
};
