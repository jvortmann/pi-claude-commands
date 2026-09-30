# Changelog

## v3.0

### Breaking changes

- The extension needs pi >= 0.79.1, the first release that tells an extension whether the user trusts the project. On older pi the extension loads no commands
- A command body without placeholders now gets the arguments after it as `ARGUMENTS: <arguments>`, the way Claude Code adds them. Before, the extension wrote `User: <arguments>`
- `index.ts` now loads its modules from `src/` next to it, so a link to `index.ts` alone no longer loads. Link the directory, or use `pi install` with the checkout directory

### Features

- Fill argument placeholders the way Claude Code does: `$ARGUMENTS` as typed, `$0`, `$1` and `$ARGUMENTS[N]` counted from 0, and `$name` from the `arguments` field. A position with no argument stays as it is
- Support the extra placeholders of pi prompt templates: `$@`, `${0:-default}`, `${@:-default}`, `${@:N}` and `${@:N:L}`. Their numbers count from 0 as well
- Show the `argument-hint` from the frontmatter after the description

### Refactoring

- Split `index.ts` into modules under `src/`, one for each concern, with a test file for each module
- Run the tests with `node --test` instead of `tsx`

### Fixes

- Queue a command that runs while the agent works, and send it when the run ends. Before, pi rejected the prompt and it was lost
- Load project commands only in a project that the user trusts, the way pi reads project settings. Before, a global install read the project commands in every project
- Skip the names of pi's own commands, such as `/compact`, `/model` and `/debug`, and list them in `/claude-commands`. Before, such a command registered but never ran in the terminal UI
- Read an empty `description` or `argument-hint` line as empty. Before, the field took the next line as its value

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
