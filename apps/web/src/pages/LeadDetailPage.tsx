import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useLeads } from "../lib/leads";
import PageLayout from "../components/PageLayout";
import LeadDetail, { type DetailSection } from "../components/LeadDetail/LeadDetail";

const SECTIONS: DetailSection[] = ["script", "role", "objections"];

// /leads/:id — Layer 2, opened from any screen. ?section= scrolls to the part a card button asked for.
export default function LeadDetailPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { items, logged, flagged } = useLeads();

  const item = items!.find((i) => i.id === id);
  if (!item) return <PageLayout><p className="empty">This lead isn't in your account.</p></PageLayout>;

  // Back to wherever the recruiter came from; a deep link (no history in this app) goes to My Day.
  const back = () => (location.key === "default" ? navigate("/my-day") : navigate(-1));
  const section = SECTIONS.find((s) => s === params.get("section")) ?? null;

  return (
    <PageLayout flush>
    <LeadDetail
      item={item}
      section={section}
      onBack={back}
      onLogged={(event) => {
        logged(item, event);
        back();
      }}
      onFlagged={flagged}
    />
    </PageLayout>
  );
}
