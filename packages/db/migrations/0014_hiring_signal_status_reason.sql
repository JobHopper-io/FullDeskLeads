-- Records which internal-mobility pattern matched (transfer-portal / job-shadowing /
-- internship / intern) when a hiring_signal is excluded, so the decision is auditable rather
-- than a bare status flip. Nullable — only ever set alongside status = 'excluded' so far.

alter table hiring_signals add column status_reason text;
