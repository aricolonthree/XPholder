const { sqlLite3DatabaseService } = require('../database/sqlite');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Queue writers before opening connections: blocked SQLite workers can otherwise
// fill Node's worker pool while the active transaction waits to finish its queries.
const writers = new Map();
const VISIBLE = `(? = 1 OR f.is_public = 1 OR EXISTS (
    SELECT 1 FROM faction_visibility v WHERE v.faction_id = f.faction_id
    AND v.player_id = ? AND (v.manual_visible = 1 OR v.renown_visible = 1)))`;
const accessParams = viewer => [!viewer || viewer.moderator ? 1 : 0, viewer?.playerId || ''];
const readFaction = row => row ? { ...row, info_sections: JSON.parse(row.info_sections || '[]') } : row;

function infoSections(sections = []) {
    if (!Array.isArray(sections) || sections.length > 8) { throw new Error('A faction can have up to 8 info sections.'); }
    const clean = sections.map(section => {
        const title = section.title?.trim();
        const text = section.text?.trim();
        if (!title || title.length > 80) { throw new Error('Section titles must contain 1–80 characters.'); }
        if (!text || text.length > 1024) { throw new Error('Section text must contain 1–1024 characters.'); }
        return { id: section.id || randomUUID(), title, text };
    });
    if (clean.reduce((total, section) => total + section.title.length + section.text.length, 0) > 2000) {
        throw new Error('Info sections can contain up to 2000 characters combined, including titles.');
    }
    return clean;
}

function factionDetails(details) {
    const name = details.name?.trim();
    const description = details.description?.trim();
    const imageUrl = details.image_url?.trim() || '';
    if (!name || name.length > 80) { throw new Error('Faction names must contain 1–80 characters.'); }
    if (!description || description.length > 2000) { throw new Error('Faction descriptions must contain 1–2000 characters.'); }
    if (imageUrl) {
        let url;
        try { url = new URL(imageUrl); } catch { throw new Error('The faction image must be a valid HTTPS URL.'); }
        if (url.protocol !== 'https:' || imageUrl.length > 2048) { throw new Error('The faction image must be an HTTPS URL of at most 2048 characters.'); }
    }
    const primaryDmId = details.primary_dm_id || '';
    const primaryDmName = details.primary_dm_name?.trim() || '';
    if (primaryDmId.length > 32 || primaryDmName.length > 100 || Boolean(primaryDmId) !== Boolean(primaryDmName)) {
        throw new Error('Choose a valid primary DM.');
    }
    if (![undefined, false, true, 0, 1].includes(details.is_public)) { throw new Error('Fully public must be on or off.'); }
    return { name, name_key: name.normalize('NFKC').toLowerCase(), description, image_url: imageUrl,
        primary_dm_id: primaryDmId, primary_dm_name: primaryDmName, is_public: details.is_public ? 1 : 0,
        info_sections: infoSections(details.info_sections),
    };
}

class factionService {
    constructor(database) { this.database = database; }

    async connect(action, transaction = false) {
        if (!transaction) { return this.withConnection(action, false); }
        const databasePath = path.resolve(this.database.databaseName);
        const key = process.platform === 'win32' ? databasePath.toLowerCase() : databasePath;
        const pending = (writers.get(key) || Promise.resolve()).catch(() => {})
            .then(() => this.withConnection(action, true));
        writers.set(key, pending);
        try { return await pending; }
        finally { if (writers.get(key) === pending) { writers.delete(key); } }
    }

    async withConnection(action, transaction) {
        // Each interaction/collector gets its own connection; no shared handle races.
        const db = new sqlLite3DatabaseService(this.database.sqlite3, this.database.databaseName);
        if (!await db.openDatabase()) { throw new Error('Could not open the faction database.'); }
        db.database.configure('busyTimeout', 5000);
        const run = async (sql, params = []) => {
            if (!await db.execute(sql, params)) { throw new Error('Could not save faction data.'); }
        };
        let started = false;
        try {
            if (transaction) { await run('BEGIN IMMEDIATE;'); started = true; }
            const result = await action(db, run);
            if (transaction) { await run('COMMIT;'); }
            return result;
        } catch (error) {
            if (started) { await db.execute('ROLLBACK;'); }
            throw error;
        } finally {
            await db.closeDatabase();
        }
    }

