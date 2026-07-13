import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals } from "jsr:@std/assert";
import { parseSpecFile } from "./team-spec.ts";

describe("team-spec parseSpecFile", () => {
  it("parses one task per ## heading", () => {
    const tasks = parseSpecFile(
      "# SWITCHBOARD_TASKS\n\n## backend\nBuild the API endpoint.\n\n## frontend\nConsume it.\n",
    );
    assertEquals(tasks, [
      { label: "backend", task: "Build the API endpoint." },
      { label: "frontend", task: "Consume it." },
    ]);
  });

  it("preamble before the first heading is ignored", () => {
    const tasks = parseSpecFile("Plan overview text.\n\n## only-task\nDo the thing.");
    assertEquals(tasks, [{ label: "only-task", task: "Do the thing." }]);
  });

  it("multi-line task bodies survive intact", () => {
    const tasks = parseSpecFile("## worker\nLine one.\n\n- bullet\n- bullet 2\n");
    assertEquals(tasks[0].task, "Line one.\n\n- bullet\n- bullet 2");
  });

  it("returns empty for input with no headings", () => {
    assertEquals(parseSpecFile("just prose, no sections"), []);
    assertEquals(parseSpecFile(""), []);
  });

  it("drops sections that are entirely empty", () => {
    const tasks = parseSpecFile("## \n\n## real\nwork\n");
    assertEquals(tasks, [{ label: "real", task: "work" }]);
  });

  it("tolerates tabs and extra spaces after ##", () => {
    const tasks = parseSpecFile("##\tspaced-label\ttask on next line?\nbody");
    assertEquals(tasks[0].label, "spaced-label\ttask on next line?");
    assertEquals(tasks[0].task, "body");
  });
});
