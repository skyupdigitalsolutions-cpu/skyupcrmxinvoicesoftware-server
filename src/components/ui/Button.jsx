export default function Button({ variant = 'gold', size, className = '', ...props }) {
  const base = { gold: 'btn-gold', dark: 'btn-dark', green: 'btn-green', red: 'btn-red', blue: 'btn-blue', outline: 'btn-outline' }[variant] || 'btn-gold';
  return <button className={`${base} ${size === 'sm' ? 'btn-sm' : ''} ${className}`} {...props} />;
}
