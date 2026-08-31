/**
 * Claude Commands Bridge
 *
 * Registers .md files from configured "commands" directories as pi slash commands,
 * preserving subfolder structure as hierarchical command names.
 *
 * Example: .claude/commands/jira/plan.md → /jira/plan
 *
 * Configure in .pi/settings.json:
 *   { "commands": [".claude/commands"] }
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { globSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

interface CommandFile {
    /** Command name, e.g. "jira/plan" or "deploy" */
    name: string;
    /** Absolute path to the .md file */
    path: string;
    /** Parsed description from frontmatter */
    description: string;
}

export function parseFrontmatter(content: string): { description: string; body: string } {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return { description: "", body: content };

    const frontmatter = match[1];
    const body = match[2];

    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
    return {
        description: descMatch?.[1]?.trim() ?? "",
        body,
    };
}

export function discoverCommands(baseDir: string, currentDir: string, prefix: string): CommandFile[] {
    const commands: CommandFile[] = [];

    let entries: ReturnType<typeof readdirSync>;
    try {
        entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
        return commands;
    }

    for (const entry of entries) {
        const entryPath = join(currentDir, entry.name);

        if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".md")) {
            const name = basename(entry.name, extname(entry.name));
            const commandName = prefix ? `${prefix}/${name}` : name;
            const content = readFileSync(entryPath, "utf8");
            const { description } = parseFrontmatter(content);

            commands.push({
                name: commandName,
                path: entryPath,
                description,
            });
        } else if (entry.isDirectory() || entry.isSymbolicLink()) {
            try {
                if (statSync(entryPath).isDirectory()) {
                    const subPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
                    commands.push(...discoverCommands(baseDir, entryPath, subPrefix));
                }
            } catch {
                // Skip unreadable directories
            }
        }
    }

    return commands;
}

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

interface CommandDirSource {
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

function readCommandFile(path: string): string | undefined {
    try {
        return readFileSync(path, "utf8");
    } catch {
        return undefined;
    }
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

/** Everything a registration pass needs from pi, kept narrow so tests can drive it. */
type CommandRegistrar = Pick<ExtensionAPI, "registerCommand" | "sendUserMessage">;

/**
 * Scan the configured directories and register what is on disk right now. Runs on every discovery
 * pass so files added, changed or removed during a session are picked up by /reload and by session
 * restarts.
 */
export function registerCommands(pi: CommandRegistrar, options: { cwd: string; agentDir: string }): void {
    const { cwd, agentDir } = options;
    const sources: CommandDirSource[] = [
        { settingsPath: join(agentDir, "settings.json"), baseDir: agentDir, scope: "global" },
        { settingsPath: join(cwd, ".pi", "settings.json"), baseDir: cwd, scope: "project" },
    ];

    for (const { path: dir, scope } of resolveCommandDirs(sources)) {
        const tag = scope === "global" ? "[g]" : "[p]";

        for (const cmd of discoverCommands(dir, dir, "")) {
            const fallback = `Claude command: ${cmd.name}`;
            pi.registerCommand(cmd.name, {
                description: `${tag} ${cmd.description || fallback}`,
                handler: async (args, ctx) => {
                    // Read at invocation so edits apply immediately, which also means the file may
                    // be gone: pi has no way to unregister a command once its file disappears.
                    const content = readCommandFile(cmd.path);
                    if (content === undefined) {
                        ctx.ui.notify(`Command file is gone: ${cmd.path} — run /reload to refresh.`, "error");
                        return;
                    }

                    const { body } = parseFrontmatter(content);
                    const prompt = args ? `${body}\n\nUser: ${args}` : body;
                    pi.sendUserMessage(prompt);
                },
            });
        }
    }
}

/**
 * Refresh on both events: pi re-emits "resources_discover" on /reload and on session switches, and
 * "session_start" covers any host that starts a session without a discovery pass.
 */
export function activate(pi: ExtensionAPI, resolveAgentDir: () => string | Promise<string>): void {
    const refresh = async (cwd: string) => registerCommands(pi, { cwd, agentDir: await resolveAgentDir() });

    pi.on("resources_discover", async (event) => {
        await refresh(event.cwd);
    });

    pi.on("session_start", async (_event, ctx) => {
        await refresh(ctx.cwd);
    });
}

export default function (pi: ExtensionAPI) {
    activate(pi, async () => (await import("@mariozechner/pi-coding-agent")).getAgentDir());
}
