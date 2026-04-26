import { spawn } from "node:child_process";

export type UiSoundReason = "done" | "attention";

export interface SoundCommand {
  command: string;
  args: string[];
}

const SOUND_THROTTLE_MS = 500;
const lastPlayedAt: Record<UiSoundReason, number> = {
  done: 0,
  attention: 0,
};

export function getSoundCommandForPlatform(
  reason: UiSoundReason,
  platform: NodeJS.Platform = process.platform,
): SoundCommand | null {
  if (platform === "win32") {
    const files =
      reason === "attention"
        ? [
          "C:\\Windows\\Media\\Speech On.wav",
          "C:\\Windows\\Media\\Windows Notify System Generic.wav",
          "C:\\Windows\\Media\\notify.wav",
        ]
        : [
          "C:\\Windows\\Media\\tada.wav",
          "C:\\Windows\\Media\\Windows Ding.wav",
          "C:\\Windows\\Media\\chimes.wav",
        ];
    const beep =
      reason === "attention"
        ? "[console]::beep(1200, 220)"
        : "[console]::beep(880, 180)";
    const quotedFiles = files.map((file) => `'${file.replaceAll("'", "''")}'`).join(", ");
    const script = [
      `$paths = @(${quotedFiles})`,
      "$played = $false",
      "foreach ($path in $paths) { if (Test-Path -LiteralPath $path) { $player = New-Object System.Media.SoundPlayer $path; $player.PlaySync(); $played = $true; break } }",
      `if (-not $played) { ${beep} }`,
    ].join("; ");

    return {
      command: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ],
    };
  }

  if (platform === "darwin") {
    const file =
      reason === "attention"
        ? "/System/Library/Sounds/Ping.aiff"
        : "/System/Library/Sounds/Glass.aiff";
    return { command: "afplay", args: [file] };
  }

  return null;
}

export function playUiSound(reason: UiSoundReason): void {
  if (process.env.MOSAIC_DISABLE_SOUND === "1" || process.env.NODE_ENV === "test") {
    return;
  }

  const now = Date.now();
  if (now - lastPlayedAt[reason] < SOUND_THROTTLE_MS) {
    return;
  }
  lastPlayedAt[reason] = now;

  const soundCommand = getSoundCommandForPlatform(reason);
  if (!soundCommand) {
    process.stdout.write("\u0007");
    return;
  }

  try {
    const child = spawn(soundCommand.command, soundCommand.args, {
      detached: false,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch {
    process.stdout.write("\u0007");
  }
}
