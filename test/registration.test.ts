import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerCommands } from "../src/registration.ts";
import { createCommandRegistry, createFakeCtx, createFakePi } from "./fakes.ts";

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

    it("shows the argument hint after the description", () => {
        const pi = createFakePi();
        writeFileSync(join(commandsDir, "plan.md"), '---\ndescription: Plan a ticket\nargument-hint: "<ticket-id> [priority]"\n---\nBody\n');
        writeFileSync(join(commandsDir, "triage.md"), "---\ndescription: Triage\nargument-hint: [owner]\n---\nBody\n");

        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        assert.equal(pi.commands.get("plan")?.description, "[p] Plan a ticket <ticket-id> [priority]");
        assert.equal(pi.commands.get("triage")?.description, "[p] Triage [owner]");
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
