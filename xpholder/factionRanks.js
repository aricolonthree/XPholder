const { getCharacterLevelInfo } = require('./progression');
const { getTier } = require('./utils');

const FACTION_RANKS = [
    { name: 'Unknown', renown: 0, quests: 0, soloChallenges: 0, tier: 0 },
    { name: 'Associate', renown: 10, quests: 0, soloChallenges: 0, tier: 1 },
    { name: 'Member', renown: 30, quests: 1, soloChallenges: 0, tier: 2 },
    { name: 'Veteran', renown: 65, quests: 2, soloChallenges: 0, tier: 3 },
    { name: 'Champion', renown: 120, quests: 2, soloChallenges: 1, tier: 4 },
];

const NEGATIVE_FACTION_RANKS = [
    { name: 'Distrusted', renown: -1 },
    { name: 'Nemesis', renown: -15 },
];

function getFactionStanding(levels, character, relation = {}, config = {}) {
    const renown = relation.renown ?? 0;
    const quests = relation.quests ?? 0;
    const soloChallenges = relation.solo_challenges ?? 0;
    const level = Number(getCharacterLevelInfo(levels, character, config).level);
    const tier = getTier(level).tier;
    if (renown <= NEGATIVE_FACTION_RANKS[0].renown) {
        const rankIndex = NEGATIVE_FACTION_RANKS.findLastIndex(rank => renown <= rank.renown);
        const rank = NEGATIVE_FACTION_RANKS[rankIndex];
        // Negative thresholds are inclusive: recovering from Nemesis starts at -14.
        const nextRank = rankIndex === 0 ? FACTION_RANKS[0] : {
            ...NEGATIVE_FACTION_RANKS[rankIndex - 1], renown: rank.renown + 1,
        };
        return {
            rank: rank.name, renown, quests, soloChallenges, level, tier, nextRank,
            missing: [`${nextRank.renown - renown} more renown (${nextRank.renown} total)`],
        };
    }
    let rankIndex = 0;
    for (let index = 1; index < FACTION_RANKS.length; index++) {
        const rank = FACTION_RANKS[index];
        if (renown < rank.renown || quests < rank.quests || soloChallenges < rank.soloChallenges || tier < rank.tier) { break; }
        rankIndex = index;
    }
    const nextRank = FACTION_RANKS[rankIndex + 1] ?? null;
    const missing = [];
    if (nextRank) {
        if (renown < nextRank.renown) { missing.push(`${nextRank.renown - renown} more renown (${nextRank.renown} total)`); }
        if (quests < nextRank.quests) { missing.push(`${nextRank.quests - quests} more faction quest(s) (${nextRank.quests} total)`); }
        if (soloChallenges < nextRank.soloChallenges) { missing.push(`${nextRank.soloChallenges - soloChallenges} more solo challenge(s) (${nextRank.soloChallenges} total)`); }
        if (tier < nextRank.tier) { missing.push(`Tier ${nextRank.tier} (currently Tier ${tier})`); }
    }
    return {
        rank: FACTION_RANKS[rankIndex].name,
        renown, quests, soloChallenges, level, tier, nextRank, missing,
    };
}

module.exports = { FACTION_RANKS, NEGATIVE_FACTION_RANKS, getFactionStanding };
