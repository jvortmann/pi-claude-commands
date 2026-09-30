import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { buildPrompt } from "./arguments.ts";
import { type CommandDirSource, resolveCommandDirs } from "./command-dirs.ts";
import { discoverCommands, readCommandFile } from "./command-files.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import { formatReport, mergeReports, REPORT_COMMAND, type RegistrationReport } from "./report.ts";

/**
 * Names the pi terminal UI handles itself, before it looks at extension commands, so an extension
 * command with one of these names never runs there. pi does not export this list, and
 * pi.getCommands() leaves the built-ins out. Taken from the pi 0.99.1 interactive mode, including
 * the names it handles without listing them in its own help.
 */
const PI_BUILT_IN_COMMANDS = [
    "arminsayshi", "bug", "changelog", "clone", "compact", "copy", "debug", "dementedelves", "export",
    "fork", "hotkeys", "import", "login", "logout", "model", "name", "new", "quit", "reload", "resume",
    "scoped-models", "session", "settings", "share", "thinking", "tree", "trust",
];

function builtInOwners(): Map<string, string> {
    return new Map(PI_BUILT_IN_COMMANDS.map((name) => [name, "pi built-in"]));
}

/**
 * Names already taken by someone else. Commands this instance registered on an earlier pass are
 * excluded, otherwise a refresh would mistake its own entries for a clash and stop updating them.
 */
function findForeignOwners(pi: CommandRegistrar, owned: Set<string>): Map<string, string> {
    const owners = new Map<string, string>();
    for (const command of pi.getCommands()) {
        if (owned.has(command.name)) continue;
        owners.set(command.name, command.sourceInfo?.path ?? "unknown source");
    }
    return owners;
}

/** Everything a registration pass needs from pi, kept narrow so tests can drive it. */
export type CommandRegistrar = Pick<ExtensionAPI, "registerCommand" | "sendUserMessage" | "getCommands">;

/**
 * Scan the configured directories and register what is on disk right now. Runs on every discovery
 * pass so files added, changed or removed during a session are picked up by /reload and by session
 * restarts.
 */
export function registerCommands(
    pi: CommandRegistrar,
    options: {
        cwd: string;
        agentDir: string;
        projectTrusted: boolean;
        owned?: Set<string>;
        peerReports?: () => RegistrationReport[];
    },
): RegistrationReport {
    const { cwd, agentDir, projectTrusted, owned, peerReports } = options;
    const sources: CommandDirSource[] = [
        { settingsPath: join(agentDir, "settings.json"), baseDir: agentDir, scope: "global" },
    ];
    // Command bodies are prompts for the model, and pi reads project settings only once the user
    // trusts the project. Anything but an explicit yes leaves the project commands out.
    if (projectTrusted === true) {
        sources.push({ settingsPath: join(cwd, ".pi", "settings.json"), baseDir: cwd, scope: "project" });
    }
    const foreignOwners = new Map([...builtInOwners(), ...(owned ? findForeignOwners(pi, owned) : [])]);
    const report: RegistrationReport = { registered: [], skipped: [] };

    for (const { path: dir, scope } of resolveCommandDirs(sources)) {
        const tag = scope === "global" ? "[g]" : "[p]";

        for (const cmd of discoverCommands(dir, dir, "")) {
            const owner = foreignOwners.get(cmd.name);
            if (owner !== undefined) {
                report.skipped.push({ name: cmd.name, path: cmd.path, owner });
                continue;
            }

            owned?.add(cmd.name);
            report.registered.push({ name: cmd.name, path: cmd.path });
            const fallback = `Claude command: ${cmd.name}`;
            pi.registerCommand(cmd.name, {
                description: [tag, cmd.description || fallback, cmd.argumentHint].filter(Boolean).join(" "),
                handler: async (args, ctx) => {
                    // Read at invocation so edits apply immediately, which also means the file may
                    // be gone: pi has no way to unregister a command once its file disappears.
                    const content = readCommandFile(cmd.path);
                    if (content === undefined) {
                        ctx.ui.notify(`Command file is gone: ${cmd.path} — run /reload to refresh.`, "error");
                        return;
                    }

                    const { body, argumentNames } = parseFrontmatter(content);
                    const prompt = buildPrompt(body, args, argumentNames);
                    // pi runs commands at once, even mid-run, and rejects a prompt that arrives
                    // then without a delivery mode. pi ignores the mode when the agent is idle.
                    pi.sendUserMessage(prompt, { deliverAs: "followUp" });
                },
            });
        }
    }

    if (!foreignOwners.has(REPORT_COMMAND)) {
        owned?.add(REPORT_COMMAND);
        pi.registerCommand(REPORT_COMMAND, {
            description: "List Claude commands that were registered and those skipped as duplicates",
            handler: async (_args, ctx) => {
                ctx.ui.notify(formatReport(mergeReports([report, ...(peerReports?.() ?? [])])), "info");
            },
        });
    }

    return report;
}
