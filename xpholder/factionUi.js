const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { XPHOLDER_COLOUR } = require('./config.json');
const { FACTION_RANKS, NEGATIVE_FACTION_RANKS, getFactionStanding } = require('./factionRanks');

function isFactionModerator(service, interaction) {
    const roles = interaction.member?._roles ?? (Array.isArray(interaction.member?.roles) ? interaction.member.roles : []);
    return interaction.user.id === interaction.guild.ownerId || roles.includes(service.config?.moderationRoleId);
}

function factionViewer(service, interaction) {
    return { playerId: interaction.user.id, moderator: isFactionModerator(service, interaction) };
}

async function factionAutocomplete(service, interaction) {
    const query = interaction.options.getFocused().trim().normalize('NFKC').toLowerCase();
    const factions = await service.factions.list(null, factionViewer(service, interaction));
    await interaction.respond(factions.filter(faction => faction.name_key.includes(query)).slice(0, 25)
        .map(faction => ({ name: faction.name, value: `faction:${faction.faction_id}` })));
}

async function moderatorFactionAutocomplete(service, interaction) {
    if (!isFactionModerator(service, interaction)) { await interaction.respond([]); return; }
    await factionAutocomplete(service, interaction);
}

function factionOption(option) {
    return option.setName('faction').setDescription('Choose a registered faction or enter its exact name').setAutocomplete(true);
}

function buildFactionEmbed(faction, fields = []) {
    const embed = new EmbedBuilder().setTitle(faction.name).setDescription(faction.description)
        .setColor(XPHOLDER_COLOUR);
    if (faction.image_url) { embed.setImage(faction.image_url); }
    for (const section of faction.info_sections || []) { embed.addFields({ name: section.title, value: section.text }); }
    embed.addFields(fields);
    if (faction.primary_dm_id) { embed.addFields({ name: 'Primary DM', value: `<@${faction.primary_dm_id}>` }); }
    return embed;
}

function renownProgressBar(renown) {
    if (renown < 0) {
        const cells = 6;
        const limit = Math.abs(NEGATIVE_FACTION_RANKS.at(-1).renown);
        const filled = Math.max(1, Math.floor(Math.min(1, Math.abs(renown) / limit) * cells));
        return '⬛'.repeat(cells - filled) + '🟥'.repeat(filled);
    }
    const cellsPerSegment = 3;
    const thresholds = FACTION_RANKS.slice(1).map(rank => rank.renown);
    const segments = thresholds.map((threshold, index) => {
        const start = thresholds[index - 1] ?? 0;
        const progress = Math.max(0, Math.min(1, (renown - start) / (threshold - start)));
        // Even a small positive amount is visible; only a completed
        // threshold fills the entire segment.
        const filled = progress > 0 ? Math.max(1, Math.floor(progress * cellsPerSegment)) : 0;
        return '🟩'.repeat(filled) + '⬛'.repeat(cellsPerSegment - filled);
    });
    return segments.join(' - ');
}

function renownProgressText(renown) {
    if (renown < 0) { return renownProgressBar(renown); }
    const legend = FACTION_RANKS.slice(1).map(rank => `${rank.name} ${rank.renown}`).join(' • ');
    return `${renownProgressBar(renown)}\n${legend}`;
}

function buildRenownEmbed(service, character, faction) {
    const standing = getFactionStanding(service.levels, character, faction, service.config);
    return buildFactionEmbed(faction, [
        { name: 'Character', value: character.name, inline: true },
        { name: 'Renown', value: String(standing.renown), inline: true },
        { name: 'Rank', value: standing.rank, inline: true },
        { name: 'Renown Progress', value: renownProgressText(standing.renown) },
        { name: 'Character Tier', value: `Tier ${standing.tier} (level ${standing.level})`, inline: true },
        { name: 'Faction Quests', value: String(standing.quests), inline: true },
        { name: 'Solo Challenges', value: String(standing.soloChallenges), inline: true },
        { name: standing.nextRank ? `Next Rank: ${standing.nextRank.name}` : 'Highest Rank',
            value: standing.nextRank ? standing.missing.map(item => `• ${item}`).join('\n') : 'All Champion requirements are met.' }
    ]);
}

function renownComponents(factions, index) {
    const pageStart = Math.floor(index / 25) * 25;
    const select = new StringSelectMenuBuilder().setCustomId('renown_select').setPlaceholder('Select a faction')
        .addOptions(factions.slice(pageStart, pageStart + 25).map((faction, offset) => ({
            label: faction.name, value: String(faction.faction_id), default: pageStart + offset === index,
        })));
    const buttons = [
        new ButtonBuilder().setCustomId('renown_previous').setLabel('Previous faction').setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
        new ButtonBuilder().setCustomId('renown_next').setLabel('Next faction').setStyle(ButtonStyle.Secondary).setDisabled(index === factions.length - 1),
    ];
    if (factions.length > 25) {
        buttons.push(
            new ButtonBuilder().setCustomId('renown_previous_page').setLabel('Previous 25').setStyle(ButtonStyle.Secondary).setDisabled(pageStart === 0),
            new ButtonBuilder().setCustomId('renown_next_page').setLabel('Next 25').setStyle(ButtonStyle.Secondary).setDisabled(pageStart + 25 >= factions.length),
        );
    }
    return [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(buttons)];
}

module.exports = { isFactionModerator, factionViewer, factionAutocomplete, moderatorFactionAutocomplete,
    factionOption, buildFactionEmbed, buildRenownEmbed, renownComponents, renownProgressBar };
