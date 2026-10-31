export default function Spinner({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-ink-3">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-gold border-t-transparent" />
      <span className="text-xs">{label}</span>
    </div>
  );
}
