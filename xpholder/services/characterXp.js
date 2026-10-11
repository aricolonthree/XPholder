const { EmbedBuilder } = require('discord.js');
const { XPHOLDER_COLOUR, XPHOLDER_ICON_URL } = require('../config.json');
const { getCharacterLevelInfo, getTier, syncCharacterTierRole } = require('../utils');

async function updateCharacterXpAndMessage(guild, gService, character, xp, player){
    try{
        if (!await gService.updateCharacterXP(character, xp)) { throw new Error("Could not save character XP."); }

        const oldLevelInfo = getCharacterLevelInfo(gService.levels, character, gService.config);
        const updatedCharacter = await gService.getCharacter(character.character_id);
        const newLevelInfo = getCharacterLevelInfo(gService.levels, updatedCharacter, gService.config);
        try {
            await syncCharacterTierRole(gService, player, updatedCharacter);
        } catch (error) { console.log(error); }

        if (oldLevelInfo["level"] != newLevelInfo["level"]) {
            const newTier = getTier(newLevelInfo["level"]);

            let awardChannel;
            try {
                awardChannel = await guild.channels.fetch(gService.config["levelUpChannelId"]);
            } catch (error) { return; }

            let levelUpEmbed = new EmbedBuilder()
                .setTitle(`${character["name"]} Leveled Up`)
                .setFields(
                    { name: "Level Up!", value: `${oldLevelInfo["level"]} --> **${newLevelInfo["level"]}**`, inline: true },
                    { name: "Total Character XP", value: `${Math.floor(updatedCharacter.xp)}`, inline: true },
                    { name: "Tier", value: `<@&${gService.config[`tier${newTier["tier"]}RoleId`]}>`, inline: true }
                )
                .setThumbnail((character["picture_url"] != "" && character["picture_url"] !== "null")? character["picture_url"] : XPHOLDER_ICON_URL )
                .setColor(XPHOLDER_COLOUR)
                .setFooter({ text: "You can view your characters with /xp" })

            if (character["sheet_url"] != "") {
                levelUpEmbed.setURL(character["sheet_url"]);
            }

            await awardChannel.send({ content: `${player}`, embeds: [levelUpEmbed] });
        }
    }catch(error){ console.log(error) }
}

module.exports = { updateCharacterXpAndMessage };
