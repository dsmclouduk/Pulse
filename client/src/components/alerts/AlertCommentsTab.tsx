import { useEffect, useState } from 'react';

import { EnrichmentStatePill, UrgencyBadge, isEnrichmentActive } from '@/components/alerts/EnrichmentBadges';
import { Badge, Button, EmptyState, Notice, Textarea } from '@/components/ui';
import { useAlertComments, useAlertData, useAlertEnrichment } from '@/context/AlertDataContext';
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/alerts';
import { Markdown } from '@/lib/markdown';
import type { AlertComment, AlertEvent } from '@/types';

interface AlertCommentsTabProps {
  alert: AlertEvent;
}

function AuthorAvatar({ comment }: Readonly<{ comment: AlertComment }>) {
  const initial = comment.author.name.trim().charAt(0).toUpperCase() || '?';
  const tone =
    comment.author.kind === 'agent'
      ? 'bg-accent text-white'
      : comment.author.kind === 'system'
        ? 'bg-[var(--color-header)] text-[var(--color-text-secondary)] border border-[var(--color-border)]'
        : 'bg-sev-ok/20 text-sev-ok';

  return (
    <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ${tone}`} title={comment.author.name}>
      {comment.author.kind === 'agent' ? (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="10" height="8" rx="2" />
          <path d="M8 2v3M6 9h.01M10 9h.01M6.5 11.5h3" />
        </svg>
      ) : (
        initial
      )}
    </div>
  );
}

function CommentCard({ comment }: Readonly<{ comment: AlertComment }>) {
  const metadata = comment.metadata;
  const isDiagnosis = comment.kind === 'diagnosis';
  const isStatus = comment.kind === 'status';

  return (
    <article className={`flex gap-3 ${isStatus ? 'opacity-80' : ''}`}>
      <AuthorAvatar comment={comment} />
      <div
        className={`min-w-0 flex-1 rounded-md border p-3 ${
          isDiagnosis
            ? 'border-accent/30 bg-accent/5'
            : isStatus
              ? 'border-dashed border-[var(--color-border)] bg-[var(--color-surface-alt)]'
              : 'border-[var(--color-border)] bg-[var(--color-surface)]'
        }`}
      >
        <header className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-secondary)]">
          <span className="font-semibold text-[var(--color-text)]">{comment.author.name}</span>
          {isDiagnosis && metadata?.urgency && <UrgencyBadge urgency={metadata.urgency} />}
          {isDiagnosis && metadata?.isFallback && <Badge tone="neutral" title="No LLM key configured; deterministic rule-based diagnosis">rule-based</Badge>}
          {isDiagnosis && metadata?.enrichmentTrigger === 'rerun' && <Badge tone="neutral">re-run</Badge>}
          {isStatus && <Badge tone="neutral">system</Badge>}
          <span className="ml-auto" title={formatAbsoluteTime(comment.createdAt)}>
            {formatRelativeTime(comment.createdAt)}
          </span>
        </header>

        <Markdown source={comment.body} />

        {isDiagnosis && metadata && (
          <footer className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--color-border)] pt-2 text-[10px] text-[var(--color-text-tertiary)]">
            {metadata.model && <span>model {metadata.model}</span>}
            {metadata.provider && !metadata.model && <span>provider {metadata.provider}</span>}
            {metadata.confidence !== undefined && <span>confidence {Math.round(metadata.confidence * 100)}%</span>}
            {metadata.usage && <span>{metadata.usage.inputTokens} in / {metadata.usage.outputTokens} out tokens</span>}
            {metadata.durationMs !== undefined && <span>{(metadata.durationMs / 1000).toFixed(1)} s</span>}
            {metadata.trend && <span>trend {metadata.trend.pattern}</span>}
          </footer>
        )}
      </div>
    </article>
  );
}

export function AlertCommentsTab({ alert }: Readonly<AlertCommentsTabProps>) {
  const comments = useAlertComments(alert.id);
  const status = useAlertEnrichment(alert.id);
  const { mergeComments } = useAlertData();
  const [draft, setDraft] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [isRerunning, setIsRerunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate the full thread when the tab opens (SSE only carries comments since connect).
  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      try {
        const params = new URLSearchParams({ alertId: alert.id });
        if (alert.clientSlug) params.set('clientSlug', alert.clientSlug);
        const response = await fetch(`/api/alerts/comments?${params.toString()}`, { signal: controller.signal });

        if (response.ok) {
          mergeComments((await response.json()) as AlertComment[]);
        }
      } catch {
        // Ignore; live comments still arrive over SSE.
      }
    }

    void load();
    return () => controller.abort();
  }, [alert.id, alert.clientSlug, mergeComments]);

  async function postNote(): Promise<void> {
    const body = draft.trim();

    if (!body) return;

    setIsPosting(true);
    setError(null);

    try {
      const response = await fetch('/api/alerts/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId: alert.id, body, clientSlug: alert.clientSlug })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Failed to post note (${response.status})`);
      }

      mergeComments([(await response.json()) as AlertComment]);
      setDraft('');
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : 'Failed to post note.');
    } finally {
      setIsPosting(false);
    }
  }

  async function rerun(): Promise<void> {
    setIsRerunning(true);
    setError(null);

    try {
      const response = await fetch('/api/alerts/enrichment/rerun', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId: alert.id, clientSlug: alert.clientSlug })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Re-run failed (${response.status})`);
      }
    } catch (rerunError) {
      setError(rerunError instanceof Error ? rerunError.message : 'Re-run failed.');
    } finally {
      setIsRerunning(false);
    }
  }

  const running = isEnrichmentActive(status?.state);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
        <EnrichmentStatePill status={status} />
        {status?.message && !running && status.state !== 'complete' && (
          <span className="truncate text-[11px] text-[var(--color-text-secondary)]" title={status.message}>
            {status.message}
          </span>
        )}
        {running && status?.message && <span className="truncate text-[11px] text-[var(--color-text-secondary)]">{status.message}</span>}
        <div className="flex-1" />
        <Button size="sm" variant="secondary" onClick={() => void rerun()} loading={isRerunning} disabled={running} title="Fetch history again and ask the agent for a fresh diagnosis">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
            <path d="M13.5 2.5v3h-3" />
          </svg>
          Re-run analysis
        </Button>
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-3">
        {comments.length === 0 && !running && (
          <EmptyState>No comments yet. The agent posts a diagnosis here when enrichment completes, and you can add notes below.</EmptyState>
        )}
        {comments.length === 0 && running && (
          <Notice tone="info">Pulse Agent is analysing this alert. The diagnosis will appear here in a moment.</Notice>
        )}
        {comments.map((comment) => (
          <CommentCard key={comment.id} comment={comment} />
        ))}
      </div>

      <div className="border-t border-[var(--color-border)] p-3">
        {error && (
          <Notice tone="error" className="mb-2">
            {error}
          </Notice>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            rows={2}
            value={draft}
            placeholder="Add a note for the team… (Ctrl+Enter to post)"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void postNote();
              }
            }}
            className="flex-1"
          />
          <Button variant="primary" onClick={() => void postNote()} loading={isPosting} disabled={!draft.trim()}>
            Post note
          </Button>
        </div>
      </div>
    </div>
  );
}
