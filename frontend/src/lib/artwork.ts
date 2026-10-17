/** YouTube's missing-image JPEG is 120x90 even for a requested higher-quality image. */
export function unavailableYouTubeImage(image: HTMLImageElement): boolean {
  if (image.naturalWidth !== 120 || image.naturalHeight !== 90) return false;
  try {
    const url = new URL(image.src);
    return ['i.ytimg.com','img.youtube.com'].includes(url.hostname)
      && /^\/vi(?:_webp)?\/[\w-]{11}\/(?:mqdefault|hqdefault|sddefault|maxresdefault)\.(?:jpg|webp)$/.test(url.pathname);
  } catch { return false; }
}
