import type { SVGProps } from "react";

/** The Torch3 flame, drawn from assets/torch3-mark.svg without its tile so it sits on any surface. */
export function TorchMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="18 6 28 50" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient
          id="torch3-flame"
          x1="32"
          y1="8"
          x2="32"
          y2="54"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="var(--color-amber-400)" />
          <stop offset="0.55" stopColor="var(--color-orange-400)" />
          <stop offset="1" stopColor="var(--color-red-500)" />
        </linearGradient>
      </defs>
      <path
        d="M32 8c3 7 12 13 12 25a12 12 0 0 1-24 0c0-6 3-10 6-13 0 5 2 8 5 9-2-8 0-15 1-21z"
        fill="url(#torch3-flame)"
      />
      <path d="M32 31c2 3 5 5 5 9a5 5 0 0 1-10 0c0-3 2-5 5-9z" fill="var(--color-zinc-25)" />
    </svg>
  );
}
