const REQUIREMENT_DEFAULTS = {
    levelUpRequirementsEnabled: "on",
    levelUpRequirementMode: "tiers",
};
const TIER_ENTRY_LEVELS = [5, 11, 17];
const MAX_REQUIREMENTS = (2 ** 19) - 1;

// Bits 0..18 represent the requirements for entering levels 2..20.
function requirementBit(level) {
    if (!Number.isInteger(level) || level < 2 || level > 20) {
        throw new RangeError("Requirement level must be between 2 and 20.");
    }
    return 2 ** (level - 2);
}

function requirementMask(value = 0) {
    const mask = Number(value);
    if (!Number.isInteger(mask) || mask < 0 || mask > MAX_REQUIREMENTS) {
        throw new RangeError("Invalid level-up requirements.");
    }
    return mask;
}

function hasLevelUpRequirement(character, level) {
    return (requirementMask(character.level_up_requirements_met) & requirementBit(level)) !== 0;
}

function requirementsThroughLevel(level) {
    return (2 ** (Number(level) - 1)) - 1;
}

function requiresLevelUpRequirement(level, config = {}) {
    if (config.levelUpRequirementsEnabled === "off") { return false; }
    return config.levelUpRequirementMode === "all" || TIER_ENTRY_LEVELS.includes(level);
}

function getLevelInfo(levels, xp) {
    for (const [level, xpToNext] of Object.entries(levels)) {
        if (xp < Number(xpToNext)) {
            return { level, levelXp: xp, xpToNext: Number(xpToNext) };
        }
        xp -= Number(xpToNext);
    }
    return { level: "20", levelXp: xp, xpToNext: xp };
}

function getCharacterLevelInfo(levels, character, config = {}) {
    let levelXp = Number(character.xp);
    for (const [level, value] of Object.entries(levels)) {
        const xpToNext = Number(value);
        const nextLevel = Number(level) + 1;
        const blocked = nextLevel <= 20 && levelXp >= xpToNext &&
            requiresLevelUpRequirement(nextLevel, config) &&
            !hasLevelUpRequirement(character, nextLevel);
        if (levelXp < xpToNext || blocked) {
            return { level, levelXp, xpToNext, blockedAtLevel: blocked ? nextLevel : null };
        }
        levelXp -= xpToNext;
    }
    return { level: "20", levelXp, xpToNext: levelXp, blockedAtLevel: null };
}

function getRequirementStatus(levels, character, config = {}) {
    if (config.levelUpRequirementsEnabled === "off") { return "Off"; }
    const info = getCharacterLevelInfo(levels, character, config);
    if (info.blockedAtLevel) {
        return `Waiting for the level ${info.blockedAtLevel} requirement.`;
    }
    for (let level = Number(info.level) + 1; level <= 20; level++) {
        if (requiresLevelUpRequirement(level, config)) {
            return `Level ${level} requirement: ${hasLevelUpRequirement(character, level) ? "met" : "not yet met"}.`;
        }
    }
    return "No further level-up requirements.";
}

function awardCXPs(startingXp, cxp, levels, character = {}, config = {}) {
    for (; cxp > 0; cxp--) {
        const info = getCharacterLevelInfo(levels, { ...character, xp: startingXp }, config);
        startingXp += info.xpToNext / (Number(info.level) < 4 ? 4 : 8);
    }
    return startingXp;
}

module.exports = {
    REQUIREMENT_DEFAULTS, requirementBit, requirementMask, requirementsThroughLevel,
    hasLevelUpRequirement, requiresLevelUpRequirement, getLevelInfo,
    getCharacterLevelInfo, getRequirementStatus, awardCXPs,
};
