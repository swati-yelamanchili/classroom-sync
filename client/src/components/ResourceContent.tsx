import { ExternalLink, VideoOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { classifyVideoUrl, languageName, type ResourceView } from '@classroom/shared';
import { ProvenanceBadge } from './badges';
import { Button } from './ui/button';
import { Notice } from './feedback';

function OpenInNewTab({ url, label = 'Open video in a new tab', primary }: { url: string; label?: string; primary?: boolean }) {
  return (
    <Button asChild variant={primary ? 'primary' : 'secondary'} size={primary ? 'lg' : 'md'}>
      <a href={url} target="_blank" rel="noopener noreferrer">
        <ExternalLink aria-hidden />
        {label}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </Button>
  );
}

/** A request to play from a moment, made by tapping a transcript time. `at` makes repeated taps distinct. */
export type SeekRequest = { seconds: number; at: number } | null;

/** The student controls playback: it only starts when they press play or tap a transcript time. */
export function VideoPanel({ videoUrl, title, seek = null }: { videoUrl: string | null; title: string; seek?: SeekRequest }) {
  const source = useMemo(() => (videoUrl ? classifyVideoUrl(videoUrl) : null), [videoUrl]);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [videoUrl]);

  if (!source) {
    return (
      <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-md bg-neutral-tint p-6 text-center">
        <VideoOff className="size-8 text-ink-soft" aria-hidden />
        <p className="font-bold">No video is available for this resource.</p>
      </div>
    );
  }
  if (source.kind === 'link' || failed) {
    return (
      <div className="flex aspect-video flex-col items-center justify-center gap-4 rounded-md bg-neutral-tint p-6 text-center">
        <p className="max-w-md">
          {failed ? 'This video could not be played on this page.' : 'This video cannot be shown inside this page.'} You can watch it in a new tab.
        </p>
        <OpenInNewTab url={source.url} primary />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {source.kind === 'file' ? (
        <video
          key={source.url}
          src={source.url}
          controls
          playsInline
          preload="metadata"
          aria-label={`Sign language video: ${title}`}
          onError={() => setFailed(true)}
          className="aspect-video w-full rounded-md bg-ink"
        />
      ) : (
        <iframe
          key={`${source.embedUrl}#${seek?.at ?? 0}`}
          src={seek && source.provider === 'YouTube' ? `${source.embedUrl}?start=${Math.floor(seek.seconds)}&autoplay=1` : source.embedUrl}
          title={`Sign language video: ${title}`}
          allow="autoplay; fullscreen; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
          className="aspect-video w-full rounded-md border-0 bg-ink"
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {source.kind === 'embed' && <p className="text-ink-soft">If the {source.provider} player does not load, use the link.</p>}
        <OpenInNewTab url={source.url} />
      </div>
    </div>
  );
}

/** Renders stored text as text: exact spacing and line breaks, and no HTML interpretation. */
export function ScriptPanel({ scriptText, language }: { scriptText: string | null; language?: string | null }) {
  if (!scriptText) return <p className="font-bold text-ink-soft">No script is available for this resource.</p>;
  return (
    <div data-testid="script-text" lang={language && /^[a-z]{2,3}(-[A-Za-z]+)?$/.test(language) ? language : undefined} className="break-words whitespace-pre-wrap">
      {scriptText}
    </div>
  );
}

/** Grade/subject and language, so versions of the same topic can be told apart. */
export function ResourceFacts({ resource }: { resource: { subject?: string | null; language: string | null } }) {
  const facts = [resource.subject, languageName(resource.language)].filter(Boolean).join(' · ');
  return facts ? <span className="text-ink-soft">{facts}</span> : null;
}

export function SourceLine({ resource }: { resource: ResourceView }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-soft">
      <ProvenanceBadge provenance={resource.provenance} />
      {resource.sourceOrganisation && <span>Source: {resource.sourceOrganisation}</span>}
      {resource.sourceReference && <span>Reference: {resource.sourceReference}</span>}
    </div>
  );
}

export function ResourcePreview({ resource }: { resource: ResourceView }) {
  return (
    <div className="space-y-4">
      <SourceLine resource={resource} />
      {resource.provenance === 'demo' && <Notice tone="warn">Demonstration placeholder only. This is not Ashray Akruti content.</Notice>}
      <div className="grid gap-5 md:grid-cols-2">
        <VideoPanel videoUrl={resource.videoUrl} title={resource.title} />
        <div className="max-h-80 overflow-y-auto rounded-md border border-line p-4" tabIndex={0} aria-label="Script">
          <ScriptPanel scriptText={resource.scriptText} language={resource.language} />
        </div>
      </div>
    </div>
  );
}
