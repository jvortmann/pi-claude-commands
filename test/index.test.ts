import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
    parseFrontmatter,
    discoverCommands,
    parseCommandDirs,
    resolveCommandDirs,
    registerCommands,
    activate,
} from "../index.ts";

/** Mirrors how pi stores extension commands: a map keyed by command name. */
function createCommandRegistry() {
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
function createFakeHost() {
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
function createFakeCtx() {
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
function createFakePi(externalCommands: { name: string; owner: string }[] = []) {
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

describe("parseFrontmatter", () => {
    it("parses description and body from valid frontmatter", () => {
        const content = "---\ndescription: My command\n---\nHello world";
        const result = parseFrontmatter(content);

        assert.equal(result.description, "My command");
        assert.equal(result.body, "Hello world");
    });

    it("treats entire content as body when no frontmatter is present", () => {
        const content = "Just plain markdown";
        const result = parseFrontmatter(content);

        assert.equal(result.description, "");
        assert.equal(result.body, "Just plain markdown");
    });

    it("leaves description empty when frontmatter has no description field", () => {
        const content = "---\ntitle: Something\n---\nBody here";
        const result = parseFrontmatter(content);

        assert.equal(result.description, "");
        assert.equal(result.body, "Body here");
    });
});

describe("discoverCommands", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "pi-claude-cmds-"));
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it("discovers .md files as commands", () => {
        writeFileSync(join(tmpDir, "deploy.md"), "Deploy instructions");

        const commands = discoverCommands(tmpDir, tmpDir, "");

        assert.equal(commands.length, 1);
        assert.equal(commands[0].name, "deploy");
    });

    it("builds nested command names from subdirectories", () => {
        mkdirSync(join(tmpDir, "jira"));
        writeFileSync(join(tmpDir, "jira", "plan.md"), "---\ndescription: Plan a ticket\n---\nPlan content");

        const commands = discoverCommands(tmpDir, tmpDir, "");

        assert.equal(commands.length, 1);
        assert.equal(commands[0].name, "jira/plan");
        assert.equal(commands[0].description, "Plan a ticket");
    });

    it("handles non-existent directory gracefully", () => {
        const commands = discoverCommands("/nonexistent", "/nonexistent", "");

        assert.equal(commands.length, 0);
    });

    it("ignores non-.md files", () => {
        writeFileSync(join(tmpDir, "deploy.md"), "Deploy");
        writeFileSync(join(tmpDir, "notes.txt"), "Notes");
        writeFileSync(join(tmpDir, "config.json"), "{}");

        const commands = discoverCommands(tmpDir, tmpDir, "");

        assert.equal(commands.length, 1);
        assert.equal(commands[0].name, "deploy");
    });
});

describe("registerCommands", () => {
    let tmpDir: string;
    let agentDir: string;
    let projectDir: string;
    let commandsDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "pi-claude-cmds-"));
        agentDir = join(tmpDir, "agent");
        projectDir = join(tmpDir, "project");
        commandsDir = join(projectDir, ".claude", "commands");
        mkdirSync(agentDir, { recursive: true });
        mkdirSync(commandsDir, { recursive: true });
        mkdirSync(join(projectDir, ".pi"), { recursive: true });
        writeFileSync(join(agentDir, "settings.json"), JSON.stringify({}));
        writeFileSync(join(projectDir, ".pi", "settings.json"), JSON.stringify({ commands: [".claude/commands"] }));
        writeFileSync(join(commandsDir, "one.md"), "---\ndescription: First\n---\nBody one\n");
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it("leaves out project commands when the project is not trusted", () => {
        const pi = createFakePi();
        mkdirSync(join(agentDir, "commands"), { recursive: true });
        writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ commands: ["commands"] }));
        writeFileSync(join(agentDir, "commands", "personal.md"), "---\ndescription: Mine\n---\nBody\n");

        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: false });

        assert.equal(pi.names().includes("personal"), true);
        assert.equal(pi.names().includes("one"), false);
    });

    it("skips a command named after a pi built-in", () => {
        const pi = createFakePi();
        writeFileSync(join(commandsDir, "compact.md"), "---\ndescription: Shadowed\n---\nBody\n");

        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true, owned: new Set() });

        assert.equal(pi.names().includes("compact"), false);
        assert.equal(pi.names().includes("one"), true);
    });

    it("reports a built-in name as owned by pi", async () => {
        const pi = createFakePi();
        const ctx = createFakeCtx();
        writeFileSync(join(commandsDir, "compact.md"), "---\ndescription: Shadowed\n---\nBody\n");

        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true, owned: new Set() });
        await pi.commands.get("claude-commands")!.handler("", ctx);

        assert.equal(ctx.notifications[0].message.includes("/compact - " + join(commandsDir, "compact.md") + " (owned by pi built-in)"), true);
    });

    it("skips a name the terminal UI handles without listing it", () => {
        const pi = createFakePi();
        writeFileSync(join(commandsDir, "debug.md"), "---\ndescription: Shadowed\n---\nBody\n");

        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true, owned: new Set() });

        assert.equal(pi.names().includes("debug"), false);
    });

    it("skips a command name another source already registered", () => {
        const pi = createFakePi([{ name: "one", owner: "/ext/other-extension/index.ts" }]);

        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true, owned: new Set() });

        assert.equal(pi.names().includes("one"), false);
    });

    it("reports registered commands and skipped clashes on request", async () => {
        const pi = createFakePi([{ name: "one", owner: "/ext/other-extension/index.ts" }]);
        const ctx = createFakeCtx();
        writeFileSync(join(commandsDir, "two.md"), "---\ndescription: Second\n---\nBody two\n");

        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true, owned: new Set() });
        await pi.commands.get("claude-commands")!.handler("", ctx);

        assert.equal(ctx.notifications.length, 1);
        const report = ctx.notifications[0].message;
        assert.equal(report.includes(join(commandsDir, "two.md")), true);
        assert.equal(report.includes(join(commandsDir, "one.md")), true);
        assert.equal(report.includes("/ext/other-extension/index.ts"), true);
    });

    it("still refreshes its own commands on a later pass", () => {
        const pi = createFakePi();
        const owned = new Set<string>();

        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true, owned });
        assert.equal(pi.commands.get("one")?.description, "[p] First");

        writeFileSync(join(commandsDir, "one.md"), "---\ndescription: Renamed\n---\nBody one\n");
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true, owned });

        assert.equal(pi.commands.get("one")?.description, "[p] Renamed");
    });

    it("picks up a command file created after the previous pass", () => {
        const pi = createCommandRegistry();

        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });
        assert.deepEqual(pi.names(), ["claude-commands", "one"]);

        writeFileSync(join(commandsDir, "two.md"), "---\ndescription: Second\n---\nBody two\n");
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        assert.deepEqual(pi.names(), ["claude-commands", "one", "two"]);
    });

    it("re-registers a command whose description changed since the previous pass", () => {
        const pi = createCommandRegistry();

        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });
        assert.equal(pi.commands.get("one")?.description, "[p] First");

        writeFileSync(join(commandsDir, "one.md"), "---\ndescription: Renamed\n---\nBody one\n");
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        assert.equal(pi.commands.get("one")?.description, "[p] Renamed");
    });

    it("honors a command directory added to settings since the previous pass", () => {
        const pi = createCommandRegistry();
        const extraDir = join(projectDir, ".team", "commands");
        mkdirSync(extraDir, { recursive: true });
        writeFileSync(join(extraDir, "deploy.md"), "---\ndescription: Deploy\n---\nBody deploy\n");

        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });
        assert.deepEqual(pi.names(), ["claude-commands", "one"]);

        writeFileSync(
            join(projectDir, ".pi", "settings.json"),
            JSON.stringify({ commands: [".claude/commands", ".team/commands"] }),
        );
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        assert.deepEqual(pi.names(), ["claude-commands", "deploy", "one"]);
    });
});

