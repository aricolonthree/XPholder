const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits } = require('discord.js');
const { HOMEBREW_VOTING } = require('../../config.json');

function postId(value, interaction) {
    if (!value) return interaction.channelId;
    if (/^\d{17,20}$/.test(value)) return value;
    const match = /^https:\/\/(?:www\.)?discord\.com\/channels\/(\d+)\/(\d+)(?:\/\d+)?\/?$/.exec(value);
    if (match && match[1] === interaction.guildId) return match[2];
    throw new Error('Provide a homebrew forum post link or thread ID.');
}

module.exports = {
    private: true,
    data: new SlashCommandBuilder().setName('verify_homebrew').setDescription('Check a homebrew submission vote now [ MOD / HOMEBREW TEAM ]')
        .addStringOption(option => option.setName('post').setDescription('Forum post link or thread ID; defaults to the current post'))
        .addBooleanOption(option => option.setName('skip_wait').setDescription('Use the 24-hour vote threshold now (3-vote lead)')),
    async execute(service, interaction) {
        const roles = interaction.member?._roles ?? (Array.isArray(interaction.member?.roles) ? interaction.member.roles : []);
        const allowed = roles.includes(HOMEBREW_VOTING.teamRole) || service.isMod(roles) ||
            interaction.user.id === interaction.guild.ownerId || interaction.memberPermissions?.has(PermissionFlagsBits.ManageThreads);
        if (!allowed) { await interaction.editReply('Only moderators and the Homebrew Team can verify submissions.'); return; }
        try {
            const poll = await interaction.client.homebrewVoting.verify(postId(interaction.options.getString('post'), interaction),
                { skipWait: interaction.options.getBoolean('skip_wait') ?? false });
            const tally = poll.votes ? `👍 ${poll.votes.up} · 👎 ${poll.votes.down}\n` : '';
            const status = { approved: 'Approved by vote.', denied: 'Denied by vote.', timed_out: 'Timed out.',
                manual: 'A verdict was set manually. Automatic voting has stopped.', cancelled: 'Automatic voting has stopped.' }[poll.state] ||
                `No decision. Next daily check: <t:${Math.floor(poll.nextCheckAt / 1000)}:R>.`;
            await interaction.editReply({ content: tally + status, allowedMentions: { parse: [] } });
        } catch (error) { await interaction.editReply(error.message); }
    },
};
