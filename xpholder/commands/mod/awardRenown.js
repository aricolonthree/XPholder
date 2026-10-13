const { SlashCommandBuilder } = require('@discordjs/builders');
const { isFactionModerator, moderatorFactionAutocomplete, factionOption, buildRenownEmbed } = require('../../factionUi');
const { getFactionStanding } = require('../../factionRanks');

module.exports = {
    log: false,
    data: new SlashCommandBuilder().setName('award_renown').setDescription('Award faction renown or completed rank requirements [ MOD ]')
        .addUserOption(option => option.setName('player').setDescription('Player receiving the award').setRequired(true))
        .addIntegerOption(option => option.setName('character').setDescription('Character receiving the award').setMinValue(1).setMaxValue(10).setRequired(true))
        .addStringOption(option => factionOption(option).setRequired(true))
        .addIntegerOption(option => option.setName('renown').setDescription('Renown to add; negative values subtract renown').setMinValue(-1_000_000_000).setMaxValue(1_000_000_000))
        .addIntegerOption(option => option.setName('quests').setDescription('Completed faction quests to add; negative values correct mistakes').setMinValue(-1000).setMaxValue(1000))
        .addIntegerOption(option => option.setName('solo_challenges').setDescription('Completed solo challenges to add; negative values correct mistakes').setMinValue(-1000).setMaxValue(1000))
        .addStringOption(option => option.setName('memo').setDescription('Reason for this award or correction').setMaxLength(1000))
        .addBooleanOption(option => option.setName('public').setDescription('Show this award to everyone in this channel?')),
    autocomplete: moderatorFactionAutocomplete,
    async execute(service, interaction) {
        if (!isFactionModerator(service, interaction)) {
            await interaction.editReply('Only moderators and the server owner can award renown or rank requirements.');
            return;
        }
        try {
            const user = interaction.options.getUser('player');
            const index = interaction.options.getInteger('character');
            const character = await service.getCharacter(`${user.id}-${index}`);
            if (!character) { await interaction.editReply('That character does not exist.'); return; }
            const faction = await service.factions.find(interaction.options.getString('faction'));
            if (!faction) { await interaction.editReply('That faction is not registered in this server.'); return; }
            const changes = {
                renown: interaction.options.getInteger('renown') ?? 0,
                quests: interaction.options.getInteger('quests') ?? 0,
                solo_challenges: interaction.options.getInteger('solo_challenges') ?? 0,
            };
            const result = await service.factions.award(character.character_id, faction.faction_id, changes);
            const currentCharacter = await service.getCharacter(character.character_id);
            if (!currentCharacter) { await interaction.editReply('The character was retired while the award was being processed.'); return; }
            const before = getFactionStanding(service.levels, currentCharacter, result.before, service.config);
            const after = getFactionStanding(service.levels, currentCharacter, result.after, service.config);
            const embed = buildRenownEmbed(service, currentCharacter, { ...faction, ...result.after })
                .addFields({ name: 'Awarded By', value: `${interaction.user}`, inline: true },
                    { name: 'Changes', value: `Renown: ${result.before.renown} → ${result.after.renown}\nQuests: ${result.before.quests} → ${result.after.quests}\nSolo challenges: ${result.before.solo_challenges} → ${result.after.solo_challenges}` });
            if (before.rank !== after.rank) { embed.addFields({ name: 'Rank Changed', value: `${before.rank} → ${after.rank}` }); }
            const memo = interaction.options.getString('memo');
            if (memo) { embed.addFields({ name: 'Reason', value: memo }); }
            await interaction.editReply({ content: 'Faction renown and requirements saved.', embeds: [embed], allowedMentions: { parse: [] } });
        } catch (error) { await interaction.editReply(error.message); }
    },
};
