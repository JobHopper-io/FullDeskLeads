import type { Logger } from "pino";

export type PipelineStage<In, Out = In> = (input: In, log: Logger) => Promise<Out>;
