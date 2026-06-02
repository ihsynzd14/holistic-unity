import type { TierKey } from "./TierIcon";

const LABEL: Record<TierKey, string> = {
  practitioner: "PRACTITIONER",
  trainer: "TRAINER",
  supervisor: "SUPERVISOR",
};

const CHEVRON: Record<TierKey, string> = {
  practitioner: ">",
  trainer: ">>",
  supervisor: ">>>",
};

const COLOR: Record<TierKey, string> = {
  practitioner: "bg-berry text-white shadow-sm",
  trainer: "bg-berry-dark text-white shadow-sm",
  supervisor:
    "bg-gold text-white shadow-[0_0_14px_rgba(201,169,110,0.55)]",
};

type Props = {
  tier: TierKey;
  compact?: boolean;
  className?: string;
};

export function TierLabel({ tier, compact = false, className }: Props) {
  const size = compact
    ? "gap-1.5 px-3 py-1 text-[10px] tracking-[0.18em]"
    : "gap-2 px-5 py-2 text-xs tracking-[0.22em]";
  return (
    <span
      className={`inline-flex items-center rounded-full font-bold uppercase ${size} ${COLOR[tier]} ${className ?? ""}`}
    >
      <span aria-hidden>{CHEVRON[tier]}</span>
      <span>{LABEL[tier]}</span>
    </span>
  );
}
