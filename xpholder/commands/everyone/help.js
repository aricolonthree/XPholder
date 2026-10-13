const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder } = require('discord.js');

const { XPHOLDER_COLOUR, XPHOLDER_ICON_URL, DEV_SERVER_URL } = require("../../config.json");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Replies With Some Help!')

        .addStringOption(option => option
            .setName("help_topic")
            .setDescription("The Topic You Need Help On")
            .addChoices(
                { name: "Getting Started", value: "getting_started" },
                { name: "XP Per Post", value: "xp_per_post" },

            )
            .setRequired(true))

        .addBooleanOption(option => option
            .setName("public")
            .setDescription("Show This Command To Everyone?")
            .setRequired(false))
    ,
    async execute(guildService, interaction) {

        const helpTopic = interaction.options.getString("help_topic")
        const helpEmbed = [
            buildGettingStartedEmbed(),
            buildXpPerPostEmbed()
        ];

        let embedIndex = 0;
        switch (helpTopic) {
            case "getting_started":
                embedIndex = 0;
                break;
            case "xp_per_post":
                embedIndex = 1;
                break;
        }

        const helpButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('help_previous')
                    .setLabel('<')
                    .setStyle('Secondary'),
                new ButtonBuilder()
                    .setCustomId('help_next')
                    .setLabel('>')
                    .setStyle('Secondary')
            );

        const replyMessage = await interaction.editReply({ embeds: [helpEmbed[embedIndex]], components: [helpButtons] });
        createButtonEvents(interaction, replyMessage, helpEmbed, embedIndex)
    },
};

function buildGettingStartedEmbed() {
    return new EmbedBuilder()
        .setTitle("Getting Started")
        .setDescription("Welcome to XPholder! XPholder is a service that allows for people to manage character xp and level progression over discord. The bot allows for support up to 10 characters, and can read messages in both channel and threads. Our mission is to provide servers with a service that can work along other role playing bots as a manager and tracker of xp.")
        .addFields(
            { name: "Just Registered, Now What?", value: "A staff member with Moderate Members, Manage Server, or Administrator permission can set up the server with **/register** and choose the role for moderator commands. You can check your server's settings with **/view_game_rules**. To find editing commands, type **/edit_** and select an option; each command checks its required permissions.", inline: false },
            { name: "How To Award XP Per Post", value: "The **/edit_channels** command will attach an xp reward for players posting in the channel. Please populate the `channel` option with a channel that you would like players to role play in, as well as the `xp_per_post` with the number of xp the player should be rewarded for posting", inline: false },
            {
                name: "Players Not Receiving XP?", value: `If you set up a channel to reward xp, and you are seeing that players are not getting xp. There are 3 simple checks you can do to resolve this :

1. Did you set the channel / the right channel?
• Sometimes we forget what we have, and haven't done with large role playing servers. Please double check that the channel is rewarding xp, with the command **/view_game_rules** and selecting the \`channel\` option
            
2. Does the player have an approved character?
• Enter the command **/xp** and select the more options tab. From there, select the \`player\` option, and tag the person not getting XP. If they do not have a character approved, a mod can approve their character with **/approve_player**
            
3. Does the player have the appropriate roles?
• The easiest way to resolve this, is to ask the player todo the **/xp** command, and hit the bright green block \`set\` for the character they want to gain xp on`, inline: false
            },
            { name: "How To Award XP Manually", value: "There are two ways to award xp manually. The first, is a mod of the server can use **/award_xp** , and fill out the information on the player they are awarding. The second, is that players can use **/request_xp** and await for a mod to approve their request ( there is a server option to auto approve all requests in **/edit_config** )", inline: false },
        )
        .addFields({ name: "Level-Up Requirements", value: "By default, entering levels 5, 11, and 17 requires a moderator award. XP keeps accumulating while blocked. Moderators use **/award_level_up** with the player, character, and level being unlocked. Moderators can turn requirements off or require them at every level with **/edit_config**. View your status with **/xp**." })
        .addFields({ name: "Factions and Renown", value: "Use **/factions** for faction details and **/renown** for your active character's relations. Factions start hidden from players. Moderators can reveal one with **/faction_visibility** or set **fully_public** with **/register_faction** or **/edit_faction**. A renown award permanently reveals the faction to that player across all their characters. Replies are private by default; use **public:true** on **/renown**, **/factions**, or **/award_renown** to share them in the channel. Set **primary_dm** with registration/editing; use **/faction_info add**, **edit**, or **remove** for extra sections, and **/delete_faction** to delete a faction. **/award_renown** changes renown and quest/solo completions. Positive ranks also require the character's tier. Distrusted is -1 to -14; Nemesis is -15 or below." })
        .addFields({ name: "Homebrew Review", value: "New posts in **homebrew-submission** receive thumbs-up/down reactions and the **being polled** tag. Only Homebrew Team votes from people other than the poster count; uncounted votes are removed during checks, keeping the bot's reactions. A lead of 6 decides early; a lead of 3 decides at a daily check. Without consensus, the team gets a daily reminder; after 7 days, the post times out and closes. Moderators can reopen it. Staff and the Homebrew Team can use **/verify_homebrew** in a post, or supply its link with **post**. Use **skip_wait:true** to apply the 3-vote threshold immediately. Removing **being polled** or setting a verdict tag stops automatic voting." })
        .setFooter({ text: `Like the bot? Have questions? Click 'Getting Started' to visit the dev server!` })
        .setThumbnail(XPHOLDER_ICON_URL)
        .setColor(XPHOLDER_COLOUR)
        .setURL(DEV_SERVER_URL || null);
}

