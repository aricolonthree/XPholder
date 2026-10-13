const sqlite3 = require('sqlite3');
const fs = require('node:fs');
const path = require('node:path');

class HomebrewPollStore {
    constructor(filename = path.join(__dirname, '../../guilds/homebrew-polls.db')) {
        this.filename = filename;
    }

    async init() {
        fs.mkdirSync(path.dirname(this.filename), { recursive: true });
        await new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.filename, error => error ? reject(error) : resolve());
        });
        this.db.configure('busyTimeout', 5000);
        await this.run('CREATE TABLE IF NOT EXISTS homebrew_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)');
        await this.run('CREATE TABLE IF NOT EXISTS homebrew_polls (thread_id TEXT PRIMARY KEY, state TEXT NOT NULL, data TEXT NOT NULL)');
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => this.db.run(sql, params, error => error ? reject(error) : resolve()));
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => this.db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
    }

    async meta(name, initialValue) {
        if (initialValue !== undefined) {
            await this.run('INSERT OR IGNORE INTO homebrew_meta (name, value) VALUES (?, ?)', [name, String(initialValue)]);
        }
        return (await this.all('SELECT value FROM homebrew_meta WHERE name = ?', [name]))[0]?.value;
    }

    async setMeta(name, value) {
        await this.run('INSERT INTO homebrew_meta (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value', [name, String(value)]);
    }

    async get(id) {
        const row = (await this.all('SELECT data FROM homebrew_polls WHERE thread_id = ?', [id]))[0];
        return row ? JSON.parse(row.data) : null;
    }

    async put(poll) {
        await this.run(`INSERT INTO homebrew_polls (thread_id, state, data) VALUES (?, ?, ?)
            ON CONFLICT(thread_id) DO UPDATE SET state = excluded.state, data = excluded.data`,
        [poll.id, poll.state, JSON.stringify(poll)]);
    }

    async active() {
        return (await this.all("SELECT data FROM homebrew_polls WHERE state IN ('initializing', 'polling', 'deciding')"))
            .map(row => JSON.parse(row.data));
    }

    close() {
        return new Promise((resolve, reject) => this.db.close(error => error ? reject(error) : resolve()));
    }
}

module.exports = { HomebrewPollStore };
