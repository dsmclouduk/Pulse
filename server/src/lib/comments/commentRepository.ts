import { randomUUID } from 'node:crypto';

import type { AlertComment, AlertCommentMetadata, AlertEvent, CommentKind } from '../../../../shared/types.js';
import type { AlertQueryFilters } from '../alertRepository.js';
import { prisma } from '../prisma.js';
import { addMemoryComment, getMemoryComments, getRecentMemoryComments } from './commentStore.js';

export interface NewComment {
  alert: AlertEvent;
  author: AlertComment['author'];
  kind: CommentKind;
  body: string;
  metadata?: AlertCommentMetadata;
}

function isPersistenceConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function buildComment(input: NewComment): AlertComment {
  return {
    id: randomUUID(),
    alertId: input.alert.id,
    clientAccountId: input.alert.clientAccountId,
    clientSlug: input.alert.clientSlug,
    subscriptionId: input.alert.subscriptionId,
    author: input.author,
    kind: input.kind,
    body: input.body,
    createdAt: new Date().toISOString(),
    metadata: input.metadata
  };
}

interface StoredCommentRecord {
  id: string;
  externalAlertId: string;
  clientAccountId: string;
  authorKind: string;
  authorName: string;
  kind: string;
  body: string;
  metadataJson: string | null;
  createdAt: Date;
  alertEvent?: { clientSlugSnapshot: string | null; subscriptionExternalId: string | null } | null;
}

function mapStoredComment(record: StoredCommentRecord): AlertComment {
  let metadata: AlertCommentMetadata | undefined;

  if (record.metadataJson) {
    try {
      metadata = JSON.parse(record.metadataJson) as AlertCommentMetadata;
    } catch {
      metadata = undefined;
    }
  }

  return {
    id: record.id,
    alertId: record.externalAlertId,
    clientAccountId: record.clientAccountId,
    clientSlug: record.alertEvent?.clientSlugSnapshot ?? undefined,
    subscriptionId: record.alertEvent?.subscriptionExternalId ?? undefined,
    author: { kind: record.authorKind as AlertComment['author']['kind'], name: record.authorName },
    kind: record.kind as CommentKind,
    body: record.body,
    createdAt: record.createdAt.toISOString(),
    metadata
  };
}

export async function addComment(input: NewComment): Promise<AlertComment> {
  const comment = buildComment(input);
  const clientAccountId = input.alert.clientAccountId;

  if (!isPersistenceConfigured() || !clientAccountId) {
    addMemoryComment(comment);
    return comment;
  }

  const alertRecord = await prisma.alertEventRecord.findUnique({
    where: {
      clientAccountId_externalAlertId: {
        clientAccountId,
        externalAlertId: input.alert.id
      }
    },
    select: { id: true }
  });

  if (!alertRecord) {
    addMemoryComment(comment);
    return comment;
  }

  const stored = await prisma.alertComment.create({
    data: {
      id: comment.id,
      alertEventRecordId: alertRecord.id,
      externalAlertId: comment.alertId,
      clientAccountId,
      authorKind: comment.author.kind,
      authorName: comment.author.name,
      kind: comment.kind,
      body: comment.body,
      metadataJson: comment.metadata ? JSON.stringify(comment.metadata) : null,
      createdAt: new Date(comment.createdAt)
    },
    include: {
      alertEvent: { select: { clientSlugSnapshot: true, subscriptionExternalId: true } }
    }
  });

  return mapStoredComment(stored);
}

export async function listComments(alertId: string, filters: AlertQueryFilters = {}): Promise<AlertComment[]> {
  const memoryComments = getMemoryComments(alertId, filters);

  if (!isPersistenceConfigured()) {
    return memoryComments;
  }

  const stored = await prisma.alertComment.findMany({
    where: {
      externalAlertId: alertId,
      clientAccountId: filters.clientAccountId,
      alertEvent: filters.clientSlug || filters.subscriptionId
        ? {
            clientSlugSnapshot: filters.clientSlug,
            subscriptionExternalId: filters.subscriptionId
          }
        : undefined
    },
    include: {
      alertEvent: { select: { clientSlugSnapshot: true, subscriptionExternalId: true } }
    },
    orderBy: { createdAt: 'asc' }
  });

  const merged = new Map<string, AlertComment>();

  for (const comment of [...stored.map(mapStoredComment), ...memoryComments]) {
    merged.set(comment.id, comment);
  }

  return [...merged.values()].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
}

export async function listRecentComments(limit: number, filters: AlertQueryFilters = {}): Promise<AlertComment[]> {
  const memoryComments = getRecentMemoryComments(limit, filters);

  if (!isPersistenceConfigured()) {
    return memoryComments;
  }

  const stored = await prisma.alertComment.findMany({
    where: {
      clientAccountId: filters.clientAccountId,
      alertEvent: filters.clientSlug || filters.subscriptionId
        ? {
            clientSlugSnapshot: filters.clientSlug,
            subscriptionExternalId: filters.subscriptionId
          }
        : undefined
    },
    include: {
      alertEvent: { select: { clientSlugSnapshot: true, subscriptionExternalId: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: limit
  });

  const merged = new Map<string, AlertComment>();

  for (const comment of [...stored.map(mapStoredComment), ...memoryComments]) {
    merged.set(comment.id, comment);
  }

  return [...merged.values()]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, limit);
}