function buildXpPerPostEmbed() {
    return new EmbedBuilder()
        .setTitle("XP Per Post")
        .setDescription("If you can not find the answer that you were looking for on this page, please also checkout the `Getting Started` tab.")
        .addFields(
            {
                name: "Players Not Receiving XP?", value: `If you set up a channel to reward xp, and you are seeing that players are not getting xp. There are 3 simple checks you can do to resolve this :

1. Did you set the channel / the right channel?
• Sometimes we forget what we have, and haven't done with large role playing servers. Please double check that the channel is rewarding xp, with the command **/view_game_rules** and selecting the \`channel\` option
            
2. Does the player have an approved character?
• Enter the command **/xp** and select the more options tab. From there, select the \`player\` option, and tag the person not getting XP. If they do not have a character approved, a mod can approve their character with **/approve_player**
            
3. Does the player have the appropriate roles?
• The easiest way to resolve this, is to ask the player todo the **/xp** command, and hit the bright green block \`set\` for the character they want to gain xp on`, inline: false
            },
            {
                name: "How Much XP To Award?", value: `There are 3 formulas which XPholder uses to calculate XP. Each server is different, so we can not provide for you the exact numbers that you may be looking for; however, if you use the command **/calculate_xp** you can find the right weights and balances for you! Once you found out how much xp you would like to reward per post, please update with : 

**/edit_config** : if you are updating a \`xp_per_post_formula\`  or \`xp_per_post_divisor\` 

**/edit_channels** : if you are updating a \`channel_xp_per_post\`

**/edit_roles** : if you are updating a \`role_boost\``, inline: true
            },
        )
        .setFooter({ text: `Like the bot? Have questions? Click 'XP Per Post' to visit the dev server!` })
        .setThumbnail(XPHOLDER_ICON_URL)
        .setColor(XPHOLDER_COLOUR)
        .setURL(DEV_SERVER_URL || null);
}

function createButtonEvents(interaction, replyMessage, helpEmbed, embedIndex) {
    /*
    -------------
    INITALIZATION
    -------------
    */

    let pageIndex = embedIndex;
    let retire = false

    /*
    ------------------
    CREATING COLLECTOR
    ------------------
    */
    const filter = btnInteraction => (
        ['help_previous', 'help_next'].includes(btnInteraction.customId) &&
        replyMessage.id == btnInteraction.message.id
    );
    const collectorChannel = interaction.channel;
    if (!collectorChannel) { return; }
    const collector = collectorChannel.createMessageComponentCollector({ filter, time: 60_000 });


    collector.on('collect', async btnInteraction => {
        try {
            switch (btnInteraction.customId) {
                case "help_previous":
                    retire = false;
                    pageIndex = (pageIndex - 1) < 0 ? 0 : (pageIndex - 1);
                    await btnInteraction.update({ embeds: [helpEmbed[pageIndex]] });
                    break;
                case "help_next":
                    retire = false;
                    pageIndex = (pageIndex + 1) > helpEmbed.length ? (helpEmbed.length - 1) : (pageIndex + 1);
                    await btnInteraction.update({ embeds: [helpEmbed[pageIndex]] });
                    break;
            }
        } catch (error) { console.log(error); }
    });
}
