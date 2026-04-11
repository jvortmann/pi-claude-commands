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
import { readdirSync, readFileSync, statSync } from "node:fs";
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
            const resolved = resolve(baseDir, dir);
            if (!seen.has(resolved)) {
                seen.add(resolved);
                result.push({ path: resolved, scope });
            }
        }
    }

    return result;
}

export default function (pi: ExtensionAPI) {
    pi.on("resources_discover", async (event) => {
        const { getAgentDir } = await import("@mariozechner/pi-coding-agent");
        const agentDir = getAgentDir();
        const sources: CommandDirSource[] = [
            { settingsPath: join(agentDir, "settings.json"), baseDir: agentDir, scope: "global" },
            { settingsPath: join(event.cwd, ".pi", "settings.json"), baseDir: event.cwd, scope: "project" },
        ];
        const commandDirs = resolveCommandDirs(sources);

        for (const { path: dir, scope } of commandDirs) {
            const commands = discoverCommands(dir, dir, "");
            const tag = scope === "global" ? "[g]" : "[p]";

            for (const cmd of commands) {
                const fallback = `Claude command: ${cmd.name}`;
                pi.registerCommand(cmd.name, {
                    description: `${tag} ${cmd.description || fallback}`,
                    handler: async (args, ctx) => {
                        const content = readFileSync(cmd.path, "utf8");
                        const { body } = parseFrontmatter(content);
                        const prompt = args ? `${body}\n\nUser: ${args}` : body;
                        pi.sendUserMessage(prompt);
                    },
                });
            }
        }
    });
}
