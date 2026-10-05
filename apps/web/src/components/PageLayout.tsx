import type { ReactNode } from "react";
import { useLeads } from "../lib/leads";

/**
 * The one page shell every screen renders inside, so width, gutter and notice placement can't drift per page again.
 *
 * - width "wide" (1400px) for tables and the call sheets, "narrow" (800px) for forms and single-column reading.
 *   Either way the column is centred in the area beside the sidebar, never pinned left with dead space after it.
 * - header: an optional full-bleed white band (My Day's); its content lines up with the body's column.
 * - flush: no vertical padding on the body, for screens that manage their own height (My Day, the lead sheets).
 *
 * The app notice ("Logged … for …") lives here too: in the header band when there is one, otherwise at the top of
 * the body.
 */
export default function PageLayout({ width = "wide", header, flush = false, className = "", children }: {
  width?: "wide" | "narrow";
  header?: ReactNode;
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { notice } = useLeads();
  const note = notice && <p className="outcome-logged app-notice" role="status">{notice}</p>;
  return (
    <div className={`page-layout page-layout--${width}${flush ? " page-layout--flush" : ""}${className ? ` ${className}` : ""}`}>
      {header && (
        <header className="page-layout__band">
          <div className="page-layout__inner page-layout__band-inner">{header}{note}</div>
        </header>
      )}
      <div className="page-layout__inner page-layout__body">
        {!header && note}
        {children}
      </div>
    </div>
  );
}
