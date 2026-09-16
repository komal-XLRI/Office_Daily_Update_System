/** Client-safe Cloudinary delivery URL helpers (no credentials involved). */

const IMAGE_UPLOAD_MARKER = "/image/upload/";

/** Insert a transformation into a Cloudinary image URL. Non-Cloudinary URLs are returned unchanged. */
export function cloudinaryImageUrl(fileUrl: string, transformation = "f_auto,q_auto"): string {
  try {
    const url = new URL(fileUrl);
    if (url.hostname !== "res.cloudinary.com") return fileUrl;
    const index = url.pathname.indexOf(IMAGE_UPLOAD_MARKER);
    if (index === -1) return fileUrl;
    const head = url.pathname.slice(0, index + IMAGE_UPLOAD_MARKER.length);
    const tail = url.pathname.slice(index + IMAGE_UPLOAD_MARKER.length);
    url.pathname = `${head}${transformation}/${tail}`;
    return url.toString();
  } catch {
    return fileUrl;
  }
}

/** Small, optimized square thumbnail for previews. */
export function cloudinaryThumbnailUrl(fileUrl: string, size = 240): string {
  return cloudinaryImageUrl(fileUrl, `c_fill,w_${size},h_${size},f_auto,q_auto`);
}
