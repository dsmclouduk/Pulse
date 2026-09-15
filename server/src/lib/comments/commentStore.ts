import type { AlertComment } from '../../../../shared/types.js';
import type { AlertQueryFilters } from '../alertRepository.js';

const MAX_COMMENTS_PER_ALERT = 100;
const MAX_TRACKED_ALERTS = 5000;

/** In-memory comment store keyed by alert id. Insertion order of alerts is preserved for eviction. */
const commentsByAlert = new Map<string, AlertComment[]>();

function matchesFilters(comment: AlertComment, filters: AlertQueryFilters | undefined): boolean {
  if (!filters) {
    return true;
  }

  if (filters.clientAccountId && comment.clientAccountId !== filters.clientAccountId) {
    return false;
  }

  if (filters.clientSlug && comment.clientSlug !== filters.clientSlug) {
    return false;
  }

  if (filters.subscriptionId && comment.subscriptionId !== filters.subscriptionId) {
    return false;
  }

  return true;
}

export function addMemoryComment(comment: AlertComment): void {
  const existing = commentsByAlert.get(comment.alertId);

  if (existing) {
    const withoutDuplicate = existing.filter((entry) => entry.id !== comment.id);
    withoutDuplicate.push(comment);

    if (withoutDuplicate.length > MAX_COMMENTS_PER_ALERT) {
      withoutDuplicate.splice(0, withoutDuplicate.length - MAX_COMMENTS_PER_ALERT);
    }

    // Re-insert so the alert moves to the "most recently active" end for eviction purposes.
    commentsByAlert.delete(comment.alertId);
    commentsByAlert.set(comment.alertId, withoutDuplicate);
    return;
  }

  commentsByAlert.set(comment.alertId, [comment]);

  if (commentsByAlert.size > MAX_TRACKED_ALERTS) {
    const oldestAlertId = commentsByAlert.keys().next().value;

    if (oldestAlertId !== undefined) {
      commentsByAlert.delete(oldestAlertId);
    }
  }
}

export function getMemoryComments(alertId: string, filters?: AlertQueryFilters): AlertComment[] {
  const comments = commentsByAlert.get(alertId) ?? [];
  return comments.filter((comment) => matchesFilters(comment, filters));
}

export function getRecentMemoryComments(limit: number, filters?: AlertQueryFilters): AlertComment[] {
  const all: AlertComment[] = [];

  for (const comments of commentsByAlert.values()) {
    for (const comment of comments) {
      if (matchesFilters(comment, filters)) {
        all.push(comment);
      }
    }
  }

  all.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  return all.slice(0, limit);
}

export function clearMemoryComments(): void {
  commentsByAlert.clear();
}

export function getMemoryCommentCount(): number {
  let total = 0;

  for (const comments of commentsByAlert.values()) {
    total += comments.length;
  }

  return total;
}
