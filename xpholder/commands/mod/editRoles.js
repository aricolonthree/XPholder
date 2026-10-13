const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('edit_roles')
        .setDescription('Adds / Removes Roles From Server Database! [ MOD ]')

        .addRoleOption(option => option
            .setName("role")
            .setDescription("A Role To Be Added / Removed")
            .setRequired(true))
        .addNumberOption(option => option
            .setName("bonus")
            .setDescription("XP multiplier, e.g. 1.5; 0 freezes XP, negative values remove the role bonus")
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
        if (!guildService.isMod(interaction.member._roles) &&
            interaction.user.id != interaction.guild.ownerId) {
            await interaction.editReply("Sorry, you do not have the right role to use this command.");
            return;
        }

        /*
        --------------
        INITALIZATIONS
        --------------
        */
        const role = interaction.options.getRole("role")
        const bonus = interaction.options.getNumber("bonus")

        await guildService.updateRole(role.id, bonus);

        await interaction.editReply("Success!");
    }
}
