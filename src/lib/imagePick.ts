/**
 * A picture from this computer, made small and square for a cover or a profile photo: the file
 * picker, then the frame where the listener picks the part to keep (components/ImageCrop), scaled
 * to `px` as a JPEG data URL. Small on purpose: covers and photos travel with the sync.
 */
import { askCrop } from "../components/ImageCrop";

/** Bigger files than this are refused before decoding (a photo straight off a camera is far under it). */
const MAX_BYTES = 25 * 1024 * 1024;
const UNREADABLE = "ByTune couldn't open that image. Try a PNG, JPEG or WebP file.";

/**
 * null when the picker or the frame was closed without a choice. Throws a message fit for a toast
 * when the file won't do. `round`: a profile photo, framed by the circle it will show as.
 */
export async function pickSquareImage(px: number, frame: { title: string; confirmLabel: string; round?: boolean }): Promise<string | null> {
  const file = await chooseImageFile();
  if (!file) return null;
  if (file.size > MAX_BYTES) throw new Error("That image is too big. Pick one under 25 MB.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(UNREADABLE);
  }
  const src = URL.createObjectURL(file);
  try {
    if (bitmap.width <= 0 || bitmap.height <= 0) throw new Error(UNREADABLE);
    const rect = await askCrop({ src, width: bitmap.width, height: bitmap.height, round: !!frame.round, title: frame.title, confirmLabel: frame.confirmLabel });
    if (!rect) return null;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(UNREADABLE);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, rect.x, rect.y, rect.size, rect.size, 0, 0, px, px);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(src);
    bitmap.close();
  }
}

/** The system's file picker for one image; null when it closes without one. */
function chooseImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif";
    input.style.display = "none";
    const done = (file: File | null): void => {
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => done(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => done(null), { once: true });
    document.body.append(input);
    input.click();
  });
}
