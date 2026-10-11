const { SlashCommandBuilder } = require('@discordjs/builders');
const { buildCharacterEmbed, getCharacterLevelInfo, syncCharacterTierRole } = require('../../utils');
const { hasLevelUpRequirement } = require('../../progression');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('award_level_up')
        .setDescription('Mark a character\'s requirement for entering a level as met [ MOD ]')
        .addUserOption(option => option.setName('player').setDescription('The player receiving the award').setRequired(true))
        .addIntegerOption(option => option.setName('character').setDescription('Character receiving the award')
            .setMinValue(1).setMaxValue(10).setRequired(true))
        .addIntegerOption(option => option.setName('level').setDescription('The level to unlock (tier boundaries: 5, 11, 17)')
            .setMinValue(2).setMaxValue(20).setRequired(true))
        .addStringOption(option => option.setName('memo').setDescription('Which requirement the character fulfilled').setMaxLength(1000))
        .addBooleanOption(option => option.setName('public').setDescription('Show this command to everyone?')),

    async execute(guildService, interaction) {
        if (!guildService.isMod(interaction.member._roles) && interaction.user.id !== interaction.guild.ownerId) {
            await interaction.editReply('Sorry, you do not have the right role to use this command.');
            return;
        }
        const user = interaction.options.getUser('player');
        const index = interaction.options.getInteger('character');
        const level = interaction.options.getInteger('level');
        const character = await guildService.getCharacter(`${user.id}-${index}`);
        if (!character) {
            await interaction.editReply('Sorry, but that character does not exist.');
            return;
        }
        if (hasLevelUpRequirement(character, level)) {
            await interaction.editReply(`The requirement for level ${level} is already met for ${character.name}.`);
            return;
        }

        const player = await interaction.guild.members.fetch(user.id);
        const oldLevel = getCharacterLevelInfo(guildService.levels, character, guildService.config).level;
        const updated = await guildService.awardLevelUpRequirement(character, level);
        if (!updated) {
            await interaction.editReply('That character no longer exists.');
            return;
        }
        const newLevel = getCharacterLevelInfo(guildService.levels, updated, guildService.config).level;
        const embed = buildCharacterEmbed(guildService, player, updated)
            .setTitle(`${updated.name}: Level ${level} Requirement Met`)
            .addFields({ name: 'Awarded By', value: `${interaction.user}`, inline: true });
        const memo = interaction.options.getString('memo');
        if (memo) { embed.setDescription(memo); }
        if (oldLevel !== newLevel) {
            embed.addFields({ name: 'Level Up!', value: `${oldLevel} → **${newLevel}**`, inline: true });
        }

        // The award remains saved if Discord role or channel permissions need fixing.
        const notices = [];
        try {
            await syncCharacterTierRole(guildService, player, updated);
        } catch (error) {
            notices.push('The award was saved, but I could not update the tier role. Check my role permissions and use /xp → Set.');
        }
        try {
            const channel = await interaction.guild.channels.fetch(guildService.config.levelUpChannelId);
            await channel.send({ content: `${player}`, embeds: [embed] });
        } catch (error) {
            notices.push('The award was saved, but I could not post in the level-up channel.');
        }
        await interaction.editReply({ content: notices.join('\n') || 'Requirement awarded!', embeds: [embed] });
    },
};
