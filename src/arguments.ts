/**
 * Fills the argument placeholders the way Claude Code does, plus the extra forms that pi prompt
 * templates support. When no placeholder receives an argument, Claude Code appends the arguments
 * after the body, so the model still sees them.
 */
export function buildPrompt(body: string, args: string, names: string[] = []): string {
    const values = splitArguments(args);
    const all = values.join(" ");
    // Claude Code passes $ARGUMENTS on as typed; pi's $@ joins the split words.
    const typed = args.trim();
    let received = false;
    const take = (value: string | undefined) => {
        if (value) received = true;
        return value;
    };

    const filled = body.replace(
        new RegExp(PLACEHOLDER, "g"),
        (
            match: string,
            defaultOf?: string,
            fallback?: string,
            sliceStart?: string,
            sliceLength?: string,
            index?: string,
            name?: string,
            named?: string,
        ) => {
            if (defaultOf !== undefined) {
                const value = defaultOf === "ARGUMENTS" ? typed : defaultOf === "@" ? all : values[Number(defaultOf)];
                return take(value) || fallback!;
            }
            if (sliceStart !== undefined) {
                // Every number counts from 0, like $0 in Claude Code, so ${@:1} starts at the second argument.
                const start = Number(sliceStart);
                const end = sliceLength === undefined ? undefined : start + Number(sliceLength);
                return take(values.slice(start, end).join(" ")) ?? "";
            }
            // Claude Code keeps a position that has no argument as literal text.
            if (index !== undefined) return take(values[Number(index)]) ?? match;
            if (name === "ARGUMENTS") return take(typed) ?? "";
            if (name === "@") return take(all) ?? "";
            if (name !== undefined) return take(values[Number(name)]) ?? match;
            // A declared name counts as receiving an argument even when its position is empty.
            const position = names.indexOf(named!);
            if (position < 0) return match;
            received = true;
            return values[position] ?? "";
        },
    );

    return typed && !received ? `${filled}\n\nARGUMENTS: ${typed}` : filled;
}

/**
 * The match tries the pi forms first, a default such as ${0:-text} and a range such as ${@:1:2}.
 * Then it tries Claude Code's $ARGUMENTS[N], then $ARGUMENTS, $@ or $N, and last a $name from the
 * arguments list. buildPrompt replaces the body once, so an argument that contains a placeholder
 * stays literal.
 */
const PLACEHOLDER =
    /\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$ARGUMENTS\[(\d+)\]|\$(ARGUMENTS|@|\d+)|\$([A-Za-z_]\w*)/;

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
