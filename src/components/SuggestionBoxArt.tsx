"use client";

import { forwardRef } from "react";

/**
 * The suggestion box itself — drawn, not photographed, not an emoji.
 * Navy linework on warm card stock with one accent panel.
 */
const SuggestionBoxArt = forwardRef<SVGSVGElement, { className?: string }>(
  function SuggestionBoxArt({ className }, ref) {
    return (
      <svg
        ref={ref}
        viewBox="0 0 260 210"
        className={className}
        role="img"
        aria-label="An illustrated suggestion box with a slot in the lid"
      >
        <defs>
          <clipPath id="box-body-clip">
            <path d="M40 78 H220 V178 Q220 186 212 186 H48 Q40 186 40 178 Z" />
          </clipPath>
        </defs>

        {/* soft ground shadow */}
        <ellipse cx="130" cy="196" rx="86" ry="7" fill="#101935" opacity="0.09" />

        {/* legs */}
        <path
          d="M62 184 L56 199 M198 184 L204 199"
          stroke="#101935"
          strokeWidth="5"
          strokeLinecap="round"
        />

        {/* body */}
        <path
          d="M40 78 H220 V178 Q220 186 212 186 H48 Q40 186 40 178 Z"
          fill="#FFFFFF"
          stroke="#101935"
          strokeWidth="4"
          strokeLinejoin="round"
        />

        {/* accent band across the front */}
        <g clipPath="url(#box-body-clip)">
          <rect x="40" y="128" width="180" height="26" fill="#E24E1B" />
          <path
            d="M40 118 H220 M40 164 H220"
            stroke="#101935"
            strokeWidth="2.5"
            opacity="0.25"
          />
        </g>

        {/* label plate */}
        <rect
          x="96"
          y="94"
          width="68"
          height="20"
          rx="4"
          fill="#FBF7F0"
          stroke="#101935"
          strokeWidth="3"
        />
        <text
          x="130"
          y="108.5"
          textAnchor="middle"
          fontSize="11"
          fontWeight="700"
          letterSpacing="2"
          fill="#101935"
          fontFamily="var(--font-display), system-ui, sans-serif"
        >
          IDEAS
        </text>

        {/* lid */}
        <path
          d="M30 56 H230 Q238 56 238 64 V74 Q238 80 230 80 H30 Q22 80 22 74 V64 Q22 56 30 56 Z"
          fill="#FFFFFF"
          stroke="#101935"
          strokeWidth="4"
          strokeLinejoin="round"
        />

        {/* the slot */}
        <rect x="88" y="64" width="84" height="9" rx="4.5" fill="#101935" />
        <rect x="88" y="64" width="84" height="4" rx="2" fill="#101935" opacity="0.55" />

        {/* rivets */}
        <circle cx="38" cy="68" r="3" fill="#101935" />
        <circle cx="222" cy="68" r="3" fill="#101935" />

        {/* a few paper edges peeking out of the lid seam */}
        <path
          d="M104 56 V49 M126 56 V45 M150 56 V51"
          stroke="#101935"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.35"
        />
      </svg>
    );
  },
);

export default SuggestionBoxArt;
