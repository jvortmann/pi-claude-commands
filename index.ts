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

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { registerCommands } from "./src/registration.ts";
import { REPORT_CHANNEL, type RegistrationReport } from "./src/report.ts";

/**
 * Refresh on both events: pi re-emits "resources_discover" on /reload and on session switches, and
 * "session_start" covers any host that starts a session without a discovery pass.
 */
export function activate(pi: ExtensionAPI, resolveAgentDir: () => string | Promise<string>): void {
    // Names this instance owns, so later passes refresh them instead of reading them as a clash.
    const owned = new Set<string>();
    // When the extension loads twice, the copy that skips names also loses /claude-commands, so each
    // copy publishes its report and the copy that owns the command shows all of them.
    const id = randomUUID();
    const peers = new Map<string, RegistrationReport>();
    pi.events.on(REPORT_CHANNEL, (data) => {
        const message = data as { id: string; report: RegistrationReport };
        if (message.id !== id) peers.set(message.id, message.report);
    });

    const refresh = async (cwd: string, projectTrusted: boolean) => {
        const report = registerCommands(pi, {
            cwd,
            agentDir: await resolveAgentDir(),
            projectTrusted,
            owned,
            peerReports: () => [...peers.values()],
        });
        pi.events.emit(REPORT_CHANNEL, { id, report });
    };

    pi.on("resources_discover", async (event, ctx) => {
        await refresh(event.cwd, ctx.isProjectTrusted());
    });

    pi.on("session_start", async (_event, ctx) => {
        await refresh(ctx.cwd, ctx.isProjectTrusted());
    });
}

export default function (pi: ExtensionAPI) {
    activate(pi, async () => (await import("@earendil-works/pi-coding-agent")).getAgentDir());
}
