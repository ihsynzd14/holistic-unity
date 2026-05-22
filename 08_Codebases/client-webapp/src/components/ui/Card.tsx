const BASE = "rounded-2xl border border-berry/5 bg-white/70 p-6 shadow-sm backdrop-blur-sm";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div {...props} className={className ? `${BASE} ${className}` : BASE} />;
}
