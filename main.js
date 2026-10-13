const dotenv = require('dotenv');
const fs = require('fs');

const { Client, Collection, GatewayIntentBits, Partials, EmbedBuilder, InteractionType, ChannelType, Events, MessageFlags } = require('discord.js');
const sqlite3 = require("sqlite3");

const { guildService } = require("./xpholder/services/guild");
const { sqlLite3DatabaseService } = require("./xpholder/database/sqlite");

const { getActiveCharacterIndex, getXp, getRoleMultiplier, logCommand, logError } = require("./xpholder/utils");
const { updateCharacterXpAndMessage } = require("./xpholder/services/characterXp");
const { HomebrewVoting } = require('./xpholder/services/homebrewVoting');

/*
-----------------------
LOADING ENV VARS (.env)
-----------------------
*/
dotenv.config();
fs.mkdirSync('./guilds', { recursive: true });
const testGuildId = process.env.TEST_GUILD_ID;
/*
---------------------------
LOADING DISCORD PREMISSIONS
---------------------------
*/
const date = new Date().toISOString();
const timestamp = Date.now();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel]
});
client.commands = new Collection();
client.homebrewVoting = new HomebrewVoting(client, { testGuildId });
client.on(Events.ThreadCreate, (thread, newlyCreated) => {
    client.homebrewVoting.onThreadCreate(thread, newlyCreated).catch(error => client.homebrewVoting.report(error, thread.id));
});
client.on(Events.ThreadUpdate, (oldThread, thread) => {
    client.homebrewVoting.onThreadUpdate(oldThread, thread).catch(error => client.homebrewVoting.report(error, thread.id));
});
/*
----------------
LOADING COMMANDS
----------------
*/
const commandsPath = [
    "everyone",
    "mod",
];
for (const path of commandsPath) {
    const commandCollection = fs.readdirSync(`./xpholder/commands/${path}`).filter(file => file.endsWith('.js'));
    for (const file of commandCollection) {
        const command = require(`./xpholder/commands/${path}/${file}`);
        client.commands.set(command.data.name, command);
    }
}

/*
------------
BOT COMMANDS
------------
*/
client.once(Events.ClientReady, () => {
    //clearGuildCache();
    console.log(`Ready: ${client.user.tag}; ${client.commands.size} commands loaded.`);
    if (testGuildId) { console.log(`Testing restricted to guild ${testGuildId}.`); }
    client.homebrewVoting.start().catch(error => client.homebrewVoting.report(error, 'startup'));
});

client.on('interactionCreate', async interaction => {
    if (testGuildId && interaction.guildId !== testGuildId) { return; }
    /*
    -------------------------------------
    VALIDATIONS FOR INTERACTION EXECUTION
    -------------------------------------
    */
    if ((!interaction.isCommand() && !interaction.isAutocomplete()) ||
        !interaction.inGuild()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    const guildId = `${interaction.guildId}`;

    // LOADING GUILD SERVICE
    const gService = new guildService(
        await new sqlLite3DatabaseService(sqlite3, `./guilds/${guildId}.db`)
    )
    if (interaction.isAutocomplete()) {
        try {
            // Typing suggestions must not run the XP schema migration on every keypress.
            if (command.autocomplete && await gService.isRegistered()) {
                await gService.factions.init();
                gService.config = await gService.loadInit('config', 'name', 'value');
                await command.autocomplete(gService, interaction);
            } else { await interaction.respond([]); }
        } catch (error) {
            console.log(error);
            if (!interaction.responded) { await interaction.respond([]); }
        }
        return;
    }
    /*
    -----------------
    EXECUTING COMMAND
    -----------------
    */
    try {
        const ephemeral = command.private || !interaction.options.getBoolean("public");
        // Acknowledge before database work, including first-use schema migration.
        await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });
        await gService.init();
        if (!gService.registered && command.data.name !== 'register') {
            await interaction.editReply('This server is not registered. A staff member with Moderate Members, Manage Server, or Administrator permission can run `/register`.');
            return;
        }
        // Faction inputs can identify hidden factions even when the reply is public.
        if (!command.private && command.log !== false) { logCommand(interaction).catch(error => console.error('Command logging failed:', error.message)); }
        await command.execute(gService, interaction);
    } catch (error) {
        try {
            if (!command.private && command.log !== false) { logError(interaction, error).catch(loggingError => console.error('Error logging failed:', loggingError.message)); }
        } catch (error) {
            console.log(error);
        }
        console.log(error);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: 'Could not complete this command. Please try again.', embeds: [], components: [] }).catch(() => {});
        }
    }
});

/*
-----------
XP PER POST
-----------
*/
client.on('messageCreate', async message => {
    try {
        if (testGuildId && message.guildId !== testGuildId) { return; }

        /*
        ----------
        VALIDATION
        ----------
        */
        if (!message.inGuild()) { return; }
        if (message.author.bot) { return; }
        if ((message.content.split(/\s+/).length <= 10) && !message.content.startsWith('!')) { return; }
				// Not too sure if the above is correct, seems like it would allow commands consisting of 10+ words	through

        /*
        --------------------------------
        LOADING GUILD INTO CACHED GUILDS
        --------------------------------
        */
        const guildId = `${message.guildId}`;
        if (!fs.existsSync(`./guilds/${guildId}.db`)){ 
            return; 
        }

        const gService = new guildService(
            await new sqlLite3DatabaseService(sqlite3, `./guilds/${guildId}.db`)
        )
        await gService.init();
        if (!await gService.isRegistered()) { return; }
        /*
        --------------
        INITALIZATIONS
        --------------
        */
        const messageCount = message.content.split(/\s+/).length;
        const guild = await client.guilds.fetch(guildId);
        const player = await guild.members.fetch(message.author.id);

        const roleBonus = getRoleMultiplier(gService.config["roleBonus"], gService.roles, player._roles);

        const characterIndex = getActiveCharacterIndex(gService.config, player._roles);
        const character = await gService.getCharacter(`${player.id}-${characterIndex}`)
        if (!character) { return; }


        let channel = await guild.channels.fetch(message.channelId);

	if (channel.name.includes('ooc')) {return;}
        while (channel) {
            if (channel.id in gService.channels) { break; }
            channel = await guild.channels.fetch(channel.parentId);
        }

        if (!channel) { return; }

        if (gService.channels[channel.id] == 0){ return; }
	console.log("$ Channel " + channel.name + ", Author " +  message.author.displayName + ", id " + message.id + ", Timestamp " + timestamp)


        const xp = getXp(messageCount, roleBonus, gService.channels[channel.id], gService.config["xpPerPostDivisor"], gService.config["xpPerPostFormula"]);

        if (player._roles.includes(gService.config["xpShareRoleId"])){
            const playerCharacters = await gService.getAllCharacters(player.id);
            for (let subCharacter of playerCharacters) {
                await updateCharacterXpAndMessage(guild, gService, subCharacter, xp / playerCharacters.length, player)
            }
        }else{
            await updateCharacterXpAndMessage(guild, gService, character, xp, player)
        }
        

    } catch (error) { console.log(error); }
});

/*
---------------------
LOGING THE BOT ONLINE
---------------------
*/
client.login(process.env.DISCORD_TOKEN);
