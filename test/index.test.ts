import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseFrontmatter, discoverCommands, parseCommandDirs, resolveCommandDirs } from "../index";

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

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "pi-claude-cmds-"));
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
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
