export function parseFrontmatter(content: string): { description: string; argumentHint: string; body: string } {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return { description: "", argumentHint: "", body: content };

    const frontmatter = match[1];
    const body = match[2];

    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
    const hintMatch = frontmatter.match(/^argument-hint:\s*(.+)$/m);
    return {
        description: descMatch?.[1]?.trim() ?? "",
        argumentHint: unquote(hintMatch?.[1]?.trim() ?? ""),
        body,
    };
}

/** Claude Code files write the hint both with and without YAML quotes around it. */
function unquote(value: string): string {
    const quoted = /^(["'])(.*)\1$/.exec(value);
    return quoted ? quoted[2] : value;
}
