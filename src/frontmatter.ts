export function parseFrontmatter(content: string): {
    description: string;
    argumentHint: string;
    argumentNames: string[];
    body: string;
} {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return { description: "", argumentHint: "", argumentNames: [], body: content };

    const frontmatter = match[1];
    const body = match[2];

    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
    const hintMatch = frontmatter.match(/^argument-hint:\s*(.+)$/m);
    const namesMatch = frontmatter.match(/^arguments:[ \t]*(.+)$/m);
    const namesBlock = frontmatter.match(/^arguments:[ \t]*\r?\n((?:[ \t]+-.*(?:\r?\n|$))+)/m);
    return {
        description: descMatch?.[1]?.trim() ?? "",
        argumentHint: unquote(hintMatch?.[1]?.trim() ?? ""),
        argumentNames: namesBlock ? parseBlockList(namesBlock[1]) : parseArgumentNames(namesMatch?.[1]?.trim() ?? ""),
        body,
    };
}

/** The items of a YAML block list, one "- name" on each line. */
function parseBlockList(lines: string): string[] {
    return lines
        .split(/\r?\n/)
        .map((line) => unquote(line.replace(/^[ \t]+-[ \t]*/, "").trim()))
        .filter(Boolean);
}

/** Claude Code accepts a YAML list, such as [issue, branch], or a space-separated string. */
function parseArgumentNames(value: string): string[] {
    const list = /^\[(.*)\]$/.exec(value);
    const names = list ? list[1].split(",") : value.split(/\s+/);
    return names.map((name) => unquote(name.trim())).filter(Boolean);
}

/** Claude Code files write the hint both with and without YAML quotes around it. */
function unquote(value: string): string {
    const quoted = /^(["'])(.*)\1$/.exec(value);
    return quoted ? quoted[2] : value;
}
