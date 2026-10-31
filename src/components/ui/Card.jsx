export function Card({ children, className = '' }) {
  return <div className={`card mb-4 ${className}`}>{children}</div>;
}
export function CardHead({ title, children }) {
  return (
    <div className="card-head">
      <h2>{title}</h2>
      {children}
    </div>
  );
}
export function CardBody({ children, className = '' }) {
  return <div className={`card-body ${className}`}>{children}</div>;
}
