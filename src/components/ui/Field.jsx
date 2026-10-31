export function Field({ label, children }) {
  return (
    <label className="flex flex-col">
      {label && <span className="field-label">{label}</span>}
      {children}
    </label>
  );
}

export function Input({ className = '', ...props }) {
  return <input className={`input ${className}`} {...props} />;
}

export function Select({ className = '', children, ...props }) {
  return <select className={`input ${className}`} {...props}>{children}</select>;
}

export function Textarea({ className = '', ...props }) {
  return <textarea className={`input resize-y min-h-[55px] ${className}`} {...props} />;
}