describe("command invocation", () => {
    let tmpDir: string;
    let agentDir: string;
    let projectDir: string;
    let commandsDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "pi-claude-cmds-"));
        agentDir = join(tmpDir, "agent");
        projectDir = join(tmpDir, "project");
        commandsDir = join(projectDir, ".claude", "commands");
        mkdirSync(agentDir, { recursive: true });
        mkdirSync(commandsDir, { recursive: true });
        mkdirSync(join(projectDir, ".pi"), { recursive: true });
        writeFileSync(join(agentDir, "settings.json"), JSON.stringify({}));
        writeFileSync(join(projectDir, ".pi", "settings.json"), JSON.stringify({ commands: [".claude/commands"] }));
        writeFileSync(join(commandsDir, "one.md"), "---\ndescription: First\n---\nBody one\n");
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it("sends the command body as a user message", async () => {
        const pi = createFakePi();
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        await pi.commands.get("one")!.handler("", createFakeCtx());

        assert.deepEqual(pi.sentMessages, ["Body one\n"]);
    });

    it("appends arguments below the command body", async () => {
        const pi = createFakePi();
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        await pi.commands.get("one")!.handler("AUD-2157", createFakeCtx());

        assert.deepEqual(pi.sentMessages, ["Body one\n\n\nUser: AUD-2157"]);
    });

    it("queues the prompt until the agent finishes its current run", async () => {
        const pi = createFakePi();
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        await pi.commands.get("one")!.handler("", createFakeCtx());

        assert.deepEqual(pi.sentOptions, [{ deliverAs: "followUp" }]);
    });

    it("reports a command file that disappeared instead of sending a message", async () => {
        const pi = createFakePi();
        const ctx = createFakeCtx();
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });
        rmSync(join(commandsDir, "one.md"));

        await pi.commands.get("one")!.handler("", ctx);

        assert.deepEqual(pi.sentMessages, []);
        assert.equal(ctx.notifications.length, 1);
        assert.equal(ctx.notifications[0].type, "error");
        assert.equal(ctx.notifications[0].message.includes(join(commandsDir, "one.md")), true);
        assert.equal(ctx.notifications[0].message.includes("/reload"), true);
    });
});

