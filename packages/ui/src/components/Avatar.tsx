import type { Appearance } from "@cr/sim";

const SKIN: Record<Appearance["skinTone"], string> = {
  "Very light": "#f6dcc8",
  Light: "#eac3a2",
  Medium: "#d2a07a",
  Olive: "#b98a5e",
  Brown: "#8d5a3b",
  Dark: "#5c3a26",
};
const HAIR: Record<Appearance["hairColor"], string> = {
  Black: "#1c1a1a",
  "Dark brown": "#3b2a20",
  Brown: "#6b4a2f",
  Auburn: "#8a3d22",
  Red: "#b5472a",
  Blonde: "#d9b86a",
  Gray: "#a3a3a3",
};
const EYES: Record<Appearance["eyeColor"], string> = {
  Brown: "#4a2f1d",
  Hazel: "#7a5a2a",
  Green: "#3f7a4a",
  Blue: "#3b6ea8",
  Gray: "#6f7b85",
};
const BUILD: Record<Appearance["build"], number> = {
  Slim: 30,
  Average: 36,
  Athletic: 40,
  Heavy: 46,
};

/** A simple illustrated portrait that reflects the character's appearance choices. */
export function Avatar({ appearance, size = 140 }: { appearance: Appearance; size?: number }) {
  const skin = SKIN[appearance.skinTone];
  const hair = HAIR[appearance.hairColor];
  const shoulder = BUILD[appearance.build];
  const style = appearance.hairStyle;
  return (
    <svg
      viewBox="0 0 120 140"
      width={size}
      height={(size * 140) / 120}
      role="img"
      aria-label="Character portrait"
    >
      <rect width="120" height="140" rx="12" fill="var(--panel-2)" />
      {(style === "Long" || style === "Braided") && (
        <path d="M32 50 Q30 100 40 108 L80 108 Q90 100 88 50 Z" fill={hair} />
      )}
      <path
        d={`M${60 - shoulder} 140 Q${60 - shoulder} 104 60 100 Q${60 + shoulder} 104 ${60 + shoulder} 140 Z`}
        fill="#3d5a73"
      />
      <rect x="52" y="82" width="16" height="20" rx="6" fill={skin} />
      <ellipse cx="60" cy="58" rx="24" ry="28" fill={skin} />
      {style === "Short" && (
        <path d="M36 52 Q38 26 60 26 Q82 26 84 52 Q78 38 60 38 Q42 38 36 52 Z" fill={hair} />
      )}
      {style === "Buzzed" && (
        <path
          d="M37 50 Q40 30 60 30 Q80 30 83 50 Q74 40 60 40 Q46 40 37 50 Z"
          fill={hair}
          opacity="0.75"
        />
      )}
      {style === "Medium" && (
        <path d="M34 66 Q30 26 60 24 Q90 26 86 66 Q82 44 60 40 Q38 44 34 66 Z" fill={hair} />
      )}
      {style === "Long" && (
        <path d="M34 70 Q30 24 60 24 Q90 24 86 70 Q82 42 60 38 Q38 42 34 70 Z" fill={hair} />
      )}
      {style === "Curly" && (
        <g fill={hair}>
          {[38, 46, 54, 62, 70, 78, 84, 36].map((x, i) => (
            <circle key={i} cx={x} cy={i === 7 || i === 6 ? 46 : 32 + (i % 2) * 4} r="9" />
          ))}
        </g>
      )}
      {style === "Braided" && (
        <>
          <path d="M34 60 Q30 24 60 24 Q90 24 86 60 Q82 40 60 38 Q38 40 34 60 Z" fill={hair} />
          {[0, 1, 2, 3].map((i) => (
            <ellipse key={i} cx="88" cy={68 + i * 10} rx="5" ry="6" fill={hair} />
          ))}
        </>
      )}
      <circle cx="51" cy="60" r="3" fill={EYES[appearance.eyeColor]} />
      <circle cx="69" cy="60" r="3" fill={EYES[appearance.eyeColor]} />
      <path
        d="M53 74 Q60 79 67 74"
        stroke="#5a3a2a"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
