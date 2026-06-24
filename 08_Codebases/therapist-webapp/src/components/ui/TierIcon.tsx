import Image from "next/image";

export type TierKey = "practitioner" | "trainer" | "supervisor";

const ALT: Record<TierKey, string> = {
  practitioner: "Practitioner",
  trainer: "Trainer",
  supervisor: "Supervisor",
};

type Props = {
  tier: TierKey;
  size?: number;
  className?: string;
};

export function TierIcon({ tier, size = 80, className }: Props) {
  return (
    <Image
      src={`/tier-${tier}.svg`}
      alt={ALT[tier]}
      width={size}
      height={size}
      className={className}
    />
  );
}
