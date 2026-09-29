import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseCommandDirs, resolveCommandDirs } from "../src/command-dirs.ts";

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
