const { listOfObjsToObj } = require("../utils")
const { LEVELS } = require("../config.json")
const { REQUIREMENT_DEFAULTS, getLevelInfo, requirementBit, requirementMask, requirementsThroughLevel } = require("../progression");

class guildService {
    constructor(database) {
        this.database = database;

        this.xpCache = {};
        this.registered = false;
        this.last_touched = Date.now();
    }

    /*
    -------------
    INITALIZATION
    -------------
    */
    async init() {
        if (!await this.isRegistered()) { return }
        this.levels = await this.loadInit("levels", "level", "xp_to_next");
        await this.migrateLevelUpRequirements();
        this.config = await this.loadInit("config", "name", "value");
        this.roles = await this.loadInit("roles", "role_id", "xp_bonus");
        this.channels = await this.loadInit("channels", "channel_id", "xp_per_post");
    }

    async loadInit(table, primaryKey, value) {
        await this.database.openDatabase();
        let sqlTable = await this.database.getAll(`SELECT * FROM ${table};`)
        await this.database.closeDatabase();
        return listOfObjsToObj(sqlTable, primaryKey, value);
    }

    async migrateLevelUpRequirements() {
        await this.database.openDatabase();
        const run = async (sql, params) => {
            if (!await this.database.execute(sql, params)) { throw new Error("Level-up requirement migration failed."); }
        };
        try {
            // Serializes first-use migrations from concurrent messages/commands.
            await run("BEGIN IMMEDIATE;");
            const columns = await this.database.getAll("PRAGMA table_info(characters);");
            if (!columns) { throw new Error("Could not read the character schema."); }
            if (!columns.some(column => column.name === "level_up_requirements_met")) {
                await run("ALTER TABLE characters ADD COLUMN level_up_requirements_met INTEGER NOT NULL DEFAULT 0;");
                const characters = await this.database.getAll("SELECT character_id, xp FROM characters;");
                if (!characters) { throw new Error("Could not read existing characters."); }
                for (const character of characters) {
                    // Preserve levels already earned before this feature was installed.
                    const mask = requirementsThroughLevel(getLevelInfo(this.levels, character.xp).level);
                    await run("UPDATE characters SET level_up_requirements_met = ? WHERE character_id = ?;", [mask, character.character_id]);
                }
            }
            for (const [name, value] of Object.entries(REQUIREMENT_DEFAULTS)) {
                await run("INSERT OR IGNORE INTO config (name, value) VALUES (?, ?);", [name, value]);
            }
            await run("COMMIT;");
        } catch (error) {
            await this.database.execute("ROLLBACK;");
            throw error;
        } finally {
            await this.database.closeDatabase();
        }
    }

    /*
    ---------
    VALIDATOR
    ---------
    */
    isMod(listOfRoles) {
        return listOfRoles.includes(this.config["moderationRoleId"]);
    }

    async isRegistered() {
        await this.database.openDatabase();
        this.registered = await this.database.getAll("SELECT * FROM config;") ? true : false;
        await this.database.closeDatabase();
        return this.registered;
    }

    /*
    ---------
    CHARACTER
    ---------
    */
    async deleteCharacter(character) {
        await this.database.openDatabase();
        const response = await this.database.getAll(`DELETE FROM characters WHERE character_id = "${character["character_id"]}";`);
        await this.database.closeDatabase();
        return response;
    }

    async getAllCharacters(playerId) {
        await this.database.openDatabase();
        const response = await this.database.getAll(`SELECT * FROM characters WHERE player_id = "${playerId}";`);
        await this.database.closeDatabase();
        return response;
    }

    async getAllGuildCharacters(){
        await this.database.openDatabase();
        const response = await this.database.getAll(`SELECT * FROM characters;`);
        await this.database.closeDatabase();
        return response;
    }

    async getCharacter(characterId) {
        await this.database.openDatabase();
        const response = await this.database.get(`SELECT * FROM characters WHERE character_id = "${characterId}";`)
        await this.database.closeDatabase();
        return response;
    }

