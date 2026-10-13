const { ChannelType } = require('discord.js');
const { HomebrewPollStore } = require('./homebrewPollStore');
const { HOMEBREW_VOTING } = require('../config.json');

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const POLL_INTERVAL = 5 * 60 * 1000;
const DISCOVERY_INTERVAL = 15 * 60 * 1000;
const RESULTS = {
    approved: 'This submission has been approved by vote',
    denied: 'This submission has been denied by vote',
    timed_out: 'This submission has timed out.',
};
const NO_CONSENSUS = 'This submission has not yet arrived at a consensus in review.';
const terminal = state => !['initializing', 'polling', 'deciding'].includes(state);
const missing = error => [10003, 10008].includes(error.code);
const sameTags = (a, b) => a.length === b.length && a.every(tag => b.includes(tag));

function evaluateVote(poll, votes, now, { manual = false, skipWait = false } = {}) {
    const balance = votes.up - votes.down;
    const daily = skipWait || now >= poll.nextCheckAt || (manual && now >= poll.createdAt + DAY);
    if (Math.abs(balance) >= 6 || (daily && Math.abs(balance) >= 3)) {
        return balance > 0 ? 'approved' : 'denied';
    }
    return now >= poll.createdAt + WEEK ? 'timed_out' : null;
}

class HomebrewVoting {
    constructor(client, { store = new HomebrewPollStore(), config = HOMEBREW_VOTING, now = Date.now, testGuildId } = {}) {
        this.client = client;
        this.store = store;
        this.config = config;
        this.now = now;
        this.enabled = !testGuildId || testGuildId === config.guildId;
        this.bootTime = now();
        this.queues = new Map();
        this.overrides = new Set();
        this.expectedTags = new Map();
    }

    ready() {
        if (!this.initialized) {
            this.initialized = (async () => {
                await this.store.init();
                this.startedAt = Number(await this.store.meta('startedAt', this.bootTime));
                this.discoveredAt = Number(await this.store.meta('discoveredAt')) || 0;
            })();
        }
        return this.initialized;
    }

    relevant(thread) {
        return this.enabled && thread?.guildId === this.config.guildId && thread.parentId === this.config.forumId && thread.isThread();
    }

    serial(id, action) {
        const pending = (this.queues.get(id) || Promise.resolve()).catch(() => {}).then(action);
        this.queues.set(id, pending);
        return pending.finally(() => { if (this.queues.get(id) === pending) this.queues.delete(id); });
    }

    report(error, context) {
        console.error(`Homebrew voting (${context}): ${error.message}`);
    }

    async start() {
        if (!this.enabled || this.timer) return;
        await this.ready();
        this.timer = setInterval(() => this.tick().catch(error => this.report(error, 'poll')), POLL_INTERVAL);
        this.timer.unref();
        await this.tick();
    }

    async stop() {
        clearInterval(this.timer);
        this.timer = null;
        await this.ticking;
        await Promise.allSettled(this.queues.values());
        if (this.initialized) { await this.initialized; await this.store.close(); }
    }

    async onThreadCreate(thread, newlyCreated) {
        if (!newlyCreated || !this.relevant(thread)) return;
        await this.ready();
        return this.serial(thread.id, async () => {
            await this.track(thread, true);
            return this.check(thread.id);
        });
    }

    onThreadUpdate(oldThread, thread) {
        if (!this.relevant(thread)) return Promise.resolve();
        const expected = this.expectedTags.get(thread.id);
        if (expected && expected.until >= this.now() && sameTags(expected.tags, thread.appliedTags)) {
            this.expectedTags.delete(thread.id);
            return Promise.resolve();
        }
        const removed = oldThread.appliedTags.includes(this.config.pollingTag) && !thread.appliedTags.includes(this.config.pollingTag);
        const verdictChanged = Object.values(this.config.tags).some(tag =>
            thread.appliedTags.includes(tag) && !oldThread.appliedTags.includes(tag));
        if (!removed && !verdictChanged) return Promise.resolve();
        // Mark immediately so an in-flight reaction fetch cannot override a staff decision.
        this.overrides.add(thread.id);
        return this.serial(thread.id, async () => {
            await this.ready();
            const poll = await this.store.get(thread.id);
            if (!poll || terminal(poll.state)) { this.overrides.delete(thread.id); return; }
            await this.cancel(poll, await this.fetchThread(thread.id));
        });
    }

    verdict(thread) {
        return ['approved', 'denied', 'timed_out'].find(result => thread.appliedTags.includes(this.config.tags[result]));
    }

    async fetchThread(id) {
        const thread = await this.client.channels.fetch(id, { force: true });
        if (!this.relevant(thread)) throw new Error('Choose a post in homebrew-submission.');
        return thread;
    }