    async init() {
        await this.connect(async (db, run) => {
            await run(`CREATE TABLE IF NOT EXISTS factions (
                faction_id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
                description TEXT NOT NULL, image_url TEXT NOT NULL DEFAULT ''
            );`);
            const columns = await db.getAll('PRAGMA table_info(factions);');
            if (!columns) { throw new Error('Could not read the faction schema.'); }
            for (const [column, definition] of Object.entries({
                primary_dm_id: "TEXT NOT NULL DEFAULT ''", primary_dm_name: "TEXT NOT NULL DEFAULT ''",
                is_public: 'INTEGER NOT NULL DEFAULT 0', info_sections: "TEXT NOT NULL DEFAULT '[]'",
            })) {
                if (!columns.some(item => item.name === column)) { await run(`ALTER TABLE factions ADD COLUMN ${column} ${definition};`); }
            }
            await run(`CREATE TABLE IF NOT EXISTS character_faction_renown (
                character_id TEXT NOT NULL, faction_id INTEGER NOT NULL,
                renown INTEGER NOT NULL DEFAULT 0,
                quests INTEGER NOT NULL DEFAULT 0 CHECK (quests >= 0),
                solo_challenges INTEGER NOT NULL DEFAULT 0 CHECK (solo_challenges >= 0),
                PRIMARY KEY (character_id, faction_id)
            );`);
            const visibilityTable = await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'faction_visibility';");
            if (visibilityTable === false) { throw new Error('Could not read the faction visibility schema.'); }
            await run(`CREATE TABLE IF NOT EXISTS faction_visibility (
                player_id TEXT NOT NULL, faction_id INTEGER NOT NULL,
                manual_visible INTEGER NOT NULL DEFAULT 0,
                renown_visible INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (player_id, faction_id)
            );`);
            if (!visibilityTable) {
                await run(`INSERT OR IGNORE INTO faction_visibility (player_id, faction_id, renown_visible)
                    SELECT c.player_id, r.faction_id, 1 FROM character_faction_renown r
                    JOIN characters c ON c.character_id = r.character_id
                    JOIN factions f ON f.faction_id = r.faction_id WHERE r.renown != 0;`);
            }
            // Also applies to legacy deletion paths and direct character deletion.
            await run(`CREATE TRIGGER IF NOT EXISTS delete_character_faction_renown
                AFTER DELETE ON characters BEGIN
                    DELETE FROM character_faction_renown WHERE character_id = OLD.character_id;
                END;`);
            await run(`CREATE TRIGGER IF NOT EXISTS delete_faction_data
                AFTER DELETE ON factions BEGIN
                    DELETE FROM character_faction_renown WHERE faction_id = OLD.faction_id;
                    DELETE FROM faction_visibility WHERE faction_id = OLD.faction_id;
                END;`);
        }, true);
    }

    async list(characterId = null, viewer = null) {
        return this.connect(async db => {
            const rows = await db.getAll(`SELECT f.*, COALESCE(r.renown, 0) AS renown,
                COALESCE(r.quests, 0) AS quests, COALESCE(r.solo_challenges, 0) AS solo_challenges
                FROM factions f LEFT JOIN character_faction_renown r
                ON r.faction_id = f.faction_id AND r.character_id = ?
                WHERE ${VISIBLE}
                ORDER BY f.name_key, f.faction_id;`, [characterId, ...accessParams(viewer)]);
            if (!rows) { throw new Error('Could not read factions.'); }
            return rows.map(readFaction);
        });
    }

    async find(selection, viewer = null) {
        return this.connect(async db => {
            const id = typeof selection === 'number' ? selection : /^faction:(\d+)$/.exec(selection || '')?.[1];
            const value = id !== undefined ? id : String(selection || '').trim().normalize('NFKC').toLowerCase();
            const faction = await db.get(`SELECT f.* FROM factions f WHERE ${id !== undefined ? 'f.faction_id' : 'f.name_key'} = ? AND ${VISIBLE};`,
                [value, ...accessParams(viewer)]);
            if (faction === false) { throw new Error('Could not read the faction.'); }
            return readFaction(faction);
        });
    }