    async insertCharacter(character) {
        const mask = requirementMask(character.level_up_requirements_met);
        await this.database.openDatabase();
        const response = await this.database.execute("INSERT INTO characters (character_id, character_index, name, sheet_url, picture_url, player_id, xp, level_up_requirements_met) VALUES (?, ?, ?, ?, ?, ?, ?, ?);",
            [character.character_id, character.character_index, character.name, character.sheet_url, character.picture_url, character.player_id, character.xp, mask]);
        await this.database.closeDatabase();
        return response;
    }

    async updateCharacterInfo(character) {
        await this.database.openDatabase();
        const response = await this.database.execute(`UPDATE characters SET name = "${character.name}", sheet_url = "${character.sheet_url}", picture_url = "${character.picture_url}" WHERE character_id = "${character.character_id}";`)
        await this.database.closeDatabase();
        return response;

    }
    async updateCharacterXP(character, deltaXp) {
        await this.database.openDatabase();
        const response = await this.database.execute(`UPDATE characters SET xp = xp + ${deltaXp} WHERE character_id = "${character.character_id}";`)
        await this.database.closeDatabase();
        return response;

    }
    async setCharacterXP(character) {
        await this.database.openDatabase();
        const response = await this.database.execute(`UPDATE characters SET xp = ${character.xp} WHERE character_id = "${character.character_id}";`)
        await this.database.closeDatabase();
        return response;
    }

    async awardLevelUpRequirement(character, level) {
        const bit = requirementBit(level);
        await this.database.openDatabase();
        try {
            // OR retains other awards even when two moderators award concurrently.
            if (!await this.database.execute("UPDATE characters SET level_up_requirements_met = level_up_requirements_met | ? WHERE character_id = ?;", [bit, character.character_id])) {
                throw new Error("Could not award the level-up requirement.");
            }
        } finally {
            await this.database.closeDatabase();
        }
        return this.getCharacter(character.character_id);
    }

    async setCharacterRequirements(character) {
        const mask = requirementMask(character.level_up_requirements_met);
        await this.database.openDatabase();
        try {
            if (!await this.database.execute("UPDATE characters SET level_up_requirements_met = ? WHERE character_id = ?;", [mask, character.character_id])) {
                throw new Error("Could not save the level-up requirements.");
            }
        } finally {
            await this.database.closeDatabase();
        }
    }

    /*
    ---------------
    UPDATING TABLES
    ---------------
    */
    async updateConfig(config) {
        await this.database.openDatabase();
        for (const [name, value] of Object.entries(config)) {
            await this.database.execute(`UPDATE config SET value = "${value}" WHERE name = "${name}";`);
        }
        await this.database.closeDatabase();

        this.config = await this.loadInit("config", "name", "value");
    }

    async updateChannel(channelId, xpPerPost) {
        // IF THE XP IS POSITIVE ( ZERO INCLUDED ) WE WANT TO ADD THE ROLE TO THE DATABASE; ELSE, DELETE THE ROLE
        await this.database.openDatabase();
        if (xpPerPost >= 0) {
            if (channelId in this.channels) {
                await this.database.execute(`UPDATE channels SET xp_per_post = ${xpPerPost} WHERE channel_id = "${channelId}";`);
            } else {
                await this.database.execute(`INSERT INTO channels ( channel_id, xp_per_post ) VALUES ("${channelId}", ${xpPerPost});`);
            }
        } else {
            await this.database.execute(`DELETE FROM channels WHERE channel_id = "${channelId}";`);
        }
        await this.database.closeDatabase();

        this.channels = await this.loadInit("channels", "channel_id", "xp_per_post");
    }

    async updateLevel(level, xpToNext) {
        await this.database.openDatabase();
        await this.database.execute(`UPDATE levels SET xp_to_next = ${xpToNext} WHERE level = ${level};`);
        await this.database.closeDatabase();

        this.levels = await this.loadInit("levels", "level", "xp_to_next");
    }

