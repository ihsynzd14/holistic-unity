const BASE =
  "w-full rounded-[14px] border border-berry-subtle bg-white px-4 py-3 text-charcoal placeholder-charcoal-muted/40 outline-none transition-all duration-300 focus:border-berry focus:ring-2 focus:ring-berry/10";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input {...props} className={className ? `${BASE} ${className}` : BASE} />;
}
