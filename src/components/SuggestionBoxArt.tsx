"use client";

/**
 * The suggestion box.
 *
 * The front face is frontal; the top and the right side recede up-and-RIGHT
 * towards a single vanishing point far off the top right. The direction
 * matters: whichever way the depth points is the side face you actually see,
 * and the other one is hidden behind the front face.
 *
 * Receding edges CONVERGE rather than shifting rigidly — the lid's back edge
 * is narrower than its front edge. A rigid shear is what makes an oblique
 * drawing read as a flat rhombus stuck on a rectangle; the convergence is
 * what makes this read as a box.
 *
 * The lid is a slab, not a plane: it overhangs the body by 4 units all round
 * and shows its own front and right edges. That thickness, and the shadow it
 * casts on the front face, is most of what stops the box reading as flat
 * artwork.
 *
 * The projection also earns its keep in the animation: it keeps the slot's
 * front lip perfectly horizontal, which is what lets the paper be clipped
 * exactly on that line as it goes in.
 *
 * It renders in two layers that share one viewBox, so they register exactly:
 *
 *   "back"  — the body, the right side, the label holder, the lock, the
 *             cast shadow.
 *   "front" — the lid slab, with the slot cut out of its top surface as a
 *             real hole, the dark recess seen through that hole, and the
 *             bevel of the cut.
 *
 * Between the two sits the paper, so it can disappear into the box rather
 * than pass over it.
 *
 * The viewBox is cropped tight to the drawing. Empty margin here turns into
 * a gap between the note and the box on the page.
 *
 *   depth         left edge (+46, -34), right edge (+34, -34)
 *   lid slab      y = 14 (back) → 48 (top surface front) → 56 (under the lip)
 *   lid top       front x = 58 → 310, back x = 104 → 344
 *   front face    y = 56 → 180,  x = 62 → 306
 *   slot          y = 26 (back) → 38 (front lip)
 *   slot at lip   x = 150 → 242
 */

/** The slot's FRONT edge, as fractions of the viewBox — not its bounding box. */
export const SLOT_BOX = {
  left: 150 / 400,
  top: 26 / 216,
  width: (242 - 150) / 400,
  height: (38 - 26) / 216,
} as const;

type Layer = "back" | "front";

export default function SuggestionBoxArt({
  layer,
  className,
}: {
  layer: Layer;
  className?: string;
}) {
  return layer === "back" ? (
    <BackLayer className={className} />
  ) : (
    <FrontLayer className={className} />
  );
}

/* ------------------------------------------------------------------ */
/* Shared paint                                                        */
/* ------------------------------------------------------------------ */

