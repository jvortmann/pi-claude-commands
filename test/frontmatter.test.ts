import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { parseFrontmatter } from "../src/frontmatter.ts";

describe("parseFrontmatter", () => {
    it("parses description and body from valid frontmatter", () => {
        const content = "---\ndescription: My command\n---\nHello world";
        const result = parseFrontmatter(content);

        assert.equal(result.description, "My command");
        assert.equal(result.body, "Hello world");
    });

    it("treats entire content as body when no frontmatter is present", () => {
        const content = "Just plain markdown";
        const result = parseFrontmatter(content);

        assert.equal(result.description, "");
        assert.equal(result.body, "Just plain markdown");
    });

    it("leaves description empty when frontmatter has no description field", () => {
        const content = "---\ntitle: Something\n---\nBody here";
        const result = parseFrontmatter(content);

        assert.equal(result.description, "");
        assert.equal(result.body, "Body here");
    });
});
