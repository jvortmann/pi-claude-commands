import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverCommands } from "../src/command-files.ts";

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
