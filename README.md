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

The `description` field from frontmatter is used for autocomplete hints. Arguments passed after the command name are appended to the prompt.

## Name clashes

If another extension or prompt already uses a command name, that name is skipped, so `/name` keeps
its meaning instead of splitting into `/name:1` and `/name:2`. Run `/claude-commands` to list the
commands that were registered and the names that were skipped, with the source that owns each one.

The extension also skips the names of pi's own commands, such as `/compact`, `/model` and `/debug`.
The pi terminal UI runs its own command first, so a command file with one of these names never
runs. Rename the file to use it.

## License

MIT
