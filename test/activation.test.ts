import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { activate } from "../index.ts";
import { createFakeHost, createFakeCtx, createFakePi } from "./fakes.ts";

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
