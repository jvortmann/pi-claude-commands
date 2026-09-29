/**
 * Fills the argument placeholders that Claude Code commands and pi prompt templates share. A body
 * without placeholders gets the arguments added after it.
 */
export function buildPrompt(body: string, args: string): string {
    if (!PLACEHOLDER.test(body)) return args ? `${body}\n\nUser: ${args}` : body;

    const values = splitArguments(args);
    const all = values.join(" ");
    return body.replace(
        new RegExp(PLACEHOLDER, "g"),
        (_match, defaultOf?: string, fallback?: string, sliceStart?: string, sliceLength?: string, name?: string) => {
            if (defaultOf !== undefined) {
                const value = defaultOf === "@" || defaultOf === "ARGUMENTS" ? all : values[Number(defaultOf) - 1];
                return value || fallback!;
            }
            if (sliceStart !== undefined) {
                // Positions count from 1, and bash reads 0 as 1.
                const start = Math.max(Number(sliceStart) - 1, 0);
                const end = sliceLength === undefined ? undefined : start + Number(sliceLength);
                return values.slice(start, end).join(" ");
            }
            if (name === "@" || name === "ARGUMENTS") return all;
            return values[Number(name) - 1] ?? "";
        },
    );
}

/**
 * The placeholders that pi prompt templates support. The order matches substituteArgs in pi's
 * core/prompt-templates (0.99.1): a default, a slice, then a plain name or position. The body is
 * replaced once, so an argument that contains a placeholder stays literal.
 */
const PLACEHOLDER = /\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/;

/**
 * Splits on whitespace, and single or double quotes group words into one argument. Mirrors
 * parseCommandArgs in pi's core/prompt-templates (0.99.1), which pi does not export.
 */
function splitArguments(input: string): string[] {
    const values: string[] = [];
    let current = "";
    let quote: string | undefined;

    for (const char of input) {
        if (quote) {
            if (char === quote) quote = undefined;
            else current += char;
        } else if (char === '"' || char === "'") {
            quote = char;
        } else if (/\s/.test(char)) {
            if (current) values.push(current);
            current = "";
        } else {
            current += char;
        }
    }

    if (current) values.push(current);
    return values;
}
