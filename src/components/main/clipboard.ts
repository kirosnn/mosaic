import { execSync } from 'child_process';
import { emitImageCommand, canUseImages } from '../../utils/imageBridge';
import { notifyNotification } from '../../utils/notificationBridge';
import type { ImageAttachment } from '../../utils/images';

export function buildClipboardImage(data: string, mimeType: string, size: number): ImageAttachment {
  const ext = mimeType === 'image/jpeg' ? 'jpg' : (mimeType === 'image/png' ? 'png' : 'bin');
  const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return {
    id: createId(),
    name: `clipboard-${Date.now()}.${ext}`,
    mimeType,
    data,
    size
  };
}

export function isPng(buffer: Buffer): boolean {
  return buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
}

export function isJpeg(buffer: Buffer): boolean {
  return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

export function readClipboardImage(): { data: string; mimeType: string; size: number } | null {
  try {
    if (process.platform === 'win32') {
      const script = 'powershell.exe -NoProfile -Command "$img=Get-Clipboard -Format Image -ErrorAction SilentlyContinue; if ($img) { $ms=New-Object System.IO.MemoryStream; $img.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($ms.ToArray()) }"';
      const base64 = execSync(script, { encoding: 'utf8', timeout: 2000 }).trim();
      if (!base64) return null;
      const size = Buffer.from(base64, 'base64').length;
      return { data: base64, mimeType: 'image/png', size };
    }

    if (process.platform === 'darwin') {
      try {
        const buffer = execSync('pbpaste -Prefer png', { timeout: 2000 }) as Buffer;
        if (buffer.length > 0 && isPng(buffer)) {
          return { data: buffer.toString('base64'), mimeType: 'image/png', size: buffer.length };
        }
      } catch {
      }
      try {
        const buffer = execSync('pbpaste -Prefer jpeg', { timeout: 2000 }) as Buffer;
        if (buffer.length > 0 && isJpeg(buffer)) {
          return { data: buffer.toString('base64'), mimeType: 'image/jpeg', size: buffer.length };
        }
      } catch {
      }
      return null;
    }

    try {
      const buffer = execSync('xclip -selection clipboard -t image/png -o', { timeout: 2000 }) as Buffer;
      if (buffer.length > 0 && isPng(buffer)) {
        return { data: buffer.toString('base64'), mimeType: 'image/png', size: buffer.length };
      }
    } catch {
    }
    try {
      const buffer = execSync('xclip -selection clipboard -t image/jpeg -o', { timeout: 2000 }) as Buffer;
      if (buffer.length > 0 && isJpeg(buffer)) {
        return { data: buffer.toString('base64'), mimeType: 'image/jpeg', size: buffer.length };
      }
    } catch {
    }
  } catch {
  }
  return null;
}

export function tryPasteImage(lastClipboardImageRef: React.MutableRefObject<{ at: number; signature: string } | null>): boolean {
  const image = readClipboardImage();
  if (!image) return false;
  const signature = `${image.mimeType}:${image.data.slice(0, 64)}`;
  const now = Date.now();
  const last = lastClipboardImageRef.current;
  if (last && last.signature === signature && now - last.at < 400) return true;
  lastClipboardImageRef.current = { at: now, signature };

  if (!canUseImages()) {
    notifyNotification('Current model does not support images.', 'warning', 3000);
    return true;
  }

  emitImageCommand({ type: 'add', image: buildClipboardImage(image.data, image.mimeType, image.size) });
  return true;
}

export function normalizePastedText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
