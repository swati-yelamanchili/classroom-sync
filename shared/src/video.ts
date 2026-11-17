export type VideoSource =
  | { kind: 'file'; url: string }
  | { kind: 'embed'; url: string; embedUrl: string; provider: 'YouTube' | 'Vimeo' }
  | { kind: 'link'; url: string };

const LOCAL_DEMO_PREFIX = '/demo/';

/** http(s) links, plus the locally hosted demo assets. Rejects javascript:, data: and friends. */
export function isAllowedVideoUrl(value: string): boolean {
  if (value.startsWith(LOCAL_DEMO_PREFIX)) return !value.includes('..');
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** The video ID of a YouTube watch, short, embed or youtu.be link; null for anything else. */
export function youtubeVideoId(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0] || null;
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (/^\/(embed|shorts)\//.test(url.pathname)) id = url.pathname.split('/')[2] || null;
  }
  return id && /^[\w-]{6,20}$/.test(id) ? id : null;
}

/** Embedding is attempted only for direct media files and providers with a documented embed player. */
export function classifyVideoUrl(value: string): VideoSource {
  if (value.startsWith(LOCAL_DEMO_PREFIX)) return { kind: 'file', url: value };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { kind: 'link', url: value };
  }
  if (/\.(mp4|webm|ogv|ogg|m4v)$/i.test(url.pathname)) return { kind: 'file', url: value };

  const youtubeId = youtubeVideoId(value);
  if (youtubeId) {
    return { kind: 'embed', url: value, provider: 'YouTube', embedUrl: `https://www.youtube-nocookie.com/embed/${youtubeId}` };
  }
  const host = url.hostname.replace(/^www\.|^m\./, '');
  if (host === 'vimeo.com' && /^\/\d+$/.test(url.pathname)) {
    return { kind: 'embed', url: value, provider: 'Vimeo', embedUrl: `https://player.vimeo.com/video${url.pathname}` };
  }
  return { kind: 'link', url: value };
}
