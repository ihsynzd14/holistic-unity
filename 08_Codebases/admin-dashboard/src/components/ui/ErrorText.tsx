const BASE = "text-center text-sm text-error";

export function ErrorText({ className, ...props }: React.ComponentProps<"p">) {
  return <p {...props} className={className ? `${BASE} ${className}` : BASE} />;
}
