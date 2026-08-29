import { describe, expect, it } from "bun:test";
import { splitMessage } from "../utils.js";

describe("command parsing", () => {
  it("preserves comma-separated join arguments", () => {
    expect(splitMessage("join Bard, Crossbow")).toEqual({
      cmd: "join",
      args: "Bard",
      val: "Crossbow",
    });
  });

  it("preserves comma-separated add-player arguments", () => {
    expect(splitMessage("addp 3mat, Bard, Crossbow")).toEqual({
      cmd: "addp",
      args: "3mat",
      val: "Bard, Crossbow",
    });
  });

  it("parses commands without arguments", () => {
    expect(splitMessage("host")).toEqual({ cmd: "host", args: "", val: "" });
    expect(splitMessage("openbsu")).toEqual({
      cmd: "openbsu",
      args: "",
      val: "",
    });
  });
});
