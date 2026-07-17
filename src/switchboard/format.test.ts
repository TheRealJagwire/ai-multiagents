import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals } from "jsr:@std/assert";
import { modelLabel, planBullets, providerModels } from "./format.ts";
import { providerOf } from "./types.ts";

describe("planBullets", () => {
  it("turns plain prose lines into one bullet per non-blank line", () => {
    assertEquals(planBullets("Step one.\nStep two.\n\nStep three."), ["Step one.", "Step two.", "Step three."]);
  });

  it("strips existing -/*/number/heading markers so they don't double up with the <li> bullet", () => {
    assertEquals(
      planBullets("# Plan\n- Do the first thing\n* Do the second\n1. Do the third\n2) Do the fourth"),
      ["Plan", "Do the first thing", "Do the second", "Do the third", "Do the fourth"],
    );
  });

  it("returns an empty list for blank input", () => {
    assertEquals(planBullets("   \n  \n"), []);
  });
});

describe("providers", () => {
  it("providerOf derives the runtime from the model name", () => {
    assertEquals(providerOf("sonnet"), "claude");
    assertEquals(providerOf("gemini-flash"), "gemini");
    assertEquals(providerOf("gemini-pro"), "gemini");
  });

  it("providerModels partitions the full list", () => {
    assertEquals(providerModels("claude"), ["haiku", "sonnet", "opus"]);
    assertEquals(providerModels("gemini"), ["gemini-flash", "gemini-pro"]);
  });

  it("every model has a label", () => {
    for (const m of [...providerModels("claude"), ...providerModels("gemini")]) {
      assertEquals(typeof modelLabel(m), "string");
      assertEquals(modelLabel(m).length > 0, true);
    }
  });
});
