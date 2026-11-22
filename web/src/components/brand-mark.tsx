import { useId } from "react";

// Custom geometric SVG brand mark for dreamkur -job:
// Squircle gradient amber-copper badge with lowercase "dk" monogram and a
// subtle radar spark star, crisp in both dark and light themes at any size.
export function BrandMark({ size = 30 }: { size?: number }) {
  const gradId = `dk-grad-${useId().replace(/:/g, "")}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 96 96"
      width={size}
      height={size}
      aria-hidden="true"
      className="shrink-0 drop-shadow-xs"
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#E68438" />
          <stop offset="100%" stopColor="#BC5814" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="92" height="92" rx="22" fill={`url(#${gradId})`} stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
      <path
        d="M38 25 V67 M38 47 C35 42 20 42 20 55 C20 68 35 68 38 63"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="7.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M50 25 V67 M68 43 L51 55 L70 67"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="7.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M72 15 Q72 24 81 24 Q72 24 72 33 Q72 24 63 24 Q72 24 72 15 Z"
        fill="#FFF7ED"
      />
    </svg>
  );
}
