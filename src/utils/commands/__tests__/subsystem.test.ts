import { subsystemCommand } from "../subsystem";
import { setPreferredSubsystem, getPreferredSubsystem } from "../../config";

describe("subsystem command", () => {
  const originalPreferred = getPreferredSubsystem();

  afterAll(() => {
    setPreferredSubsystem(originalPreferred);
  });

  it("should list subsystems when no args provided", async () => {
    const result = await subsystemCommand.execute([]);
    expect(result.success).toBe(true);
    expect(result.showSelectMenu).toBeDefined();
    expect(result.showSelectMenu?.title).toBe("Select Shell Subsystem");
  });

  it("should set preferred subsystem when valid arg provided", async () => {
    const result = await subsystemCommand.execute(["powershell"]);
    expect(result.success).toBe(true);
    expect(result.content).toContain("Shell subsystem set to");
    expect(getPreferredSubsystem()).toBe("powershell");
  });

  it("should fail when invalid subsystem provided", async () => {
    const result = await subsystemCommand.execute(["invalid-shell"]);
    expect(result.success).toBe(false);
    expect(result.content).toContain("Unknown subsystem");
  });

  it("should set back to auto", async () => {
    const result = await subsystemCommand.execute(["auto"]);
    expect(result.success).toBe(true);
    expect(getPreferredSubsystem()).toBe("auto");
  });
});
