export interface RawPosting {
  sourceName: string;
  externalId: string;
  raw: unknown;
}

export interface SignalSource {
  name: string;
  fetch(boardToken: string): Promise<RawPosting[]>;
}
