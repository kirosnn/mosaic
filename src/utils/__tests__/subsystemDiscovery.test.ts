import {
  discoverSubsystems,
  getEffectiveSubsystem,
  buildSubsystemContextSummary,
  getSubsystemStatusSnapshot,
  isSubsystemQuestion,
} from "../subsystemDiscovery";

describe("subsystemDiscovery", () => {
  it("should discover subsystems on the current platform", async () => {
    const subsystems = await discoverSubsystems();
    expect(subsystems.length).toBeGreaterThan(0);
    const auto = subsystems.find((s) => s.id === "auto");
    expect(auto).toBeDefined();
    expect(auto?.available).toBe(true);
  });

  it("should get effective subsystem", async () => {
    const effective = await getEffectiveSubsystem("auto");
    expect(effective).toBeDefined();
    expect(effective.available).toBe(true);
    expect(effective.id).not.toBe("auto");
  });

  it("should build context summary", async () => {
    const summary = await buildSubsystemContextSummary("auto");
    expect(summary).toContain("SHELL EXECUTION SUBSYSTEM");
    expect(summary).toContain("Preferred: auto");
    expect(summary).toContain("Effective for this turn:");
    expect(summary).toContain("Available subsystems:");
    expect(summary).toContain("Fallback order:");
    expect(summary).toContain("Executable hints:");
  });

  it("should fall back if preferred is unavailable", async () => {
    const effective = await getEffectiveSubsystem("non-existent-subsystem");
    expect(effective).toBeDefined();
    expect(effective.available).toBe(true);
  });

  it("should detect direct subsystem questions for lightweight environment handling", () => {
    expect(isSubsystemQuestion("Quel est mon subsystem ?")).toBe(true);
    expect(isSubsystemQuestion("What subsystems are installed?")).toBe(true);
    expect(isSubsystemQuestion("Which shell will bash use?")).toBe(true);
  });

  it("should build a structured subsystem snapshot", async () => {
    const snapshot = await getSubsystemStatusSnapshot("auto");

    expect(snapshot.preferred).toBe("auto");
    expect(snapshot.effective.available).toBe(true);
    expect(snapshot.fallbackOrder.length).toBeGreaterThan(0);
    expect(snapshot.available.some((entry) => entry.id === snapshot.effective.id)).toBe(true);
  });
});