describe("extension activation", () => {
    let tmpDir: string;
    let agentDir: string;
    let projectDir: string;
    let commandsDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "pi-claude-cmds-"));
        agentDir = join(tmpDir, "agent");
        projectDir = join(tmpDir, "project");
        commandsDir = join(projectDir, ".claude", "commands");
        mkdirSync(agentDir, { recursive: true });
        mkdirSync(commandsDir, { recursive: true });
        mkdirSync(join(projectDir, ".pi"), { recursive: true });
        writeFileSync(join(agentDir, "settings.json"), JSON.stringify({}));
        writeFileSync(join(projectDir, ".pi", "settings.json"), JSON.stringify({ commands: [".claude/commands"] }));
        writeFileSync(join(commandsDir, "one.md"), "---\ndescription: First\n---\nBody one\n");
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it("registers commands when a session starts", async () => {
        const pi = createFakePi();
        activate(pi, () => agentDir);

        await pi.emit("session_start", { type: "session_start", reason: "resume" }, { cwd: projectDir, isProjectTrusted: () => true });

        assert.deepEqual(pi.names(), ["claude-commands", "one"]);
    });

    it("leaves out project commands when a session starts in an untrusted project", async () => {
        const pi = createFakePi();
        activate(pi, () => agentDir);

        await pi.emit("session_start", { type: "session_start", reason: "startup" }, { cwd: projectDir, isProjectTrusted: () => false });
        await pi.emit("resources_discover", { type: "resources_discover", cwd: projectDir, reason: "startup" }, { isProjectTrusted: () => false });

        assert.equal(pi.names().includes("one"), false);
    });

    it("registers commands on a resource discovery pass", async () => {
        const pi = createFakePi();
        activate(pi, () => agentDir);

        await pi.emit("resources_discover", { type: "resources_discover", cwd: projectDir, reason: "reload" }, { isProjectTrusted: () => true });

        assert.deepEqual(pi.names(), ["claude-commands", "one"]);
    });

    it("skips clashing names when refreshing through lifecycle events", async () => {
        const pi = createFakePi([{ name: "one", owner: "/ext/other-extension/index.ts" }]);
        activate(pi, () => agentDir);

        await pi.emit("session_start", { type: "session_start", reason: "startup" }, { cwd: projectDir, isProjectTrusted: () => true });

        assert.equal(pi.names().includes("one"), false);
    });

    it("shows the names another loaded copy skipped in the report", async () => {
        const host = createFakeHost();
        const ctx = createFakeCtx();
        activate(host.load("/ext/first/index.ts") as any, () => agentDir);
        activate(host.load("/ext/second/index.ts") as any, () => agentDir);

        await host.emit("session_start", { type: "session_start", reason: "startup" }, { cwd: projectDir, isProjectTrusted: () => true });
        await host.command("claude-commands").handler("", ctx);

        const report = ctx.notifications[0].message;
        assert.equal(report.startsWith("Claude commands: 1 registered, 1 skipped"), true);
        assert.equal(report.includes("(owned by /ext/first/index.ts)"), true);
    });

    it("counts each copy's skips once when both lifecycle events fire", async () => {
        const host = createFakeHost();
        const ctx = createFakeCtx();
        activate(host.load("/ext/first/index.ts") as any, () => agentDir);
        activate(host.load("/ext/second/index.ts") as any, () => agentDir);

        await host.emit("session_start", { type: "session_start", reason: "startup" }, { cwd: projectDir, isProjectTrusted: () => true });
        await host.emit("resources_discover", { type: "resources_discover", cwd: projectDir, reason: "startup" }, { isProjectTrusted: () => true });
        await host.command("claude-commands").handler("", ctx);

        assert.equal(ctx.notifications[0].message.startsWith("Claude commands: 1 registered, 1 skipped"), true);
    });

    it("keeps a single entry per command name when both lifecycle events fire", async () => {
        const pi = createFakePi();
        activate(pi, () => agentDir);

        await pi.emit("session_start", { type: "session_start", reason: "startup" }, { cwd: projectDir, isProjectTrusted: () => true });
        await pi.emit("resources_discover", { type: "resources_discover", cwd: projectDir, reason: "startup" }, { isProjectTrusted: () => true });

        assert.deepEqual(pi.names(), ["claude-commands", "one"]);
        assert.equal(pi.registrations.filter((name) => name === "one").length, 2);
    });
});

