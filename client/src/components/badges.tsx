import { CircleDot, CirclePause, CircleStop, Clock, FlaskConical, HelpCircle, Mic, ShieldCheck, Timer } from 'lucide-react';
import type { MatchStatus, Provenance, SessionStatus, SyncMode } from '@classroom/shared';
import { Badge } from './ui/badge';

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  switch (status) {
    case 'created':
      return <Badge tone="neutral"><Clock aria-hidden />Not started</Badge>;
    case 'active':
      return <Badge tone="good"><CircleDot aria-hidden />In progress</Badge>;
    case 'paused':
      return <Badge tone="warn"><CirclePause aria-hidden />Paused</Badge>;
    case 'ended':
      return <Badge tone="neutral"><CircleStop aria-hidden />Ended</Badge>;
  }
}

export function SyncModeBadge({ mode }: { mode: SyncMode }) {
  return mode === 'voice' ? (
    <Badge tone="teal"><Mic aria-hidden />Voice Trigger mode</Badge>
  ) : (
    <Badge tone="teal"><Timer aria-hidden />Timestamp mode</Badge>
  );
}

export function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  switch (provenance) {
    case 'demo':
      return <Badge tone="warn"><FlaskConical aria-hidden />Demo Resource</Badge>;
    case 'verified':
      return <Badge tone="good"><ShieldCheck aria-hidden />Verified Ashray Akruti Resource</Badge>;
    case 'unverified':
      return <Badge tone="neutral"><HelpCircle aria-hidden />Source not verified</Badge>;
  }
}

const MATCH_LABELS: Record<MatchStatus, { label: string; tone: 'good' | 'teal' | 'warn' | 'bad' | 'neutral' }> = {
  exact: { label: 'Exact match', tone: 'good' },
  normalized: { label: 'Title match', tone: 'good' },
  alias: { label: 'Alias or keyword match', tone: 'teal' },
  fuzzy: { label: 'Possible match: please check', tone: 'warn' },
  manual: { label: 'Chosen by you', tone: 'teal' },
  unresolved: { label: 'No resource', tone: 'bad' },
};

export function MatchBadge({ status, confidence }: { status: MatchStatus; confidence: number | null }) {
  const { label, tone } = MATCH_LABELS[status];
  return (
    <Badge tone={tone}>
      {label}
      {confidence !== null && status !== 'exact' ? ` (${Math.round(confidence * 100)}%)` : ''}
    </Badge>
  );
}
