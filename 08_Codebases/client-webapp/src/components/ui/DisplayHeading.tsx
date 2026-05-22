const BASE_XL = "font-[family-name:var(--font-display)] text-3xl font-bold text-charcoal";
const BASE_MD = "font-[family-name:var(--font-display)] text-xl font-bold text-charcoal";

type Props = React.HTMLAttributes<HTMLHeadingElement> & {
  size?: "xl" | "md";
  as?: "h1" | "h2" | "h3";
};

export function DisplayHeading({ size = "xl", as: Tag = "h1", className, ...props }: Props) {
  const base = size === "xl" ? BASE_XL : BASE_MD;
  return <Tag {...props} className={className ? `${base} ${className}` : base} />;
}
