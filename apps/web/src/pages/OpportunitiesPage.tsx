// Deliberately a stub: there is no Opportunity record yet. Job order / meeting set outcomes are only
// tagged promotion_pending on their event (migration 0022), for a future migration to backfill from.
export default function OpportunitiesPage() {
  return (
    <div className="page stub">
      <h2>Opportunities: coming soon</h2>
      <p>This screen isn't built yet. There is no Opportunity record behind it, so there's nothing real to show.</p>
      <p>
        Job orders and meetings you log are still saved in each lead's history and marked for promotion, so they can be
        carried over once Opportunities exist.
      </p>
    </div>
  );
}
