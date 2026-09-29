import { globSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function parseCommandDirs(settingsPath: string): string[] {
    try {
        const content = readFileSync(settingsPath, "utf8");
        const settings = JSON.parse(content);
        const commands = settings.commands;
        if (Array.isArray(commands)) {
            return commands.filter((p: unknown) => typeof p === "string");
        }
    } catch {
        // No settings or parse error
    }
    return [];
}

export interface CommandDirSource {
    settingsPath: string;
    baseDir: string;
    scope: "global" | "project";
}

export interface ResolvedCommandDir {
    path: string;
    scope: "global" | "project";
}

export function resolveCommandDirs(sources: CommandDirSource[]): ResolvedCommandDir[] {
    const seen = new Set<string>();
    const result: ResolvedCommandDir[] = [];

    for (const { settingsPath, baseDir, scope } of sources) {
        for (const dir of parseCommandDirs(settingsPath)) {
            for (const resolved of expandCommandDir(baseDir, dir)) {
                if (!seen.has(resolved)) {
                    seen.add(resolved);
                    result.push({ path: resolved, scope });
                }
            }
        }
    }

    return result;
}

const GLOB_MAGIC = /[*?[\]{}]/;

function expandCommandDir(baseDir: string, configuredDir: string): string[] {
    const dir = expandTilde(configuredDir);
    if (!GLOB_MAGIC.test(dir)) return [resolve(baseDir, dir)];

    // Node skips symlinked directories while expanding "**" unless told otherwise, which would
    // silently drop symlinked plugin folders. Bun follows them either way.
    const matches = globSync(dir, { cwd: baseDir, followSymlinks: true });
    return matches
        .map((match) => resolve(baseDir, match))
        .filter(isDirectory)
        .sort();
}

function expandTilde(dir: string): string {
    if (dir !== "~" && !dir.startsWith("~/")) return dir;
    const home = process.env.HOME ?? homedir();
    return dir === "~" ? home : join(home, dir.slice(2));
}

function isDirectory(path: string): boolean {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}