    async track(thread, explicit = false) {
        if (!this.relevant(thread) || await this.store.get(thread.id)) return;
        if (!explicit && thread.createdTimestamp < this.startedAt) return;
        const manual = this.verdict(thread);
        await this.store.put({ id: thread.id, authorId: thread.ownerId, createdAt: thread.createdTimestamp,
            nextCheckAt: thread.createdTimestamp + DAY, state: manual ? 'manual' : 'initializing',
            tagApplied: thread.appliedTags.includes(this.config.pollingTag) });
    }

    async setTags(thread, tags) {
        if (tags.length > 5) throw new Error(`Post ${thread.id} has no room for the being polled tag (maximum five tags).`);
        if (sameTags(thread.appliedTags, tags)) return thread;
        // Gateway updates can arrive after the REST request has finished.
        this.expectedTags.set(thread.id, { tags, until: this.now() + POLL_INTERVAL });
        try { return await thread.setAppliedTags(tags, 'Homebrew submission voting'); }
        catch (error) { this.expectedTags.delete(thread.id); throw error; }
    }

    async cancel(poll, thread) {
        const manual = this.verdict(thread);
        poll.state = manual ? 'manual' : 'cancelled';
        if (manual && thread.appliedTags.includes(this.config.pollingTag)) {
            await this.setTags(thread, thread.appliedTags.filter(tag => tag !== this.config.pollingTag));
        }
        await this.store.put(poll);
        this.overrides.delete(poll.id);
        return poll;
    }

    async initialize(poll, thread) {
        if (this.verdict(thread) || this.overrides.has(poll.id) || (poll.tagApplied && !thread.appliedTags.includes(this.config.pollingTag))) {
            return this.cancel(poll, thread);
        }
        if (thread.archived) await thread.setArchived(false, 'Start homebrew submission voting');
        const message = await thread.fetchStarterMessage({ force: true });
        if (!message) throw new Error('The forum starter message is unavailable.');
        poll.authorId = message.author.id;
        await message.react('👍');
        await message.react('👎');
        thread = await this.fetchThread(poll.id);
        if (this.verdict(thread) || this.overrides.has(poll.id)) return this.cancel(poll, thread);
        if (!thread.appliedTags.includes(this.config.pollingTag)) {
            await this.setTags(thread, [...thread.appliedTags, this.config.pollingTag]);
        }
        poll.tagApplied = true;
        // Keep initialization pending until the opening reply is delivered, including across restarts.
        poll.openingAt = poll.openingAt ?? this.now();
        await this.store.put(poll);
        const content = `<@&${this.config.teamRole}>\nPoll opened.`;
        poll.openingMessageId = poll.openingMessageId || await this.findMessage(thread, content, poll.openingAt);
        thread = await this.fetchThread(poll.id);
        if (this.verdict(thread) || !thread.appliedTags.includes(this.config.pollingTag) || this.overrides.has(poll.id)) {
            return this.cancel(poll, thread);
        }
        if (!poll.openingMessageId) {
            if (thread.archived) await thread.setArchived(false, 'Announce homebrew poll opening');
            const opening = await thread.send({ content, reply: { messageReference: poll.id },
                nonce: `${poll.id}-open`, enforceNonce: true,
                allowedMentions: { parse: [], users: [], roles: [this.config.teamRole], repliedUser: false } });
            poll.openingMessageId = opening.id;
        }
        poll.state = 'polling';
        await this.store.put(poll);
        return poll;
    }

    async reactionUsers(reaction) {
        const users = new Map();
        if (!reaction) return users;
        // A normal reaction and a super reaction from the same person are one vote.
        for (const type of [0, 1]) {
            if (type === 1 && !reaction.countDetails?.burst) continue;
            let after;
            while (true) {
                const page = await reaction.users.fetch({ limit: 100, after, type });
                for (const user of page.values()) users.set(user.id, user);
                if (page.size < 100) break;
                const next = [...page.keys()].reduce((largest, id) => BigInt(id) > BigInt(largest) ? id : largest);
                if (next === after) throw new Error('Reaction pagination did not advance.');
                after = next;
            }
        }
        return users;
    }

    async removeUncountedVotes(thread, reactions, eligible) {
        const removals = reactions.flatMap(([reaction, users]) => [...users.keys()]
            .filter(id => id !== this.client.user.id && !eligible.has(id))
            .map(id => ({ reaction, id })));
        if (!removals.length) return;
        thread = await this.fetchThread(thread.id);
        if (this.verdict(thread) || !thread.appliedTags.includes(this.config.pollingTag) || this.overrides.has(thread.id)) return;
        for (const { reaction, id } of removals) {
            if (this.overrides.has(thread.id)) return;
            try {
                await reaction.users.remove(id);
            } catch (error) {
                if (missing(error)) throw error;
                if (error.code === 10014) continue; // The reaction was already removed.
                // Cleanup must not prevent a verdict based on eligible votes.
                const failure = error.code === 50013
                    ? new Error('Removing uncounted votes requires Manage Messages permission in homebrew-submission.') : error;
                this.report(failure, `clean reactions on ${thread.id}`);
                return; // Retry at the next check rather than repeating a failing request for every voter.
            }
        }
    }

