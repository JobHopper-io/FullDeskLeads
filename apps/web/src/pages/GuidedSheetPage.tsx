import { useLocation, useNavigate, useParams } from "react-router";
import { useLeads } from "../lib/leads";
import GuidedSheet from "../components/GuidedSheet/GuidedSheet";

// /leads/:id/guided — Format 2, the same lead as /leads/:id rendered as a stepped call runner.
export default function GuidedSheetPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { items, logged } = useLeads();

  const item = items!.find((i) => i.id === id);
  if (!item) return <p className="empty">This lead isn't in your account.</p>;

  // Same back behaviour as Layer 2: wherever the recruiter came from, else My Day.
  const back = () => (location.key === "default" ? navigate("/my-day") : navigate(-1));
  return (
    <GuidedSheet
      key={item.id}
      item={item}
      onBack={back}
      onLogged={(event) => {
        logged(item, event);
        back();
      }}
    />
  );
}
