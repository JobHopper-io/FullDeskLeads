import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

export interface DropdownOption { value: string; label: string }

interface Common {
  label: string;
  options: DropdownOption[];
  disabled?: boolean;
  /** Shown as the trigger's tooltip, e.g. why it's disabled. */
  title?: string;
}
interface MultiProps extends Common { multiple: true; value: string[]; onChange: (next: string[]) => void }
interface SingleProps extends Common {
  multiple?: false;
  value: string;
  onChange: (next: string) => void;
  /** An unset single select: adds this as a first option with value "" (e.g. "Any"). Omit for a required one (Sort). */
  anyLabel?: string;
}

/**
 * The one filter dropdown, used by every filter bar (Opportunities, Settings, New Leads, History).
 *
 * A trigger button opens a listbox popover anchored under it. Multi-select stays open while you tick several values
 * and closes on Done, a click outside or Escape; single-select closes as soon as a value is picked. Selected values
 * show on the trigger itself as a pill ("Industry: fintech, switchgear ×"), and × clears that filter without opening it.
 *
 * Keyboard: Tab to the trigger, Enter/Space/↓ opens, ↑/↓/Home/End move, Enter/Space picks, Escape closes and returns
 * focus to the trigger, Tab closes and moves on.
 */
export default function FilterDropdown(props: MultiProps | SingleProps) {
  const { label, disabled, title } = props;
  const multiple = props.multiple === true;
  const options = !multiple && props.anyLabel !== undefined ? [{ value: "", label: props.anyLabel }, ...props.options] : props.options;
  const selected = multiple ? props.value : [props.value];
  const isSelected = (v: string) => selected.includes(v);

  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [alignRight, setAlignRight] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const optionId = (i: number) => `${id}-opt-${i}`;

  function openList() {
    if (disabled) return;
    const first = options.findIndex((o) => isSelected(o.value));
    setActiveIdx(first >= 0 ? first : 0);
    setAlignRight(false);
    setOpen(true);
  }
  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  function choose(value: string) {
    if (props.multiple === true) {
      props.onChange(props.value.includes(value) ? props.value.filter((v) => v !== value) : [...props.value, value]);
    } else {
      props.onChange(value);
      close(true);
    }
  }

  // Focus moves into the list on open, so the arrow keys work straight away.
  useEffect(() => { if (open) listRef.current?.focus(); }, [open]);
  useEffect(() => { if (open) document.getElementById(optionId(activeIdx))?.scrollIntoView({ block: "nearest" }); });

  // Click anywhere outside closes it (including another dropdown's trigger, so only one is ever open).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) close(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Near the right edge of the page, anchor the popover to the trigger's right side instead of overflowing.
  useLayoutEffect(() => {
    if (!open) return;
    const r = popRef.current?.getBoundingClientRect();
    if (r && r.right > document.documentElement.clientWidth - 8) setAlignRight(true);
  }, [open]);

  function onTriggerKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); openList(); }
  }
  function onListKey(e: KeyboardEvent) {
    const last = options.length - 1;
    if (e.key === "ArrowDown") setActiveIdx((i) => Math.min(i + 1, last));
    else if (e.key === "ArrowUp") setActiveIdx((i) => Math.max(i - 1, 0));
    else if (e.key === "Home") setActiveIdx(0);
    else if (e.key === "End") setActiveIdx(last);
    else if (e.key === "Enter" || e.key === " ") { if (options[activeIdx]) choose(options[activeIdx].value); }
    else if (e.key === "Escape") close(true);
    else if (e.key === "Tab") { setOpen(false); return; }
    else return;
    e.preventDefault();
  }

  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const picked = multiple ? props.value : props.value ? [props.value] : [];
  // "Active" = this filter is narrowing something; a required single select (Sort) is never "active", just set.
  const active = multiple ? picked.length > 0 : props.anyLabel !== undefined && props.value !== "";
  const summary = multiple
    ? picked.length > 2 ? `${labelOf(picked[0])}, ${labelOf(picked[1])} +${picked.length - 2}` : picked.map(labelOf).join(", ")
    : labelOf(props.value);

  return (
    <div className={`fd${active ? " fd--active" : ""}${disabled ? " fd--disabled" : ""}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="fd-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        disabled={disabled}
        title={title}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onTriggerKey}
      >
        <span className="fd-label">{label}{summary && ":"}</span>
        {summary && <span className="fd-value">{summary}</span>}
        <span className="fd-caret" aria-hidden="true">▾</span>
      </button>
      {active && (
        <button type="button" className="fd-clear" aria-label={`Clear ${label}`} onClick={() => (props.multiple === true ? props.onChange([]) : props.onChange(""))}>
          ×
        </button>
      )}
      {open && (
        <div ref={popRef} className={`fd-pop${alignRight ? " fd-pop--right" : ""}`}>
          <ul
            ref={listRef}
            id={`${id}-list`}
            role="listbox"
            aria-label={label}
            aria-multiselectable={multiple || undefined}
            aria-activedescendant={optionId(activeIdx)}
            tabIndex={-1}
            onKeyDown={onListKey}
          >
            {options.map((o, i) => (
              <li
                key={o.value}
                id={optionId(i)}
                role="option"
                aria-selected={isSelected(o.value)}
                className={`fd-option${i === activeIdx ? " is-active" : ""}`}
                onPointerMove={() => setActiveIdx(i)}
                onClick={() => choose(o.value)}
              >
                {multiple && <span className="fd-check" aria-hidden="true" />}
                {o.label}
              </li>
            ))}
            {!options.length && <li className="fd-empty">No options</li>}
          </ul>
          {multiple && (
            <div className="fd-foot">
              <button type="button" className="link-button" onClick={() => close(true)}>Done</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
