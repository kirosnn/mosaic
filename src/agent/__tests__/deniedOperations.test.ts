import { beforeEach, describe, expect, it } from "bun:test";
import { beginOperationTurn, isOperationDenied, recordDeniedOperation } from "../deniedOperations";

describe("denied operation guard", () => {
  beforeEach(() => beginOperationTurn());

  it("blocks repeated writes to the same target during a turn", () => {
    recordDeniedOperation("write", { path: "src/app.ts", content: "first" });
    expect(isOperationDenied("write", { path: "src/app.ts", content: "second" })).toBe(true);
  });

  it("clears denials when a new user turn starts", () => {
    recordDeniedOperation("bash", { command: "rm file.txt" });
    expect(isOperationDenied("bash", { command: "rm   file.txt" })).toBe(true);
    beginOperationTurn();
    expect(isOperationDenied("bash", { command: "rm file.txt" })).toBe(false);
  });
});