    async updateRole(roleId, xpBonus) {
        // IF THE XP IS POSITIVE ( ZERO INCLUDED ) WE WANT TO ADD THE ROLE TO THE DATABASE; ELSE, DELETE THE ROLE
        await this.database.openDatabase();
        if (xpBonus >= 0) {
            if (roleId in this.roles) {
                await this.database.execute(`UPDATE roles SET xp_bonus = ${xpBonus} WHERE role_id = "${roleId}";`);
            } else {
                await this.database.execute(`INSERT INTO roles ( role_id, xp_bonus ) VALUES ("${roleId}", ${xpBonus});`);
            }
        } else {
            await this.database.execute(`DELETE FROM roles WHERE role_id = "${roleId}";`);
        }
        await this.database.closeDatabase();

        this.roles = await this.loadInit("roles", "role_id", "xp_bonus");
    }

    /*
    --------------------
    REGISTERING A SERVER
    --------------------
    */
    async registerServer(configDetails) {
        await this.createDatabases();
        /*
        ---------------------
        POPULATING THE CONFIG
        ---------------------
        */
        let configInit = "INSERT INTO config ( name, value ) VALUES ";
        let delimiter = "";
        for (const [name, value] of Object.entries(configDetails)) {
            configInit += `${delimiter}("${name}", "${value}")`;
            delimiter = ",";
        }
        await this.database.openDatabase();
        this.database.execute(configInit);
        await this.database.closeDatabase();
        /*
        ---------------------
        POPULATING THE LEVELS
        ---------------------
        */
        let levelsInit = "INSERT INTO levels ( level, xp_to_next ) VALUES ";
        delimiter = "";
        for (const [level, xp_to_next] of Object.entries(LEVELS)) {
            levelsInit += `${delimiter}(${level}, ${xp_to_next})`;
            delimiter = ",";
        }
        await this.database.openDatabase();
        this.database.execute(levelsInit);
        await this.database.closeDatabase();
        /*
        --------------------
        POPULATING THE ROLES
        --------------------
        */
        let rolesInit = `INSERT INTO roles ( role_id, xp_bonus ) VALUES ("${configDetails["xpFreezeRoleId"]}", 0)`;
        await this.database.openDatabase();
        this.database.execute(rolesInit);
        await this.database.closeDatabase();
    }
    /*
    ------------------------
    CREATING TABLE FUNCTIONS
    ------------------------
    */
    async createDatabases() {
        await this.createChannelsTable();
        await this.createCharactersTable();
        await this.createConfigTable();
        await this.createLevelsTable();
        await this.createRolesTable();
    }

    async createChannelsTable() {
        await this.database.openDatabase();
        const response = await this.database.execute("CREATE TABLE channels ( channel_id VARCHAR(100) PRIMARY KEY, xp_per_post NUMBER );");
        await this.database.closeDatabase();
        return response;
    }
    async createCharactersTable() {
        await this.database.openDatabase();
        const response = await this.database.execute("CREATE TABLE characters ( character_id STRING PRIMARY KEY , character_index NUMBER, name VARCHAR(100) , sheet_url VARCHAR(100) , picture_url VARCHAR(200) , player_id VARCHAR(100) , xp NUMBER, level_up_requirements_met INTEGER NOT NULL DEFAULT 0 );");
        await this.database.closeDatabase();
        return response;
    }
    async createConfigTable() {
        await this.database.openDatabase();
        const response = await this.database.execute("CREATE TABLE config ( name VARCHAR(100) PRIMARY KEY, value VARCHAR(2000) );");
        await this.database.closeDatabase();
        return response;
    }
    async createLevelsTable() {
        await this.database.openDatabase();
        const response = await this.database.execute("CREATE TABLE levels ( level NUMBER PRIMARY KEY, xp_to_next NUMBER );");
        await this.database.closeDatabase();
        return response;
    }
    async createRolesTable() {
        await this.database.openDatabase();
        const response = await this.database.execute("CREATE TABLE roles ( role_id VARCHAR(100) PRIMARY KEY, xp_bonus NUMBER );");
        await this.database.closeDatabase();
        return response;
    }
}

module.exports = { guildService }
