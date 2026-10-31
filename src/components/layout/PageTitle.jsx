export default function PageTitle({ icon, children, badge, actions }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="flex items-center gap-2.5 text-lg font-bold text-navy sm:text-xl">
        {icon && <span>{icon}</span>}
        {children}
        {badge != null && (
          <span className="rounded-full bg-gold-light px-2 py-0.5 text-[11px] font-bold text-navy-700">{badge}</span>
        )}
      </h1>
      {actions}
    </div>
  );
}