describe("parseCommandDirs", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "pi-claude-cmds-"));
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it("reads command directories from a settings file", () => {
        const settingsPath = join(tmpDir, "settings.json");
        writeFileSync(settingsPath, JSON.stringify({ commands: [".claude/commands"] }));

        const dirs = parseCommandDirs(settingsPath);

        assert.deepEqual(dirs, [".claude/commands"]);
    });

    it("handles missing settings file gracefully", () => {
        const dirs = parseCommandDirs(join(tmpDir, "nonexistent.json"));

        assert.deepEqual(dirs, []);
    });

    it("handles settings without commands key gracefully", () => {
        const settingsPath = join(tmpDir, "settings.json");
        writeFileSync(settingsPath, JSON.stringify({ other: true }));

        const dirs = parseCommandDirs(settingsPath);

        assert.deepEqual(dirs, []);
    });
});

describe("resolveCommandDirs", () => {
    let tmpDir: string;
    let originalHome: string | undefined;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "pi-claude-cmds-"));
        originalHome = process.env.HOME;
    });

    afterEach(() => {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it("resolves a leading tilde against the home directory", () => {
        const home = join(tmpDir, "home");
        const settingsPath = join(tmpDir, "settings.json");
        mkdirSync(join(home, "cmds"), { recursive: true });
        process.env.HOME = home;
        writeFileSync(settingsPath, JSON.stringify({ commands: ["~/cmds"] }));

        const dirs = resolveCommandDirs([{ settingsPath, baseDir: join(tmpDir, "project"), scope: "global" }]);

        assert.deepEqual(dirs, [{ path: join(home, "cmds"), scope: "global" }]);
    });

    it("expands a glob rooted at the home directory", () => {
        const home = join(tmpDir, "home");
        const settingsPath = join(tmpDir, "settings.json");
        mkdirSync(join(home, "plugins", "alpha", "commands"), { recursive: true });
        mkdirSync(join(home, "plugins", "beta", "commands"), { recursive: true });
        process.env.HOME = home;
        writeFileSync(settingsPath, JSON.stringify({ commands: ["~/plugins/*/commands"] }));

        const dirs = resolveCommandDirs([{ settingsPath, baseDir: join(tmpDir, "project"), scope: "global" }]);

        assert.deepEqual(dirs, [
            { path: join(home, "plugins", "alpha", "commands"), scope: "global" },
            { path: join(home, "plugins", "beta", "commands"), scope: "global" },
        ]);
    });

    it("resolves a bare tilde to the home directory", () => {
        const home = join(tmpDir, "home");
        const settingsPath = join(tmpDir, "settings.json");
        mkdirSync(home, { recursive: true });
        process.env.HOME = home;
        writeFileSync(settingsPath, JSON.stringify({ commands: ["~"] }));

        const dirs = resolveCommandDirs([{ settingsPath, baseDir: join(tmpDir, "project"), scope: "global" }]);

        assert.deepEqual(dirs, [{ path: home, scope: "global" }]);
    });

    it("resolves a parent-relative path outside the base directory", () => {
        const projectDir = join(tmpDir, "workspace", "project");
        const settingsPath = join(projectDir, "settings.json");
        mkdirSync(projectDir, { recursive: true });
        mkdirSync(join(tmpDir, "workspace", "team-commands"), { recursive: true });
        writeFileSync(settingsPath, JSON.stringify({ commands: ["../team-commands"] }));

        const dirs = resolveCommandDirs([{ settingsPath, baseDir: projectDir, scope: "project" }]);

        assert.deepEqual(dirs, [{ path: join(tmpDir, "workspace", "team-commands"), scope: "project" }]);
    });

    it("expands a parent-relative glob outside the base directory", () => {
        const projectDir = join(tmpDir, "workspace", "project");
        const sibling = join(tmpDir, "workspace", "playground", "plugins");
        const settingsPath = join(projectDir, "settings.json");
        mkdirSync(projectDir, { recursive: true });
        mkdirSync(join(sibling, "alpha", "commands"), { recursive: true });
        mkdirSync(join(sibling, "group", "beta", "commands"), { recursive: true });
        writeFileSync(settingsPath, JSON.stringify({ commands: ["../playground/**/commands"] }));

        const dirs = resolveCommandDirs([{ settingsPath, baseDir: projectDir, scope: "project" }]);

        assert.deepEqual(dirs, [
            { path: join(sibling, "alpha", "commands"), scope: "project" },
            { path: join(sibling, "group", "beta", "commands"), scope: "project" },
        ]);
    });

    it("keeps a tilde that is not the leading segment literal", () => {
        const settingsPath = join(tmpDir, "settings.json");
        process.env.HOME = join(tmpDir, "home");
        writeFileSync(settingsPath, JSON.stringify({ commands: ["cmds/~backup"] }));

        const dirs = resolveCommandDirs([{ settingsPath, baseDir: tmpDir, scope: "project" }]);

        assert.deepEqual(dirs, [{ path: join(tmpDir, "cmds", "~backup"), scope: "project" }]);
    });

    it("resolves paths relative to each source's base directory", () => {
        const globalDir = join(tmpDir, "global");
        const projectDir = join(tmpDir, "project");
        const projectPiDir = join(projectDir, ".pi");
        mkdirSync(globalDir);
        mkdirSync(projectPiDir, { recursive: true });
        writeFileSync(join(globalDir, "settings.json"), JSON.stringify({ commands: ["commands"] }));
        writeFileSync(join(projectPiDir, "settings.json"), JSON.stringify({ commands: [".claude/commands"] }));

        const dirs = resolveCommandDirs([
            { settingsPath: join(globalDir, "settings.json"), baseDir: globalDir, scope: "global" },
            { settingsPath: join(projectPiDir, "settings.json"), baseDir: projectDir, scope: "project" },
        ]);

        assert.deepEqual(dirs, [
            { path: join(globalDir, "commands"), scope: "global" },
            { path: join(projectDir, ".claude/commands"), scope: "project" },
        ]);
    });

    it("skips missing settings files without failing", () => {
        const settingsPath = join(tmpDir, "settings.json");
        writeFileSync(settingsPath, JSON.stringify({ commands: ["commands"] }));

        const dirs = resolveCommandDirs([
            { settingsPath: join(tmpDir, "missing.json"), baseDir: tmpDir, scope: "global" },
            { settingsPath: settingsPath, baseDir: tmpDir, scope: "project" },
        ]);

        assert.deepEqual(dirs, [{ path: join(tmpDir, "commands"), scope: "project" }]);
    });

    it("expands a wildcard segment into each matching command directory", () => {
        const projectDir = join(tmpDir, "project");
        const settingsPath = join(projectDir, ".pi", "settings.json");
        mkdirSync(join(projectDir, "plugins", "alpha", "commands"), { recursive: true });
        mkdirSync(join(projectDir, "plugins", "beta", "commands"), { recursive: true });
        mkdirSync(join(projectDir, ".pi"), { recursive: true });
        writeFileSync(settingsPath, JSON.stringify({ commands: ["plugins/*/commands"] }));

        const dirs = resolveCommandDirs([{ settingsPath, baseDir: projectDir, scope: "project" }]);

        assert.deepEqual(dirs, [
            { path: join(projectDir, "plugins", "alpha", "commands"), scope: "project" },
            { path: join(projectDir, "plugins", "beta", "commands"), scope: "project" },
        ]);
    });

    it("expands a recursive wildcard across nesting levels", () => {
        const projectDir = join(tmpDir, "project");
        const settingsPath = join(projectDir, ".pi", "settings.json");
        mkdirSync(join(projectDir, "plugins", "commands"), { recursive: true });
        mkdirSync(join(projectDir, "plugins", "alpha", "commands"), { recursive: true });
        mkdirSync(join(projectDir, "plugins", "group", "beta", "commands"), { recursive: true });
        mkdirSync(join(projectDir, ".pi"), { recursive: true });
        writeFileSync(settingsPath, JSON.stringify({ commands: ["plugins/**/commands"] }));

        const dirs = resolveCommandDirs([{ settingsPath, baseDir: projectDir, scope: "project" }]);

        assert.deepEqual(dirs, [
            { path: join(projectDir, "plugins", "alpha", "commands"), scope: "project" },
            { path: join(projectDir, "plugins", "commands"), scope: "project" },
            { path: join(projectDir, "plugins", "group", "beta", "commands"), scope: "project" },
        ]);
    });

    it("ignores glob matches that are files rather than directories", () => {
        const projectDir = join(tmpDir, "project");
        const settingsPath = join(projectDir, ".pi", "settings.json");
        mkdirSync(join(projectDir, "plugins", "alpha", "commands"), { recursive: true });
        mkdirSync(join(projectDir, "plugins", "beta"), { recursive: true });
        writeFileSync(join(projectDir, "plugins", "beta", "commands"), "not a directory");
        mkdirSync(join(projectDir, ".pi"), { recursive: true });
        writeFileSync(settingsPath, JSON.stringify({ commands: ["plugins/*/commands"] }));

        const dirs = resolveCommandDirs([{ settingsPath, baseDir: projectDir, scope: "project" }]);

        assert.deepEqual(dirs, [{ path: join(projectDir, "plugins", "alpha", "commands"), scope: "project" }]);
    });

    it("expands through symlinked plugin directories", () => {
        const projectDir = join(tmpDir, "project");
        const settingsPath = join(projectDir, ".pi", "settings.json");
        const externalPlugin = join(tmpDir, "external", "shared");
        mkdirSync(join(externalPlugin, "commands"), { recursive: true });
        mkdirSync(join(projectDir, "plugins"), { recursive: true });
        symlinkSync(externalPlugin, join(projectDir, "plugins", "shared"));
        mkdirSync(join(projectDir, ".pi"), { recursive: true });
        writeFileSync(settingsPath, JSON.stringify({ commands: ["plugins/**/commands"] }));

        const dirs = resolveCommandDirs([{ settingsPath, baseDir: projectDir, scope: "project" }]);

        assert.deepEqual(dirs, [{ path: join(projectDir, "plugins", "shared", "commands"), scope: "project" }]);
    });

    it("keeps the first scope when a glob match repeats a literal path", () => {
        const projectDir = join(tmpDir, "project");
        const globalSettings = join(tmpDir, "global-settings.json");
        const projectSettings = join(projectDir, ".pi", "settings.json");
        mkdirSync(join(projectDir, "plugins", "alpha", "commands"), { recursive: true });
        mkdirSync(join(projectDir, "plugins", "beta", "commands"), { recursive: true });
        mkdirSync(join(projectDir, ".pi"), { recursive: true });
        writeFileSync(globalSettings, JSON.stringify({ commands: ["plugins/alpha/commands"] }));
        writeFileSync(projectSettings, JSON.stringify({ commands: ["plugins/*/commands"] }));

        const dirs = resolveCommandDirs([
            { settingsPath: globalSettings, baseDir: projectDir, scope: "global" },
            { settingsPath: projectSettings, baseDir: projectDir, scope: "project" },
        ]);

        assert.deepEqual(dirs, [
            { path: join(projectDir, "plugins", "alpha", "commands"), scope: "global" },
            { path: join(projectDir, "plugins", "beta", "commands"), scope: "project" },
        ]);
    });

    it("deduplicates identical resolved paths", () => {
        const file1 = join(tmpDir, "a.json");
        const file2 = join(tmpDir, "b.json");
        writeFileSync(file1, JSON.stringify({ commands: ["commands"] }));
        writeFileSync(file2, JSON.stringify({ commands: ["commands", "other"] }));

        const dirs = resolveCommandDirs([
            { settingsPath: file1, baseDir: tmpDir, scope: "global" },
            { settingsPath: file2, baseDir: tmpDir, scope: "project" },
        ]);

        assert.deepEqual(dirs, [
            { path: join(tmpDir, "commands"), scope: "global" },
            { path: join(tmpDir, "other"), scope: "project" },
        ]);
    });
});
