import { useState } from "react";
import { apiPost } from "../lib/apiClient";
import type { InteractionEvent } from "../lib/types";

interface Props {
  leadAssignmentId: string;
  logged: InteractionEvent | null;
  onLogged: (event: InteractionEvent) => void;
}

export default function OutcomeButton({ leadAssignmentId, logged, onLogged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function log() {
    setBusy(true);
    setError(null);
    try {
      onLogged(await apiPost<InteractionEvent>("/outcomes", { leadAssignmentId, outcome: "contacted" }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="outcome-button" onClick={log} disabled={busy}>
        {busy ? "Logging…" : logged ? "Log another contact" : "Mark contacted"}
      </button>
      {logged && (
        <span className="outcome-logged">
          Logged “{logged.event_type}” at {new Date(logged.occurred_at).toLocaleTimeString()} · event {logged.id.slice(0, 8)}
        </span>
      )}
      {error && <span className="error">{error}</span>}
    </>
  );
}
