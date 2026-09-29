import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { parseFrontmatter } from "./frontmatter.ts";

export interface CommandFile {
    /** Command name, e.g. "jira/plan" or "deploy" */
    name: string;
    /** Absolute path to the .md file */
    path: string;
    /** Parsed description from frontmatter */
    description: string;
    /** The arguments the command expects, such as "<ticket-id> [priority]" */
    argumentHint: string;
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
            const { description, argumentHint } = parseFrontmatter(content);

            commands.push({
                name: commandName,
                path: entryPath,
                description,
                argumentHint,
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

export function readCommandFile(path: string): string | undefined {
    try {
        return readFileSync(path, "utf8");
    } catch {
        return undefined;
    }
}
