const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('register')
        .setDescription('Registers The Server! [ MOD ]')

        .addRoleOption(option => option
            .setName("moderation_role")
            .setDescription("The Role Allowed To Use Moderator Commands")
            .setRequired(true))
        .addIntegerOption(option => option
            .setName("number_of_characters")
            .setDescription("The Amount Of Characters A Person Can Have ( 1 -> 10 )")
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(true))

        .addBooleanOption(option => option
            .setName("public")
            .setDescription("Show This Command To Everyone?")
            .setRequired(false))
    ,
    async execute(guildService, interaction) {
        /*
        ----------
        VALIDATION
        ----------
        */
        // The configured moderator role does not exist until this first setup.
        const permissions = interaction.memberPermissions;
        const canRegister = interaction.user.id === interaction.guild.ownerId ||
            permissions?.has(PermissionFlagsBits.ManageGuild) ||
            permissions?.has(PermissionFlagsBits.ModerateMembers);
        if (!canRegister) {
            await interaction.editReply("You need Moderate Members, Manage Server, or Administrator permission to register the server.");
            return;
        }
        if (await guildService.isRegistered()) {
            await interaction.editReply("This server is already registered. Use the editing commands to update its settings.");
            return;
        }
        /*
        --------------
        INITALIZATIONS
        --------------
        */
        const MAX_CHARS = 10;
        const ROLES = interaction.guild.roles;

        const characterCount = interaction.options.getInteger("number_of_characters");
        const moderationRole = interaction.options.getRole("moderation_role");

        let config = {
            "levelUpMessage": "Congrats on leveling up!",
            "levelUpRequirementsEnabled": "on",
            "levelUpRequirementMode": "tiers",
            "levelUpChannelId": interaction.channelId,
            "moderationRoleId": moderationRole.id,
            "approveLevel": 1,
            "approveMessage": "Congratulations your character is approved!",
            "roleBonus": "highest", // sum
            "xpPerPostFormula": "exponential", // flat , linear
            "xpPerPostDivisor": 100,
            "allowPlayerManageXp": "off",
            "characterCount": characterCount
        };
        /*
        -----------------------
        GENERATING SERVER ROLES
        -----------------------
        */
        config["tier4RoleId"] = (await ROLES.create({ name: "Tier 4", color: [120, 81, 169], hoist: true, mentionable: true })).id;
        config["tier3RoleId"] = (await ROLES.create({ name: "Tier 3", color: [255, 215, 0], hoist: true, mentionable: true })).id;
        config["tier2RoleId"] = (await ROLES.create({ name: "Tier 2", color: [192, 192, 192], hoist: true, mentionable: true })).id;
        config["tier1RoleId"] = (await ROLES.create({ name: "Tier 1", color: [176, 141, 87], hoist: true, mentionable: true })).id;

        config["xpFreezeRoleId"] = (await ROLES.create({ name: "❄️XP Freeze ❄️", color: [223, 247, 250], hoist: true, mentionable: true })).id;

        config["xpShareRoleId"] = (await ROLES.create({ name: "🎁XP Share 🎁", color: [18, 222, 38], hoist: true, mentionable: true })).id;

        for (let index = 1; index <= MAX_CHARS; index++) {
            if (index <= characterCount) {
                config[`character${index}RoleId`] = (await ROLES.create({ name: `Character ${index}` })).id;
            } else { config[`character${index}RoleId`] = 0; }
        }
        /*
        ------------------
        REGISTERING SERVER
        ------------------
        config - schema :
            "levelUpMessage"    :   STRING
            "levelUpChannelId"  :   NUMBER
            "moderationRoleId"  :   NUMBER
            "approveLevel"      :   NUMBER
            "approveMessage"    :   STRING
            "roleBonus"         :   STRING
            "xpPerPostFormula"  :   STRING
            "xpPerPostDivisor"  :   NUMBER
            "allowPlayerManageXp":   STRING
            "tier4RoleId"       :   NUMBER
            "tier3RoleId"       :   NUMBER
            "tier2RoleId"       :   NUMBER
            "tier1RoleId"       :   NUMBER
            "xpFreezeRoleId"    :   NUMBER
            "xpShareRoleId"     :   NUMBER
            "character1RoleId"  :   NUMBER
            "character2RoleId"  :   NUMBER
            "character3RoleId"  :   NUMBER
            "character4RoleId"  :   NUMBER
            "character5RoleId"  :   NUMBER
            "characterCount"    :   NUMBER
        */
        await guildService.registerServer(config);
        await guildService.init();

        await interaction.editReply('Success!');
    },
};
