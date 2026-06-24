const BASE = "flex h-[60vh] items-center justify-center";

export function LoadingContainer({ className, ...props }: React.ComponentProps<"div">) {
  return <div {...props} className={className ? `${BASE} ${className}` : BASE} />;
}
