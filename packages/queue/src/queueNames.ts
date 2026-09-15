export const QUEUE_NAMES = [
  "ingest",
  "normalize",
  "resolve-identity",
  "filter",
  "enrich",
  "select-contact",
  "score",
  "emit",
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];
