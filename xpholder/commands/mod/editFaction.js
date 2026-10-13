const { SlashCommandBuilder } = require('@discordjs/builders');
const { isFactionModerator, moderatorFactionAutocomplete, factionOption, buildFactionEmbed } = require('../../factionUi');

module.exports = {
    private: true,
    data: new SlashCommandBuilder().setName('edit_faction').setDescription('Edit a registered faction [ MOD ]')
        .addStringOption(option => factionOption(option).setRequired(true))
        .addStringOption(option => option.setName('name').setDescription('New faction name').setMinLength(1).setMaxLength(80))
        .addStringOption(option => option.setName('description').setDescription('New faction description').setMinLength(1).setMaxLength(2000))
        .addStringOption(option => option.setName('image_url').setDescription('New HTTPS image URL').setMaxLength(2048))
        .addBooleanOption(option => option.setName('remove_image').setDescription('Remove the existing faction image'))
        .addUserOption(option => option.setName('primary_dm').setDescription('Primary DM for this faction'))
        .addBooleanOption(option => option.setName('remove_primary_dm').setDescription('Remove the primary DM'))
        .addBooleanOption(option => option.setName('fully_public').setDescription('Make this faction visible to every player')),
    autocomplete: moderatorFactionAutocomplete,
    async execute(service, interaction) {
        if (!isFactionModerator(service, interaction)) {
            await interaction.editReply('Only moderators and the server owner can edit factions.');
            return;
        }
        try {
            const faction = await service.factions.find(interaction.options.getString('faction'));
            if (!faction) { await interaction.editReply('That faction is not registered in this server.'); return; }
            const changes = {};
            for (const key of ['name', 'description', 'image_url']) {
                const value = interaction.options.getString(key);
                if (value !== null) { changes[key] = value; }
            }
            if (interaction.options.getBoolean('remove_image')) {
                if (changes.image_url) { await interaction.editReply('Choose either a new image or remove_image.'); return; }
                changes.image_url = '';
            }
            const dm = interaction.options.getUser('primary_dm');
            const removeDm = interaction.options.getBoolean('remove_primary_dm');
            if (dm && removeDm) { await interaction.editReply('Choose either a primary_dm or remove_primary_dm.'); return; }
            if (dm || removeDm) {
                changes.primary_dm_id = dm?.id || '';
                changes.primary_dm_name = dm?.globalName || dm?.username || '';
            }
            const fullyPublic = interaction.options.getBoolean('fully_public');
            if (fullyPublic !== null) { changes.is_public = fullyPublic; }
            if (!Object.keys(changes).length) { await interaction.editReply('Provide a faction detail to edit.'); return; }
            const updated = await service.factions.edit(faction.faction_id, changes);
            await interaction.editReply({ content: 'Faction updated.', embeds: [buildFactionEmbed(updated)], allowedMentions: { parse: [] } });
        } catch (error) { await interaction.editReply(error.message); }
    },
};