function Paint({ id }: { id: string }) {
  return (
    <defs>
      {/* Painted navy, lit from the upper left. */}
      <linearGradient id={`${id}-front`} x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stopColor="#25335E" />
        <stop offset="0.55" stopColor="#1B2748" />
        <stop offset="1" stopColor="#151F3B" />
      </linearGradient>
      <linearGradient id={`${id}-top`} x1="0.1" y1="1" x2="0.75" y2="0">
        <stop offset="0" stopColor="#36497D" />
        <stop offset="1" stopColor="#27375F" />
      </linearGradient>
      <linearGradient id={`${id}-side`} x1="0" y1="0" x2="1" y2="0.4">
        <stop offset="0" stopColor="#18223F" />
        <stop offset="1" stopColor="#0D1527" />
      </linearGradient>
      {/* The lid's own front edge: a vertical face, shaded by its own top. */}
      <linearGradient id={`${id}-lip`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#2A3A6B" />
        <stop offset="0.55" stopColor="#1D2951" />
        <stop offset="1" stopColor="#141D3A" />
      </linearGradient>

      {/* The dark inside of the box, seen through the slot. */}
      <linearGradient id={`${id}-recess`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#0A1022" />
        <stop offset="0.5" stopColor="#05080F" />
        <stop offset="1" stopColor="#0C1326" />
      </linearGradient>

      {/* Brushed brass for the label holder and the lock. */}
      <linearGradient id={`${id}-brass`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#EAD5A4" />
        <stop offset="0.3" stopColor="#C9A667" />
        <stop offset="0.62" stopColor="#A9863F" />
        <stop offset="1" stopColor="#DABF87" />
      </linearGradient>
      <linearGradient id={`${id}-label`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#FDFBF6" />
        <stop offset="1" stopColor="#F1E8D8" />
      </linearGradient>

      {/* Where the lid overhangs and shades the front face. */}
      <linearGradient id={`${id}-seam`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#000000" stopOpacity="0.38" />
        <stop offset="1" stopColor="#000000" stopOpacity="0" />
      </linearGradient>

      <radialGradient id={`${id}-ground`} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#101935" stopOpacity="0.3" />
        <stop offset="0.6" stopColor="#101935" stopOpacity="0.12" />
        <stop offset="1" stopColor="#101935" stopOpacity="0" />
      </radialGradient>

      {/* Painted wood: a fine grain that stays crisp at any size. */}
      <pattern id={`${id}-grain`} width="6" height="5" patternUnits="userSpaceOnUse">
        <path d="M0 1.2h6M0 3.4h6" stroke="#FFFFFF" strokeWidth="0.5" opacity="0.04" />
        <path d="M0 2.3h6" stroke="#000000" strokeWidth="0.5" opacity="0.045" />
      </pattern>
      <pattern
        id={`${id}-grain-top`}
        width="7"
        height="5"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(-7)"
      >
        <path d="M0 1.4h7M0 3.6h7" stroke="#FFFFFF" strokeWidth="0.5" opacity="0.045" />
        <path d="M0 2.5h7" stroke="#000000" strokeWidth="0.5" opacity="0.04" />
      </pattern>
    </defs>
  );
}

/* ------------------------------------------------------------------ */
/* Back layer — the body                                               */
/* ------------------------------------------------------------------ */

const FRONT_FACE = "M62 56 H306 V173 Q306 180 299 180 H69 Q62 180 62 173 Z";
const SIDE_FACE = "M306 56 L340 22 V139 Q340 146 336 146 L306 180 Z";

function BackLayer({ className }: { className?: string }) {
  const id = "sbx-b";
  return (
    <svg
      viewBox="0 0 400 216"
      className={className}
      role="img"
      aria-label="A navy painted wooden suggestion box with a brass label holder reading Suggestions"
    >
      <Paint id={id} />

      {/* --- shadow on the floor ----------------------------------- */}
      <g data-box-shadow>
        <ellipse cx="200" cy="192" rx="154" ry="15" fill={`url(#${id}-ground)`} />
        <ellipse cx="196" cy="183" rx="118" ry="4.5" fill="#101935" opacity="0.2" />
      </g>

      <g data-box-body>
        {/* --- narrow right side, turned away from the light -------- */}
        <path d={SIDE_FACE} fill={`url(#${id}-side)`} />
        <path d={SIDE_FACE} fill={`url(#${id}-grain-top)`} />
        {/* its far vertical edge picks up a rim from the surroundings */}
        <path d="M340 23 V145" stroke="#3E4E80" strokeOpacity="0.32" strokeWidth="1.2" />

        {/* --- front face ------------------------------------------ */}
        <path d={FRONT_FACE} fill={`url(#${id}-front)`} />
        <path d={FRONT_FACE} fill={`url(#${id}-grain)`} />

        {/* deep shadow thrown by the overhanging lid */}
        <path d="M62 56 H306 V78 H62 Z" fill={`url(#${id}-seam)`} />

        {/* --- recessed front panel (joinery) ---------------------- */}
        <rect x="80" y="74" width="208" height="84" rx="4" fill="#000000" opacity="0.07" />
        <path d="M80 158 V74 H288" fill="none" stroke="#000000" strokeOpacity="0.22" strokeWidth="1.4" />
        <path d="M80.7 158.7 H288 V74" fill="none" stroke="#5A6C9E" strokeOpacity="0.3" strokeWidth="1.4" />

        {/* --- brass label holder ---------------------------------- */}
        <g data-box-label>
          {/* the holder's shadow on the panel */}
          <rect x="98" y="91" width="176" height="42" rx="3" fill="#000000" opacity="0.2" />
          {/* brass frame */}
          <rect x="96" y="88" width="176" height="42" rx="3" fill={`url(#${id}-brass)`} />
          {/* cream paper label */}
          <rect x="100.5" y="92.5" width="167" height="33" rx="1.5" fill={`url(#${id}-label)`} />
          <text
            x="184"
            y="108"
            textAnchor="middle"
            fontSize="13"
            fontWeight="700"
            letterSpacing="2.4"
            fill="#16203C"
            fontFamily="var(--font-display), system-ui, sans-serif"
          >
            SUGGESTIONS
          </text>
          {/* a thin accent rule, tying the box to the site palette */}
          <rect x="154" y="114.5" width="60" height="2" rx="1" fill="#E24E1B" opacity="0.85" />
          {/* the holder's lower lip, catching light */}
          <path d="M96 123 H272 V127 Q272 130 269 130 H99 Q96 130 96 127 Z" fill="#000000" opacity="0.13" />
          <path d="M97 89.2 H271" stroke="#F6E6BE" strokeOpacity="0.75" strokeWidth="1.2" />
          {/* two small screws */}
          <circle cx="104.5" cy="109.6" r="2.5" fill="#8A6A33" />
          <circle cx="104.5" cy="109" r="2.5" fill="#D9BD84" />
          <path d="M103 109h3" stroke="#7A5C2C" strokeWidth="0.8" />
          <circle cx="263.5" cy="109.6" r="2.5" fill="#8A6A33" />
          <circle cx="263.5" cy="109" r="2.5" fill="#D9BD84" />
          <path d="M262 109h3" stroke="#7A5C2C" strokeWidth="0.8" />
        </g>

        {/* --- discreet lock --------------------------------------- */}
        <g>
          <circle cx="184" cy="147" r="8" fill="#000000" opacity="0.18" />
          <circle cx="184" cy="146" r="8" fill={`url(#${id}-brass)`} />
          <circle cx="184" cy="146" r="8" fill="none" stroke="#7A5C2C" strokeOpacity="0.5" strokeWidth="0.8" />
          <path
            d="M184 142.6a2 2 0 0 1 1 3.75l0.95 3.15h-3.9l0.95-3.15a2 2 0 0 1 1-3.75Z"
            fill="#0D1426"
            opacity="0.85"
          />
        </g>

        {/* --- plinth, wrapping round onto the side ---------------- */}
        <path d="M62 164 H306 V173 Q306 180 299 180 H69 Q62 180 62 173 Z" fill="#000000" opacity="0.15" />
        <path d="M306 164 L340 130 V139 Q340 146 336 146 L306 180 Z" fill="#000000" opacity="0.13" />
        <path d="M62 164 H306 L340 130" fill="none" stroke="#54659A" strokeOpacity="0.28" strokeWidth="1.2" />
        <path d="M62 166 H306" stroke="#000000" strokeOpacity="0.2" strokeWidth="1" />

        {/* --- silhouette edges: left turns away, right is the corner seam */}
        <path d="M62.7 58 V178" stroke="#4A5C90" strokeOpacity="0.38" strokeWidth="1.3" />
        <path d="M306 56 V180" stroke="#000000" strokeOpacity="0.32" strokeWidth="1.4" />
        <path d="M304.6 57 V179" stroke="#5A6C9E" strokeOpacity="0.2" strokeWidth="1" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Front layer — the lid slab, with the slot cut through its top       */
/* ------------------------------------------------------------------ */

// Top surface, then the slot, wound so fill-rule="evenodd" punches the slot
// out as a genuine hole. Whatever sits beneath shows through it.
const LID_TOP = "M58 48 H310 L344 14 H104 Z";
const SLOT = "M150 38 H242 L255.3 26 H164.9 Z";
// The lid's own thickness: a front edge you look straight at, and a right
// edge that recedes with the box.
const LID_LIP = "M58 48 H310 V56 H58 Z";
const LID_SIDE = "M310 48 L344 14 V22 L310 56 Z";

function FrontLayer({ className }: { className?: string }) {
  const id = "sbx-f";
  return (
    <svg viewBox="0 0 400 216" className={className} aria-hidden focusable="false">
      <Paint id={id} />

      {/* --- what you see down inside the box ---------------------- */}
      <path d={SLOT} fill={`url(#${id}-recess)`} />
      {/* the lit top of the far inner wall */}
      <path d="M164.9 27.1 H255.3" stroke="#2C3E6B" strokeWidth="2" strokeOpacity="0.9" />
      {/* a couple of notes already inside, just catching the light */}
      <g opacity="0.5">
        <path d="M162 33.5 H210" stroke="#C9C2B4" strokeWidth="1.5" strokeOpacity="0.5" />
        <path d="M192 30.4 H238" stroke="#C9C2B4" strokeWidth="1.2" strokeOpacity="0.36" />
      </g>

      {/* --- a sheet mid-entry shows here, behind the top surface --- */}
      {/* Dim, because it is paper sitting down inside a dark box — not a
          card plugging the slot. */}
      <g data-slot-sliver opacity="0">
        <path d="M154 36.4 H238 L250 27.6 H168.5 Z" fill="#9A927F" opacity="0.62" />
        <path d="M154 36.4 H238" stroke="#5E5849" strokeWidth="1" strokeOpacity="0.55" />
      </g>

      {/* --- the lid slab ------------------------------------------ */}
      <g data-box-lid>
        {/* its thickness, drawn first so the top surface sits on it */}
        <path d={LID_SIDE} fill={`url(#${id}-side)`} />
        <path d={LID_LIP} fill={`url(#${id}-lip)`} />
        <path d={LID_LIP} fill={`url(#${id}-grain)`} />
        {/* the underside of the overhang, in shadow */}
        <path d="M58 54.8 H310 V56 H58 Z" fill="#000000" opacity="0.22" />

        {/* the top surface, slot punched out */}
        <path d={`${LID_TOP} ${SLOT}`} fillRule="evenodd" fill={`url(#${id}-top)`} />
        <path d={`${LID_TOP} ${SLOT}`} fillRule="evenodd" fill={`url(#${id}-grain-top)`} />

        {/* the cut's bevel: dark on the near lip, a highlight just in front */}
        <path d="M150 38 H242" stroke="#05080F" strokeWidth="1.5" strokeOpacity="0.85" />
        <path d="M150 39.3 H242" stroke="#4E619A" strokeWidth="1.2" strokeOpacity="0.5" />
        <path d="M150 38 L164.9 26" stroke="#05080F" strokeWidth="1.1" strokeOpacity="0.5" />
        <path d="M242 38 L255.3 26" stroke="#05080F" strokeWidth="1.1" strokeOpacity="0.5" />

        {/* a shallow dish around the slot, so the cut reads as recessed */}
        <path
          d="M139 41 H253 L272.6 23 H161.5 Z"
          fill="none"
          stroke="#0B1224"
          strokeOpacity="0.12"
          strokeWidth="3"
        />

        {/* arrises: the lit leading edges of the slab */}
        <path d="M58 48.7 H310" stroke="#6D7FB4" strokeOpacity="0.4" strokeWidth="1.3" />
        <path d="M58 48 L104 14" stroke="#7688BC" strokeOpacity="0.3" strokeWidth="1.3" />
        <path d="M104 14.8 H344" stroke="#7688BC" strokeOpacity="0.28" strokeWidth="1.2" />
        <path d="M310 48 L344 14" stroke="#0B1224" strokeOpacity="0.5" strokeWidth="1.3" />
        <path d="M58 48 V56" stroke="#4A5C90" strokeOpacity="0.38" strokeWidth="1.2" />
      </g>

      {/* --- contact shadow, cast onto the lid by the arriving note -- */}
      <g data-contact-shadow opacity="0">
        <ellipse cx="196" cy="33" rx="58" ry="8" fill="#050A16" opacity="0.5" />
      </g>
    </svg>
  );
}
