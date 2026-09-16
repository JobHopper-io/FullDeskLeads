export const QUEUE_NAMES = {
  INGEST: "ingest",
  NORMALIZE: "normalize",
  RESOLVE_IDENTITY: "resolve-identity",
  FILTER: "filter",
  ENRICH: "enrich",
  SELECT_CONTACT: "select-contact",
  SCORE: "score",
  EMIT: "emit",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
