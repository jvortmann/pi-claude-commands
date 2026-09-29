# Changelog

## v2.0

### Breaking changes

- The extension needs pi >= 0.74.0, the first release that pi publishes as `@earendil-works/pi-coding-agent`. On older pi the extension loads no commands

### Features

- Accept glob patterns in the `commands` setting, such as `plugins/*/commands` and `plugins/**/commands`. Each pattern expands to every matching directory, and symlinked directories count
- Refresh the command list when a session starts, as well as on each discovery pass. A host that starts a session without a discovery pass now also picks up command files that changed
- Skip a command name that another extension or prompt already owns, so `/name` keeps its meaning. Before, pi split the name into `/name:1` and `/name:2`, and `/name` stopped working
- Add `/claude-commands`, which lists the registered commands and the skipped names with the source that owns each one. When the extension loads twice, the report also shows the names that the other copy skipped

### Fixes

- Resolve a leading `~` in the `commands` setting against the home directory. Before, the extension read it as a directory named `~` and loaded no commands from it
- Report a command whose file moved or disappeared after registration, and point at `/reload`. Before, the command failed with a raw `ENOENT` error

## v1.0

Initial release of the Claude Code commands bridge for pi.

- Register each `.md` file in the directories that the `commands` setting lists as a slash command
- Keep the folder structure in the command name, so `jira/plan.md` becomes `/jira/plan`
- Read the `commands` setting from the global and the project `settings.json`, and tag each command `[g]` or `[p]`
- Show the frontmatter `description` in autocomplete, and add the command arguments to the prompt
