const BASE = "mb-1.5 block text-sm font-medium text-charcoal-light";

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label {...props} className={className ? `${BASE} ${className}` : BASE} />;
}
