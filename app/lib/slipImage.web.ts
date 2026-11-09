/**
 * Web: a file picker (and drag and drop, in `SlipImportButton.web.tsx`). The image is scaled down
 * in the browser before upload so a large screenshot stays under the API's size limit.
 */

/** Longest edge sent to the API. The model reads slips well at this size. */
export const SLIP_IMAGE_MAX_EDGE = 2000;

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/** Width and height that fit `max` on the long edge, never scaled up. */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/** A JPEG data URL of the file, scaled down when it is larger than `SLIP_IMAGE_MAX_EDGE`. */
export async function readSlipFile(file: File): Promise<string> {
  const original = await readAsDataUrl(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('decode failed'));
      image.src = original;
    });
    const size = fitWithin(image.naturalWidth, image.naturalHeight, SLIP_IMAGE_MAX_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context || size.width === 0) return original;
    context.drawImage(image, 0, 0, size.width, size.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    // The browser could not decode it; let the API say whether it is an image it can read.
    return original;
  }
}

/** Opens the browser's file picker for one image. Null when the user cancels. */
export function pickSlipImage(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.style.display = 'none';
    const finish = () => input.remove();
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      finish();
      if (!file) {
        resolve(null);
        return;
      }
      readSlipFile(file).then(resolve, reject);
    });
    input.addEventListener('cancel', () => {
      finish();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}