    async register(details) {
        const faction = factionDetails(details);
        return this.connect(async (db, run) => {
            if (await db.get('SELECT faction_id FROM factions WHERE name_key = ?;', [faction.name_key])) {
                throw new Error('A faction with that name is already registered in this server.');
            }
            await run(`INSERT INTO factions (name, name_key, description, image_url, primary_dm_id, primary_dm_name, is_public, info_sections)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
                [faction.name, faction.name_key, faction.description, faction.image_url, faction.primary_dm_id,
                    faction.primary_dm_name, faction.is_public, JSON.stringify(faction.info_sections)]);
            return readFaction(await db.get('SELECT * FROM factions WHERE name_key = ?;', [faction.name_key]));
        }, true);
    }

    async edit(factionId, changes) {
        return this.connect(async (db, run) => {
            const current = await db.get('SELECT * FROM factions WHERE faction_id = ?;', [factionId]);
            if (!current) { throw new Error('That faction is no longer registered.'); }
            const faction = factionDetails({ ...readFaction(current), ...changes });
            if (await db.get('SELECT faction_id FROM factions WHERE name_key = ? AND faction_id != ?;', [faction.name_key, factionId])) {
                throw new Error('A faction with that name is already registered in this server.');
            }
            await run(`UPDATE factions SET name = ?, name_key = ?, description = ?, image_url = ?,
                primary_dm_id = ?, primary_dm_name = ?, is_public = ?, info_sections = ? WHERE faction_id = ?;`,
                [faction.name, faction.name_key, faction.description, faction.image_url, faction.primary_dm_id,
                    faction.primary_dm_name, faction.is_public, JSON.stringify(faction.info_sections), factionId]);
            return { faction_id: factionId, ...faction };
        }, true);
    }

    async setVisibility(factionId, playerId, visible) {
        if (!playerId || typeof visible !== 'boolean') { throw new Error('Choose a player and visibility setting.'); }
        return this.connect(async (db, run) => {
            const faction = await db.get('SELECT * FROM factions WHERE faction_id = ?;', [factionId]);
            if (!faction) { throw new Error('That faction is no longer registered.'); }
            await run(`INSERT INTO faction_visibility (player_id, faction_id, manual_visible) VALUES (?, ?, ?)
                ON CONFLICT(player_id, faction_id) DO UPDATE SET manual_visible = excluded.manual_visible;`, [playerId, factionId, visible ? 1 : 0]);
            const access = await db.get('SELECT * FROM faction_visibility WHERE player_id = ? AND faction_id = ?;', [playerId, factionId]);
            return { ...access, is_public: faction.is_public };
        }, true);
    }

    async editInfo(factionId, action, sectionId, changes = {}) {
        return this.connect(async (db, run) => {
            const faction = readFaction(await db.get('SELECT * FROM factions WHERE faction_id = ?;', [factionId]));
            if (!faction) { throw new Error('That faction is no longer registered.'); }
            const sections = faction.info_sections;
            if (action === 'add') { sections.push({ id: randomUUID(), ...changes }); }
            else {
                const index = sections.findIndex(section => section.id === sectionId);
                if (index < 0) { throw new Error('That info section no longer exists.'); }
                if (action === 'edit') { sections[index] = { ...sections[index], ...changes }; }
                else if (action === 'remove') { sections.splice(index, 1); }
                else { throw new Error('Unknown section action.'); }
            }
            faction.info_sections = infoSections(sections);
            await run('UPDATE factions SET info_sections = ? WHERE faction_id = ?;', [JSON.stringify(faction.info_sections), factionId]);
            return faction;
        }, true);
    }

    async delete(factionId) {
        return this.connect(async (db, run) => {
            const faction = await db.get('SELECT * FROM factions WHERE faction_id = ?;', [factionId]);
            if (!faction) { throw new Error('That faction is no longer registered.'); }
            await run('DELETE FROM factions WHERE faction_id = ?;', [factionId]);
            return readFaction(faction);
        }, true);
    }

    async award(characterId, factionId, changes) {
        const delta = {
            renown: changes.renown ?? 0,
            quests: changes.quests ?? 0,
            solo_challenges: changes.solo_challenges ?? 0,
        };
        if (Object.values(delta).some(value => !Number.isSafeInteger(value))) { throw new Error('Awards must be whole numbers.'); }
        if (Object.values(delta).every(value => value === 0)) { throw new Error('Provide a nonzero renown, quest, or solo-challenge award.'); }
        return this.connect(async (db, run) => {
            const character = await db.get('SELECT character_id, player_id FROM characters WHERE character_id = ?;', [characterId]);
            if (!character) {
                throw new Error('That character does not exist.');
            }
            if (!await db.get('SELECT faction_id FROM factions WHERE faction_id = ?;', [factionId])) {
                throw new Error('That faction is no longer registered.');
            }
            const stored = await db.get('SELECT * FROM character_faction_renown WHERE character_id = ? AND faction_id = ?;', [characterId, factionId]);
            if (stored === false) { throw new Error('Could not read existing renown.'); }
            const before = stored || { renown: 0, quests: 0, solo_challenges: 0 };
            const after = {};
            for (const key of Object.keys(delta)) {
                after[key] = before[key] + delta[key];
                if (!Number.isSafeInteger(after[key])) { throw new Error('The resulting total is too large.'); }
            }
            if (after.quests < 0 || after.solo_challenges < 0) { throw new Error('Quest and solo-challenge totals cannot be negative.'); }
            await run(`INSERT INTO character_faction_renown (character_id, faction_id, renown, quests, solo_challenges)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT(character_id, faction_id) DO UPDATE SET
                renown = excluded.renown, quests = excluded.quests, solo_challenges = excluded.solo_challenges;`,
            [characterId, factionId, after.renown, after.quests, after.solo_challenges]);
            if (delta.renown !== 0) {
                await run(`INSERT INTO faction_visibility (player_id, faction_id, renown_visible) VALUES (?, ?, 1)
                    ON CONFLICT(player_id, faction_id) DO UPDATE SET renown_visible = 1;`, [character.player_id, factionId]);
            }
            return { before, after };
        }, true);
    }
}

module.exports = { factionService, factionDetails };
