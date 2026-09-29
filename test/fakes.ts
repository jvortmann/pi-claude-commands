import { it } from "node:test";
import { strict as assert } from "node:assert";

/** Mirrors how pi stores extension commands: a map keyed by command name. */
export function createCommandRegistry() {
    const commands = new Map<string, { description: string; handler: (args: string, ctx: unknown) => unknown }>();
    const registrations: string[] = [];
    return {
        commands,
        registrations,
        registerCommand(name: string, options: any) {
            registrations.push(name);
            commands.set(name, options);
        },
        names() {
            return [...commands.keys()].sort();
        },
    };
}

/**
 * Fake pi runtime shared by several loaded copies of the extension, like pi itself: one command
 * table where each copy keeps its own entries, and one event bus between copies.
 */
export function createFakeHost() {
    const commands: { name: string; owner: string; options: any }[] = [];
    const listeners = new Map<string, ((data: unknown) => void)[]>();
    const copies: { handlers: Map<string, ((event: any, ctx: any) => unknown)[]> }[] = [];

    function load(path: string) {
        const handlers = new Map<string, ((event: any, ctx: any) => unknown)[]>();
        copies.push({ handlers });
        return {
            registerCommand(name: string, options: any) {
                const existing = commands.findIndex((cmd) => cmd.name === name && cmd.owner === path);
                if (existing >= 0) commands.splice(existing, 1);
                commands.push({ name, owner: path, options });
            },
            getCommands() {
                return commands.map((cmd) => ({
                    name: cmd.name,
                    source: "extension",
                    sourceInfo: { path: cmd.owner, source: "local", scope: "project", origin: "top-level" },
                }));
            },
            sendUserMessage() {},
            on(event: string, handler: (event: any, ctx: any) => unknown) {
                handlers.set(event, [...(handlers.get(event) ?? []), handler]);
            },
            events: {
                emit(channel: string, data: unknown) {
                    for (const listener of listeners.get(channel) ?? []) listener(data);
                },
                on(channel: string, listener: (data: unknown) => void) {
                    listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
                    return () => {};
                },
            },
        };
    }

    return {
        load,
        /** The only entry for a name. Fails when copies registered it twice. */
        command(name: string) {
            const matches = commands.filter((cmd) => cmd.name === name);
            assert.equal(matches.length, 1, `expected one /${name}, found ${matches.length}`);
            return matches[0].options;
        },
        /** Fires an event through every copy in load order, as pi does. */
        async emit(event: string, payload: unknown, ctx: unknown) {
            for (const copy of copies) {
                for (const handler of copy.handlers.get(event) ?? []) await handler(payload, ctx);
            }
        },
    };
}

/** Fake command context capturing what a handler reports back to the user. */
export function createFakeCtx() {
    const notifications: { message: string; type?: string }[] = [];
    return {
        notifications,
        ui: {
            notify(message: string, type?: string) {
                notifications.push({ message, type });
            },
        },
    };
}

/**
 * Fake ExtensionAPI that records subscriptions so tests can fire pi's lifecycle events.
 * getCommands() mirrors pi: it reports commands from other sources plus everything registered here.
 */
export function createFakePi(externalCommands: { name: string; owner: string }[] = []) {
    const handlers = new Map<string, ((event: any, ctx: any) => unknown)[]>();
    const listeners = new Map<string, ((data: unknown) => void)[]>();
    const sentMessages: string[] = [];
    const sentOptions: unknown[] = [];
    const registry = createCommandRegistry();
    return {
        ...registry,
        sentMessages,
        sentOptions,
        getCommands() {
            return [
                ...externalCommands.map((cmd) => ({
                    name: cmd.name,
                    source: "extension",
                    sourceInfo: { path: cmd.owner, source: "local", scope: "project", origin: "top-level" },
                })),
                ...[...registry.commands.keys()].map((name) => ({
                    name,
                    source: "extension",
                    sourceInfo: { path: "/ext/claude-commands/index.ts", source: "local", scope: "project", origin: "top-level" },
                })),
            ];
        },
        sendUserMessage(message: string, options?: unknown) {
            sentMessages.push(message);
            sentOptions.push(options);
        },
        events: {
            emit(channel: string, data: unknown) {
                for (const listener of listeners.get(channel) ?? []) listener(data);
            },
            on(channel: string, listener: (data: unknown) => void) {
                listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
                return () => {};
            },
        },
        on(event: string, handler: (event: any, ctx: any) => unknown) {
            handlers.set(event, [...(handlers.get(event) ?? []), handler]);
        },
        async emit(event: string, payload: unknown, ctx: unknown) {
            for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
        },
    };
}
