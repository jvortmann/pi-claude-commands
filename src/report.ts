export const REPORT_COMMAND = "claude-commands";

export const REPORT_CHANNEL = "claude-commands:report";

export interface RegistrationReport {
    registered: { name: string; path: string }[];
    skipped: { name: string; path: string; owner: string }[];
}

export function mergeReports(reports: RegistrationReport[]): RegistrationReport {
    return {
        registered: reports.flatMap((report) => report.registered),
        skipped: reports.flatMap((report) => report.skipped),
    };
}

export function formatReport(report: RegistrationReport): string {
    const lines = [`Claude commands: ${report.registered.length} registered, ${report.skipped.length} skipped`];

    if (report.registered.length > 0) {
        lines.push("", "Registered:");
        for (const cmd of report.registered) lines.push(`  /${cmd.name} - ${cmd.path}`);
    }

    if (report.skipped.length > 0) {
        lines.push("", "Skipped, name already taken:");
        for (const cmd of report.skipped) lines.push(`  /${cmd.name} - ${cmd.path} (owned by ${cmd.owner})`);
    }

    return lines.join("\n");
}
