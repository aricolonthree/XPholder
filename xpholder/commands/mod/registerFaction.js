const { SlashCommandBuilder } = require('@discordjs/builders');
const { isFactionModerator, buildFactionEmbed } = require('../../factionUi');

module.exports = {
    private: true,
    data: new SlashCommandBuilder().setName('register_faction').setDescription('Register a faction for this server [ MOD ]')
        .addStringOption(option => option.setName('name').setDescription('Faction name').setMinLength(1).setMaxLength(80).setRequired(true))
        .addStringOption(option => option.setName('description').setDescription('What players should know about this faction').setMinLength(1).setMaxLength(2000).setRequired(true))
        .addStringOption(option => option.setName('image_url').setDescription('Optional HTTPS image URL').setMaxLength(2048))
        .addUserOption(option => option.setName('primary_dm').setDescription('Primary DM for this faction'))
        .addBooleanOption(option => option.setName('fully_public').setDescription('Make this faction visible to every player (default: false)')),
    async execute(service, interaction) {
        if (!isFactionModerator(service, interaction)) {
            await interaction.editReply('Only moderators and the server owner can register factions.');
            return;
        }
        try {
            const dm = interaction.options.getUser('primary_dm');
            const faction = await service.factions.register({
                name: interaction.options.getString('name'), description: interaction.options.getString('description'),
                image_url: interaction.options.getString('image_url'),
                primary_dm_id: dm?.id, primary_dm_name: dm?.globalName || dm?.username,
                is_public: interaction.options.getBoolean('fully_public') ?? false,
            });
            await interaction.editReply({ content: faction.is_public ? 'Faction registered. Visible to everyone.' : 'Faction registered. Hidden from players until revealed.',
                embeds: [buildFactionEmbed(faction)], allowedMentions: { parse: [] } });
        } catch (error) { await interaction.editReply(error.message); }
    },
};
