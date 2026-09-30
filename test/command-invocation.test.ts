import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerCommands } from "../src/registration.ts";
import { createFakeCtx, createFakePi } from "./fakes.ts";

describe("command invocation", () => {
    let tmpDir: string;
    let agentDir: string;
    let projectDir: string;
    let commandsDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "pi-claude-cmds-"));
        agentDir = join(tmpDir, "agent");
        projectDir = join(tmpDir, "project");
        commandsDir = join(projectDir, ".claude", "commands");
        mkdirSync(agentDir, { recursive: true });
        mkdirSync(commandsDir, { recursive: true });
        mkdirSync(join(projectDir, ".pi"), { recursive: true });
        writeFileSync(join(agentDir, "settings.json"), JSON.stringify({}));
        writeFileSync(join(projectDir, ".pi", "settings.json"), JSON.stringify({ commands: [".claude/commands"] }));
        writeFileSync(join(commandsDir, "one.md"), "---\ndescription: First\n---\nBody one\n");
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it("sends the command body as a user message", async () => {
        const pi = createFakePi();
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        await pi.commands.get("one")!.handler("", createFakeCtx());

        assert.deepEqual(pi.sentMessages, ["Body one\n"]);
    });

    it("appends arguments below the command body", async () => {
        const pi = createFakePi();
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        await pi.commands.get("one")!.handler("AUD-2157", createFakeCtx());

        assert.deepEqual(pi.sentMessages, ["Body one\n\n\nARGUMENTS: AUD-2157"]);
    });

    it("appends the arguments when no placeholder receives one", async () => {
        const pi = createFakePi();
        writeFileSync(join(commandsDir, "fix.md"), "---\ndescription: Fix\n---\nFix $1\n");
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        await pi.commands.get("fix")!.handler("AUD-1", createFakeCtx());

        assert.deepEqual(pi.sentMessages, ["Fix $1\n\n\nARGUMENTS: AUD-1"]);
    });

    it("replaces $ARGUMENTS with the arguments instead of appending them", async () => {
        const pi = createFakePi();
        writeFileSync(join(commandsDir, "plan.md"), "---\ndescription: Plan\n---\nPlan ticket $ARGUMENTS now\n");
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        await pi.commands.get("plan")!.handler("AUD-2157 urgent", createFakeCtx());

        assert.deepEqual(pi.sentMessages, ["Plan ticket AUD-2157 urgent now\n"]);
    });

    it("counts positional placeholders from 0, like Claude Code", async () => {
        const pi = createFakePi();
        writeFileSync(join(commandsDir, "assign.md"), "---\ndescription: Assign\n---\nGive $0 to $1\n");
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        await pi.commands.get("assign")!.handler("AUD-2157 alice", createFakeCtx());

        assert.deepEqual(pi.sentMessages, ["Give AUD-2157 to alice\n"]);
    });

    it("passes $ARGUMENTS on as typed, quotes included", async () => {
        const pi = createFakePi();
        writeFileSync(join(commandsDir, "plan.md"), "---\ndescription: Plan\n---\nPlan $ARGUMENTS\n");
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        await pi.commands.get("plan")!.handler(`"API compatibility" urgent`, createFakeCtx());

        assert.deepEqual(pi.sentMessages, ['Plan "API compatibility" urgent\n']);
    });

    it("reads single arguments through $ARGUMENTS[N]", async () => {
        const pi = createFakePi();
        writeFileSync(join(commandsDir, "migrate.md"), "---\ndescription: Migrate\n---\nMigrate the $ARGUMENTS[0] component from $ARGUMENTS[1] to $ARGUMENTS[2].\n");
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        await pi.commands.get("migrate")!.handler("SearchBar JavaScript TypeScript", createFakeCtx());

        assert.deepEqual(pi.sentMessages, ["Migrate the SearchBar component from JavaScript to TypeScript.\n"]);
    });

    it("keeps a position with no argument as literal text", async () => {
        const pi = createFakePi();
        writeFileSync(join(commandsDir, "fix.md"), "---\ndescription: Fix\n---\nFix $0 on $1 and $ARGUMENTS[2]\n");
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        await pi.commands.get("fix")!.handler("AUD-1", createFakeCtx());

        assert.deepEqual(pi.sentMessages, ["Fix AUD-1 on $1 and $ARGUMENTS[2]\n"]);
    });

    it("fills named placeholders from the arguments list in order", async () => {
        const pi = createFakePi();
        writeFileSync(join(commandsDir, "fix.md"), "---\ndescription: Fix\narguments: [issue, branch]\n---\nFix $issue on $branch\n");
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        await pi.commands.get("fix")!.handler("123 main", createFakeCtx());

        assert.deepEqual(pi.sentMessages, ["Fix 123 on main\n"]);
    });

    it("reads the arguments list written as a space-separated string", async () => {
        const pi = createFakePi();
        writeFileSync(join(commandsDir, "fix.md"), "---\ndescription: Fix\narguments: issue branch\n---\nFix $issue on $branch\n");
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        await pi.commands.get("fix")!.handler("123 main", createFakeCtx());

        assert.deepEqual(pi.sentMessages, ["Fix 123 on main\n"]);
    });

    it("leaves a named placeholder with no argument empty, without appending", async () => {
        const pi = createFakePi();
        writeFileSync(join(commandsDir, "fix.md"), "---\ndescription: Fix\narguments: [branch, issue]\n---\nFix issue $issue\n");
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        await pi.commands.get("fix")!.handler("main", createFakeCtx());

        assert.deepEqual(pi.sentMessages, ["Fix issue \n"]);
    });

    it("keeps a $word that the arguments list does not declare", async () => {
        const pi = createFakePi();
        writeFileSync(join(commandsDir, "fix.md"), "---\ndescription: Fix\narguments: [issue]\n---\nUse $HOME for $issue_id and $issue\n");
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        await pi.commands.get("fix")!.handler("7", createFakeCtx());

        assert.deepEqual(pi.sentMessages, ["Use $HOME for $issue_id and 7\n"]);
    });

    it("reads the arguments list written as a YAML block list", async () => {
        const pi = createFakePi();
        writeFileSync(join(commandsDir, "fix.md"), "---\ndescription: Fix\narguments:\n  - issue\n  - branch\n---\nFix $issue on $branch\n");
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        await pi.commands.get("fix")!.handler("123 main", createFakeCtx());

        assert.deepEqual(pi.sentMessages, ["Fix 123 on main\n"]);
    });

    it("keeps a quoted argument together as one argument", async () => {
        const pi = createFakePi();
        writeFileSync(join(commandsDir, "assign.md"), "---\ndescription: Assign\n---\nFocus: $0. Owner: $1\n");
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        await pi.commands.get("assign")!.handler(`"API compatibility" 'Ana Lima'`, createFakeCtx());

        assert.deepEqual(pi.sentMessages, ["Focus: API compatibility. Owner: Ana Lima\n"]);
    });

    it("uses the default value when a positional argument is missing", async () => {
        const pi = createFakePi();
        writeFileSync(join(commandsDir, "review.md"), "---\ndescription: Review\n---\nFocus on ${0:-correctness and security}.\n");
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        await pi.commands.get("review")!.handler("", createFakeCtx());
        await pi.commands.get("review")!.handler("speed", createFakeCtx());

        assert.deepEqual(pi.sentMessages, ["Focus on correctness and security.\n", "Focus on speed.\n"]);
    });

    it("selects all arguments or a range of them", async () => {
        const pi = createFakePi();
        writeFileSync(join(commandsDir, "triage.md"), "---\ndescription: Triage\n---\nOwner $0; rest ${@:1}; next two ${@:1:2}; all $@\n");
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        await pi.commands.get("triage")!.handler("ana bo cy di", createFakeCtx());

        assert.deepEqual(pi.sentMessages, ["Owner ana; rest bo cy di; next two bo cy; all ana bo cy di\n"]);
    });

    it("uses the default value when no arguments are given", async () => {
        const pi = createFakePi();
        writeFileSync(join(commandsDir, "scan.md"), "---\ndescription: Scan\n---\nScan ${@:-the whole repository}\n");
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        await pi.commands.get("scan")!.handler("", createFakeCtx());

        assert.deepEqual(pi.sentMessages, ["Scan the whole repository\n"]);
    });

    it("keeps a placeholder inside an argument literal", async () => {
        const pi = createFakePi();
        writeFileSync(join(commandsDir, "echo.md"), "---\ndescription: Echo\n---\nSay $0 and $1\n");
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        await pi.commands.get("echo")!.handler("'costs $1' dollars", createFakeCtx());

        assert.deepEqual(pi.sentMessages, ["Say costs $1 and dollars\n"]);
    });

    it("queues the prompt until the agent finishes its current run", async () => {
        const pi = createFakePi();
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });

        await pi.commands.get("one")!.handler("", createFakeCtx());

        assert.deepEqual(pi.sentOptions, [{ deliverAs: "followUp" }]);
    });

    it("reports a command file that disappeared instead of sending a message", async () => {
        const pi = createFakePi();
        const ctx = createFakeCtx();
        registerCommands(pi, { cwd: projectDir, agentDir, projectTrusted: true });
        rmSync(join(commandsDir, "one.md"));

        await pi.commands.get("one")!.handler("", ctx);

        assert.deepEqual(pi.sentMessages, []);
        assert.equal(ctx.notifications.length, 1);
        assert.equal(ctx.notifications[0].type, "error");
        assert.equal(ctx.notifications[0].message.includes(join(commandsDir, "one.md")), true);
        assert.equal(ctx.notifications[0].message.includes("/reload"), true);
    });
});
