import { Capacitor } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () =>
      resolve(String(reader.result).split(',', 2)[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read the image.'));

    reader.readAsDataURL(blob);
  });
}

/**
 * Share an image with the phone's share sheet (Save Image, WhatsApp...)
 * where supported, otherwise download it.
 */
export async function shareOrSave(
  url: string,
  fileName: string,
  title: string
): Promise<'shared' | 'saved' | 'cancelled'> {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error('Could not load the image.');
  }

  const blob = await res.blob();

  // Inside the iPhone app: write the image to a temporary file and
  // open the native share sheet.
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({
      path: fileName,
      data: await blobToBase64(blob),
      directory: Directory.Cache,
    });

    try {
      await Share.share({ title, files: [uri] });
      return 'shared';
    } catch (error) {
      if (String(error).toLowerCase().includes('cancel')) {
        return 'cancelled';
      }
      throw error;
    }
  }

  const file = new File([blob], fileName, { type: blob.type || 'image/png' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'cancelled';
      }
      // Fall through to a download.
    }
  }

  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);

  return 'saved';
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      await Clipboard.write({ string: text });
    } else {
      await navigator.clipboard.writeText(text);
    }
    return true;
  } catch {
    return false;
  }
}
