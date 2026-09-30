# pi-claude-commands

A [pi](https://github.com/earendil-works/pi) package that bridges [Claude Code](https://docs.anthropic.com/en/docs/claude-code) commands into pi as slash commands, preserving the folder structure as hierarchical command names.

```
.claude/commands/jira/plan.md         → /jira/plan
.claude/commands/jira/assess-risks.md → /jira/assess-risks
.claude/commands/deploy.md            → /deploy
```

This lets teams share the same command files between Claude Code and pi without duplication.

## Requirements

- pi >= 0.79.1 (on older versions the extension loads no commands)

## Install

```bash
pi install git:github.com/jvortmann/pi-claude-commands
```

### From a local checkout

Give pi the checkout directory:

```bash
pi install /path/to/pi-claude-commands   # every session, loads the files where they are
pi -e /path/to/pi-claude-commands        # this run only
```

Run `/reload` after an edit. To link the checkout into an extensions folder, link the directory,
not `index.ts`. The entry file loads its modules from `src/` next to it.

## Setup

Add a `commands` array to your project's `.pi/settings.json` pointing to directories containing `.md` command files:

```json
{
    "commands": [".claude/commands"]
}
```

Multiple directories are supported:

```json
{
    "commands": [".claude/commands", ".team/commands"]
}
```

### Project trust

pi reads project settings only after you trust the project, and this extension follows the same
rule. In a project that you did not trust, it loads only the commands from your global settings.
Run `/trust` to trust the project, then restart pi.

### Path resolution

Relative entries resolve against your project root, or against the agent directory for entries in
the global `settings.json`. Absolute paths, parent-relative paths such as `../sibling-repo/commands`
and a leading `~` are all supported.

### Glob patterns

Entries containing `*`, `?`, `[]` or `{}` expand to every matching directory, which is handy for
plugin layouts where each plugin ships its own commands folder:

```json
{
    "commands": ["plugins/*/commands", "skills-playground/plugins/**/commands"]
}
```

`**` matches any depth, including none — `plugins/**/commands` also matches `plugins/commands`.
Symlinked directories are followed, matches that are not directories are ignored, and a pattern
that matches nothing is simply skipped. Directories are rescanned on `/reload` and whenever a
session starts or resumes, so plugins added mid-session show up after a reload.

## Command format

Command files use the same format as Claude Code — markdown with optional frontmatter:

```markdown
---
description: Analyze a Jira ticket and create an implementation plan
---

# Plan

Analyze the given Jira ticket and create a comprehensive implementation plan.

## Usage

/jira/plan AUD-2157
```

Autocomplete shows the `description` field from frontmatter. An optional `argument-hint`, such as
`"<ticket-id> [priority]"`, shows after the description.

### Arguments

The command body fills in arguments the same way Claude Code does. Positions count from 0:

| Placeholder | Result |
|---|---|
| `$ARGUMENTS` | The text after the command name, as you typed it |
| `$0`, `$1`, … or `$ARGUMENTS[0]`, `$ARGUMENTS[1]`, … | One argument. With no argument at that position, the placeholder stays as it is |
| `$name` | The argument at the position of `name` in the `arguments` field. Empty when there is none |

The `arguments` field takes a list, such as `arguments: [issue, branch]`, or names with spaces
between them, such as `arguments: issue branch`. With that field, `$issue` is the first argument
and `$branch` the second.

Quotes keep words together, so `/review "API compatibility" high` gives two arguments. When no
placeholder receives an argument, the arguments go after the body as `ARGUMENTS: <arguments>`, so
the model still sees them.

pi prompt templates add these forms. They also count from 0:

| Placeholder | Result |
|---|---|
| `$@` | All arguments, with one space between them |
| `${0:-default}` | The first argument, or the default when it is missing |
| `${@:-default}` | All arguments, or the default when there are none |
| `${@:N}` | The arguments from position `N` |
| `${@:N:L}` | `L` arguments from position `N` |

## Name clashes

If another extension or prompt already uses a command name, that name is skipped, so `/name` keeps
its meaning instead of splitting into `/name:1` and `/name:2`. Run `/claude-commands` to list the
commands that were registered and the names that were skipped, with the source that owns each one.

The extension also skips the names of pi's own commands, such as `/compact`, `/model` and `/debug`.
The pi terminal UI runs its own command first, so a command file with one of these names never
runs. Rename the file to use it.

## License

MIT
