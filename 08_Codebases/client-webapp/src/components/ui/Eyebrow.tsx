const BASE = "text-[11px] font-bold uppercase tracking-[0.18em] text-gold-dark";

export function Eyebrow({ className, ...props }: React.ComponentProps<"p">) {
  return <p {...props} className={className ? `${BASE} ${className}` : BASE} />;
}