    async countVotes(thread) {
        const message = await thread.fetchStarterMessage({ force: true });
        if (!message) throw new Error('The forum starter message is unavailable.');
        const upReaction = message.reactions.cache.get('👍');
        const downReaction = message.reactions.cache.get('👎');
        const up = await this.reactionUsers(upReaction);
        const down = await this.reactionUsers(downReaction);
        const eligible = new Set();
        for (const [id, user] of new Map([...up, ...down])) {
            if (user.bot || id === this.client.user.id || id === message.author.id) continue;
            try {
                const member = await thread.guild.members.fetch({ user: id, force: true });
                if (member.roles.cache.has(this.config.teamRole)) eligible.add(id);
            } catch (error) {
                if (error.code !== 10007) throw error; // Left the server; other API failures must not become a zero vote.
            }
        }
        // Resolve every voter first; a failed role lookup must never cause a valid vote to be deleted.
        await this.removeUncountedVotes(thread, [[upReaction, up], [downReaction, down]], eligible);
        return { up: [...up.keys()].filter(id => eligible.has(id)).length,
            down: [...down.keys()].filter(id => eligible.has(id)).length };
    }

    async check(id, options = {}) {
        let poll = await this.store.get(id);
        if (!poll || terminal(poll.state)) return poll;
        try {
            let thread = await this.fetchThread(id);
            if (poll.state === 'deciding') return await this.finish(poll, thread);
            if (poll.state === 'initializing') {
                poll = await this.initialize(poll, thread);
                if (terminal(poll.state)) return poll;
                thread = await this.fetchThread(id);
            }
            if (this.verdict(thread) || !thread.appliedTags.includes(this.config.pollingTag) || this.overrides.has(id)) {
                return await this.cancel(poll, thread);
            }
            poll.votes = await this.countVotes(thread);
            thread = await this.fetchThread(id);
            if (this.verdict(thread) || !thread.appliedTags.includes(this.config.pollingTag) || this.overrides.has(id)) {
                return await this.cancel(poll, thread);
            }
            const now = this.now();
            const result = evaluateVote(poll, poll.votes, now, options);
            if (result) {
                poll.state = 'deciding';
                poll.result = result;
                poll.decidedAt = now;
                await this.store.put(poll);
                return await this.finish(poll, thread);
            }
            if (now >= poll.nextCheckAt) {
                poll.pendingReminderAt = poll.pendingReminderAt || now;
                poll.pendingReminderDay = Math.floor((now - poll.createdAt) / DAY);
                poll.nextCheckAt = Math.min(poll.createdAt + WEEK, poll.createdAt + (Math.floor((now - poll.createdAt) / DAY) + 1) * DAY);
            }
            await this.store.put(poll);
            if (poll.pendingReminderAt) await this.remind(poll, thread);
            return poll;
        } catch (error) {
            if (!missing(error)) throw error;
            poll.state = 'cancelled';
            await this.store.put(poll);
            return poll;
        }
    }

    announcement(poll) {
        return `<@&${this.config.teamRole}> <@${poll.authorId}>\n${RESULTS[poll.result]}`;
    }

    async findMessage(thread, content, since) {
        let before;
        while (true) {
            const messages = await thread.messages.fetch({ limit: 100, before, cache: false });
            const found = messages.find(message => message.author.id === this.client.user.id &&
                message.content === content && message.createdTimestamp >= since - 60_000);
            if (found) return found.id;
            if (messages.size < 100) return null;
            const oldest = [...messages.values()].reduce((a, b) => BigInt(a.id) < BigInt(b.id) ? a : b);
            if (oldest.createdTimestamp < since - 60_000) return null;
            if (before === oldest.id) throw new Error('Announcement pagination did not advance.');
            before = oldest.id;
        }
    }

    async remind(poll, thread) {
        const content = `<@&${this.config.teamRole}>\n${NO_CONSENSUS}`;
        const existing = await this.findMessage(thread, content, poll.pendingReminderAt);
        thread = await this.fetchThread(poll.id);
        if (this.verdict(thread) || !thread.appliedTags.includes(this.config.pollingTag) || this.overrides.has(poll.id)) {
            return this.cancel(poll, thread);
        }
        if (!existing) {
            if (thread.archived) await thread.setArchived(false, 'Request homebrew team votes');
            await thread.send({ content, nonce: `${poll.id}-${poll.pendingReminderDay}`, enforceNonce: true,
                allowedMentions: { parse: [], users: [], roles: [this.config.teamRole] } });
        }
        delete poll.pendingReminderAt;
        delete poll.pendingReminderDay;
        await this.store.put(poll);
    }

