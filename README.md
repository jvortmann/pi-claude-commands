# pi-claude-commands

A [pi](https://github.com/badlogic/pi-mono) package that bridges [Claude Code](https://docs.anthropic.com/en/docs/claude-code) commands into pi as slash commands, preserving the folder structure as hierarchical command names.

```
.claude/commands/jira/plan.md         → /jira/plan
.claude/commands/jira/assess-risks.md → /jira/assess-risks
.claude/commands/deploy.md            → /deploy
```

This lets teams share the same command files between Claude Code and pi without duplication.

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

## License

MIT
