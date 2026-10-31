export default function EmptyState({ title = 'Nothing here yet', hint, action }) {
  return (
    <div className="py-16 text-center">
      <p className="text-sm font-bold text-ink-2">{title}</p>
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
