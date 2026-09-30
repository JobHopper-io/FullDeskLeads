import { Link } from "react-router";

// Two renderings of the same lead (spec: format is a rendering choice, not a different lead). Switching replaces the
// history entry, so Back still returns to wherever the recruiter opened the lead from.
export default function ViewToggle({ id, current }: { id: string; current: "intelligence" | "guided" }) {
  const views = [
    { key: "intelligence", label: "Intelligence", to: `/leads/${id}` },
    { key: "guided", label: "Guided", to: `/leads/${id}/guided` },
  ] as const;
  return (
    <nav className="view-toggle" aria-label="Lead view">
      {views.map((v) => (
        <Link key={v.key} to={v.to} replace aria-current={v.key === current ? "page" : undefined}>{v.label}</Link>
      ))}
    </nav>
  );
}
