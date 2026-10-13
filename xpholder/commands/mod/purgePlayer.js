const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('purge_player')
        .setDescription('*WARNING* Deletes all data on a player [ MOD ]')
        .addUserOption(option => option
            .setName("player")
            .setDescription("The Player Is Getting Purged")
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
            await interaction.editReply("Only moderators and the server owner can use this command.");
            return;
        }
        /*
        --------------
        INITALIZATIONS
        --------------
        */
        const player = interaction.options.getUser("player");
        const playerCharacters = await guildService.getAllCharacters(player.id);
        for (let character of playerCharacters){
            await guildService.deleteCharacter(character);
        }

        await interaction.editReply('Success!');
    },
};
