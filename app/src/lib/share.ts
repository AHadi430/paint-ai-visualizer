/**
 * Share an image with the phone's share sheet (save to Photos,
 * WhatsApp...) where supported, otherwise download it.
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
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
