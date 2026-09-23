// Assignment state as a small label; "new" is styled apart from everything that's been acted on.
export default function StateTag({ state }: { state: string }) {
  return <span className={`state-tag ${state}`}>{state}</span>;
}