    async finish(poll, thread) {
        const verdict = this.verdict(thread);
        if (this.overrides.has(poll.id) || (verdict && verdict !== poll.result) ||
            (!verdict && !thread.appliedTags.includes(this.config.pollingTag))) return this.cancel(poll, thread);
        if (thread.archived) await thread.setArchived(false, 'Announce homebrew voting result');
        const statusTags = [this.config.pollingTag, ...Object.values(this.config.tags)];
        await this.setTags(thread, [...thread.appliedTags.filter(tag => !statusTags.includes(tag)), this.config.tags[poll.result]]);
        thread = await this.fetchThread(poll.id);
        if (this.overrides.has(poll.id) || this.verdict(thread) !== poll.result) return this.cancel(poll, thread);
        poll.announcementId = poll.announcementId || await this.findMessage(thread, this.announcement(poll), poll.decidedAt);
        if (!poll.announcementId) {
            thread = await this.fetchThread(poll.id);
            if (this.overrides.has(poll.id) || this.verdict(thread) !== poll.result) return this.cancel(poll, thread);
            const message = await thread.send({ content: this.announcement(poll), nonce: poll.id, enforceNonce: true,
                allowedMentions: { parse: [], users: [poll.authorId], roles: [this.config.teamRole] } });
            poll.announcementId = message.id;
        }
        poll.state = poll.result;
        await this.store.put(poll);
        if (poll.result === 'timed_out') {
            // Save completion before closing so a moderator's later reopen is never undone.
            try {
                thread = await this.fetchThread(poll.id);
                if (!this.overrides.has(poll.id) && this.verdict(thread) === 'timed_out' && !thread.archived) {
                    await thread.setArchived(true, 'Homebrew review timed out');
                }
            } catch (error) { this.report(error, `close timed-out post ${poll.id}`); }
        }
        return poll;
    }

    async discover() {
        const forum = await this.client.channels.fetch(this.config.forumId, { force: true });
        if (!forum || forum.type !== ChannelType.GuildForum || forum.guildId !== this.config.guildId) {
            throw new Error('The configured homebrew forum is unavailable.');
        }
        const now = this.now();
        const visit = async threads => {
            for (const thread of threads.values()) {
                await this.serial(thread.id, () => this.track(thread));
            }
        };
        await visit((await forum.threads.fetchActive()).threads);
        let before;
        const cutoff = Math.max(this.startedAt, this.discoveredAt - 60 * 60 * 1000);
        while (true) {
            const page = await forum.threads.fetchArchived({ type: 'public', limit: 100, before });
            await visit(page.threads);
            if (!page.hasMore || !page.threads.size) break;
            const oldest = Math.min(...[...page.threads.values()].map(thread => thread.archiveTimestamp));
            if (oldest < cutoff) break;
            if (before && oldest >= before.getTime()) throw new Error('Archived forum pagination did not advance.');
            before = new Date(oldest);
        }
        await this.store.setMeta('discoveredAt', now);
        this.discoveredAt = now;
    }

    tick() {
        if (!this.enabled) return Promise.resolve();
        if (this.ticking) return this.ticking;
        this.ticking = (async () => {
            await this.ready();
            for (const [id, expected] of this.expectedTags) {
                if (expected.until < this.now()) this.expectedTags.delete(id);
            }
            if (!this.discoveredAt || this.now() - this.discoveredAt >= DISCOVERY_INTERVAL) {
                try { await this.discover(); } catch (error) { this.report(error, 'discover posts'); }
            }
            for (const poll of await this.store.active()) {
                try { await this.serial(poll.id, () => this.check(poll.id)); }
                catch (error) { this.report(error, poll.id); }
            }
        })().finally(() => { this.ticking = null; });
        return this.ticking;
    }

    async verify(id, { skipWait = false } = {}) {
        if (!this.enabled) throw new Error('Homebrew voting is disabled for this test server.');
        await this.ready();
        return this.serial(id, async () => {
            const thread = await this.fetchThread(id);
            if (!await this.store.get(id)) {
                if (!thread.appliedTags.includes(this.config.pollingTag)) throw new Error('This post is not being polled.');
                await this.track(thread, true);
            }
            return this.check(id, { manual: true, skipWait });
        });
    }
}

module.exports = { HomebrewVoting, evaluateVote, DAY, WEEK, POLL_INTERVAL };
