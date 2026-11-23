import * as React from "react"

import { cn } from "@/lib/utils"

export interface BrandLogoProps {
  name: string
  size?: "sm" | "md" | "lg"
  variant?: "tile" | "glyph"
  className?: string
}

interface LogoSpec {
  tileBg?: string
  isCircular?: boolean
  renderSvg: (uid: string) => React.ReactNode
}

function normalizeLogoKey(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")
}

const WHITE = "rgb(255, 255, 255)"
const INK_DARK = "rgb(24, 24, 27)"
const OBSIDIAN = "rgb(17, 17, 14)"
const DARK_TILE = "rgb(31, 31, 34)"
const SLATE_TILE = "rgb(15, 15, 17)"

const LOGO_SPECS: Record<string, LogoSpec> = {
  github: {
    tileBg: INK_DARK,
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <path
          fill={WHITE}
          d="M20 8.5A11.5 11.5 0 0 0 8.5 20c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-1.95c-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.16 1.18a11 11 0 0 1 5.76 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.08 0 4.41-2.69 5.39-5.26 5.67.42.36.79 1.07.79 2.15v3.19c0 .31.21.67.8.55A11.5 11.5 0 0 0 31.5 20 11.5 11.5 0 0 0 20 8.5Z"
        />
      </svg>
    ),
  },
  linear: {
    tileBg: "rgb(20, 22, 38)",
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <path
          fill="rgb(129, 140, 248)"
          d="M5.6 22.8A14.8 14.8 0 0 0 17.2 34.4L5.6 22.8Zm-.3-4.3 16.2 16.2a14.8 14.8 0 0 0 3.3-1.3L6.6 15.2a14.8 14.8 0 0 0-1.3 3.3Zm3.3-6.6 19.5 19.5a14.8 14.8 0 0 0 2.3-2.3L10.9 9.6a14.8 14.8 0 0 0-2.3 2.3Zm5.2-4.3 18.6 18.6A14.8 14.8 0 0 0 13.8 7.6Z"
        />
      </svg>
    ),
  },
  slack: {
    tileBg: DARK_TILE,
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <path
          fill="rgb(224, 30, 90)"
          d="M14.2 22.4a2.3 2.3 0 1 1-2.3-2.3h2.3v2.3Zm1.2 0a2.3 2.3 0 0 1 4.6 0v5.8a2.3 2.3 0 0 1-4.6 0v-5.8Z"
        />
        <path
          fill="rgb(54, 197, 240)"
          d="M17.7 14.2a2.3 2.3 0 1 1 2.3-2.3v2.3h-2.3Zm0 1.2a2.3 2.3 0 0 1 0 4.6h-5.8a2.3 2.3 0 0 1 0-4.6h5.8Z"
        />
        <path
          fill="rgb(46, 182, 125)"
          d="M25.8 17.7a2.3 2.3 0 1 1 2.3 2.3h-2.3v-2.3Zm-1.2 0a2.3 2.3 0 0 1-4.6 0v-5.8a2.3 2.3 0 0 1 4.6 0v5.8Z"
        />
        <path
          fill="rgb(236, 178, 46)"
          d="M22.3 25.8a2.3 2.3 0 1 1-2.3 2.3v-2.3h2.3Zm0-1.2a2.3 2.3 0 0 1 0-4.6h5.8a2.3 2.3 0 0 1 0 4.6h-5.8Z"
        />
      </svg>
    ),
  },
  notion: {
    tileBg: "rgb(28, 28, 26)",
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <path
          fill={WHITE}
          d="M10.8 10.6 25 9.2c1.1-.1 1.6.2 2.4.8l3.2 2.2c.4.3.6.6.6 1.1v16.4c0 1-.4 1.6-1.5 1.7l-15.6.9c-1 .1-1.5-.1-2-.8l-2.6-3.4c-.4-.6-.6-1-.6-1.7V12.2c0-.9.5-1.5 1.9-1.6Z"
        />
        <path fill={OBSIDIAN} d="M14.2 14.3h13.2v14.8l-13.2.8V14.3Z" />
        <path
          fill={WHITE}
          d="M16.6 16.6h2.7l5.2 8.1v-8.1h2.1v11.1h-2.5l-5.4-8.4v8.4h-2.1V16.6Z"
        />
      </svg>
    ),
  },
  sentry: {
    tileBg: "rgb(54, 45, 89)",
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <path
          fill={WHITE}
          d="M21.4 10.2a1.7 1.7 0 0 0-2.9 0l-9.2 15.9a1.7 1.7 0 0 0 1.4 2.5h3.5a11.3 11.3 0 0 0-1.4-4.7l-1.5 2.6 8.6-14.9 8.6 14.9h-2.6a15 15 0 0 1-.5 2.1h4.6a1.7 1.7 0 0 0 1.4-2.5l-10-15.9Zm-1.4 7.7a7.8 7.8 0 0 0-3.3 10.7h2.4a5.4 5.4 0 0 1 2.2-7.3l-1.3-3.4Z"
        />
      </svg>
    ),
  },
  "context7-docs": {
    tileBg: "rgb(14, 30, 23)",
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <rect
          x="7"
          y="7"
          width="26"
          height="26"
          rx="7"
          fill="rgb(15, 123, 79)"
        />
        <path
          fill="none"
          stroke={WHITE}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M18.5 14.5h-3a4.5 4.5 0 0 0 0 9h3"
        />
        <path
          fill="none"
          stroke="rgb(95, 209, 156)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21.5 14.5h6l-4.2 10.5"
        />
      </svg>
    ),
  },
  figma: {
    tileBg: "rgb(30, 30, 34)",
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <path
          fill="rgb(242, 78, 30)"
          d="M15.5 8h4.5v8h-4.5a4 4 0 0 1 0-8Z"
        />
        <path
          fill="rgb(255, 114, 98)"
          d="M20 8h4.5a4 4 0 0 1 0 8H20V8Z"
        />
        <path
          fill="rgb(162, 89, 255)"
          d="M15.5 16h4.5v8h-4.5a4 4 0 0 1 0-8Z"
        />
        <circle cx="24" cy="20" r="4" fill="rgb(26, 188, 254)" />
        <path
          fill="rgb(10, 207, 131)"
          d="M15.5 24H20v4a4 4 0 1 1-4.5-4Z"
        />
      </svg>
    ),
  },
  postgresql: {
    tileBg: "rgb(51, 103, 145)",
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <path
          fill="none"
          stroke={WHITE}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M24.2 12.2c2.8 0 5.3 2.1 5.6 5.4.3 3.4-1.2 6.8-3.4 8.2-.7.4-1.2 1.2-1.2 2.4v2.4a1.6 1.6 0 0 1-3.2 0v-4.2m-4-14.2c-3.2 0-6.2 2.2-6.5 5.8-.3 3.4 1.3 6.5 3.6 7.4m3-13.2a5.8 5.8 0 0 1 6.1 0M17.5 18.2v6.6c0 2.5 1.8 4.4 4.1 4.4"
        />
        <circle cx="17.5" cy="16.5" r="1.2" fill={WHITE} />
        <circle cx="23.5" cy="16.5" r="1.2" fill={WHITE} />
      </svg>
    ),
  },
  stripe: {
    tileBg: "rgb(99, 91, 255)",
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <path
          fill="rgb(138, 133, 255)"
          d="M0 24.5 40 16v24H0V24.5Z"
          opacity="0.42"
        />
        <path fill={WHITE} d="M11 16.4 29 11.8v11.8L11 28.2V16.4Z" />
      </svg>
    ),
  },
  cloudflare: {
    tileBg: DARK_TILE,
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <path
          fill="rgb(243, 128, 32)"
          d="M27.8 25.5H11.4a3.9 3.9 0 0 1-.8-7.7 5.7 5.7 0 0 1 10.9-1.6 4.1 4.1 0 0 1 5.7 2.8 3.3 3.3 0 0 1 .6 6.5Z"
        />
        <path
          fill="rgb(250, 173, 63)"
          d="M28.6 19.6a3.2 3.2 0 0 0-3.1 2.4h4.7a2 2 0 0 1 1.9 2.1 2 2 0 0 1-2 1.4h-2.3a3.3 3.3 0 0 0 .8-5.9Z"
        />
      </svg>
    ),
  },
  supabase: {
    tileBg: "rgb(15, 123, 79)",
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <rect
          x="3"
          y="3"
          width="34"
          height="34"
          rx="9"
          fill="rgb(15, 123, 79)"
        />
        <path
          fill="rgb(62, 207, 142)"
          d="M22.2 32.8c-.9 1.1-2.7.5-2.7-.9V21.5h10.8c1.5 0 2.3 1.7 1.4 2.9l-9.5 8.4Z"
        />
        <path
          fill={WHITE}
          d="M17.8 7.2c.9-1.1 2.7-.5 2.7.9v10.4H9.7c-1.5 0-2.3-1.7-1.4-2.9l9.5-8.4Z"
        />
      </svg>
    ),
  },
  vercel: {
    tileBg: SLATE_TILE,
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <polygon fill={WHITE} points="20,10.5 30.5,28.5 9.5,28.5" />
      </svg>
    ),
  },
  jira: {
    tileBg: "rgb(16, 42, 86)",
    renderSvg: (uid) => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <defs>
          <linearGradient id={`grad-jira-${uid}`} x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(0, 82, 204)" />
            <stop offset="100%" stopColor="rgb(38, 132, 255)" />
          </linearGradient>
        </defs>
        <path
          fill="rgb(38, 132, 255)"
          d="M29.5 10.5H19.4a4.6 4.6 0 0 0 4.6 4.6h1.9v1.8a4.6 4.6 0 0 0 4.6 4.6v-10a1 1 0 0 0-1-1Z"
        />
        <path
          fill={`url(#grad-jira-${uid})`}
          d="M24.5 15.5H14.4a4.6 4.6 0 0 0 4.6 4.6h1.9v1.8a4.6 4.6 0 0 0 4.6 4.6v-10a1 1 0 0 0-1-1Z"
        />
        <path
          fill="rgb(133, 184, 255)"
          d="M19.5 20.5H9.4a4.6 4.6 0 0 0 4.6 4.6h1.9v1.8a4.6 4.6 0 0 0 4.6 4.6v-10a1 1 0 0 0-1-1Z"
        />
      </svg>
    ),
  },
  confluence: {
    tileBg: "rgb(16, 42, 86)",
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <path
          fill="rgb(38, 132, 255)"
          d="M10.4 24.4c-.4.7-.9 1.5-1.2 2.1a1 1 0 0 0 .4 1.3l4.7 2.8a1 1 0 0 0 1.4-.4c.3-.6.8-1.4 1.2-2.1 2.8-4.6 5.6-4.1 10.6-1.7l4.6 2.2a1 1 0 0 0 1.3-.5l2.2-5a1 1 0 0 0-.5-1.3c-1.4-.7-4.1-2-5.4-2.6-7.6-3.7-14-3.4-19.3 5.2Z"
        />
        <path
          fill="rgb(133, 184, 255)"
          d="M29.6 15.6c.4-.7.9-1.5 1.2-2.1a1 1 0 0 0-.4-1.3l-4.7-2.8a1 1 0 0 0-1.4.4c-.3.6-.8 1.4-1.2 2.1-2.8 4.6-5.6 4.1-10.6 1.7L7.9 11.4a1 1 0 0 0-1.3.5l-2.2 5a1 1 0 0 0 .5 1.3c1.4.7 4.1 2 5.4 2.6 7.6 3.7 14 3.4 19.3-5.2Z"
        />
      </svg>
    ),
  },
  "google-drive": {
    tileBg: DARK_TILE,
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <g transform="translate(8 9.2) scale(0.86)">
          <path
            fill="rgb(0, 102, 218)"
            d="M4.6 24.3 6.3 27.2c.4.7.9 1.2 1.6 1.6l5-8.7H2.9c0 .8.2 1.6.6 2.3l1.1 1.9Z"
          />
          <path
            fill="rgb(0, 172, 71)"
            d="M15 10.1 10 1.4c-.7.4-1.2.9-1.6 1.6L1.9 14.3a4.6 4.6 0 0 0-.6 2.3h10l3.7-6.5Z"
          />
          <path
            fill="rgb(234, 67, 53)"
            d="M22.1 28.8c.7-.4 1.2-.9 1.6-1.6l1.7-2.9 1.1-1.9c.4-.7.6-1.5.6-2.3h-10l2.1 4.2 2.9 4.5Z"
          />
          <path
            fill="rgb(0, 131, 45)"
            d="M15 10.1 20 1.4a4.6 4.6 0 0 0-2.3-.6h-5.4a4.6 4.6 0 0 0-2.3.6l5 8.7Z"
          />
          <path
            fill="rgb(38, 132, 252)"
            d="M17.1 20.1h-4.2l-5 8.7c.7.4 1.5.6 2.3.6h9.6c.8 0 1.6-.2 2.3-.6l-5-8.7Z"
          />
          <path
            fill="rgb(255, 186, 0)"
            d="M24.2 14.3 18.6 4.5l-.9-1.5a4.6 4.6 0 0 0-1.6-1.6l-5 8.7 5.8 10h10.2c0-.8-.2-1.6-.6-2.3l-2.3-3.5Z"
          />
        </g>
      </svg>
    ),
  },
  playwright: {
    tileBg: "rgb(26, 33, 29)",
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <path
          fill="rgb(214, 83, 72)"
          d="M10.5 13.5c0 8.5 3 13 7.5 14.5 2.5-.8 4.4-2.8 5.6-6-2.7-2.4-4-6-4-10.2-3.2 1.2-6 1.7-9.1 1.7Z"
        />
        <path
          fill="rgb(46, 173, 51)"
          d="M18.5 11.5c0 10.2 3.6 15.6 9.5 17.5 4.8-1.6 7.5-7 7.5-15.5-5.6 0-11.2-1-17-2Z"
        />
        <circle cx="24.2" cy="18.6" r="1.4" fill={WHITE} />
        <circle cx="30" cy="18.6" r="1.4" fill={WHITE} />
        <path
          fill="none"
          stroke={WHITE}
          strokeWidth="1.6"
          strokeLinecap="round"
          d="M24.5 22.8c1.5 1.3 3.7 1.3 5.2 0"
        />
      </svg>
    ),
  },
  firebase: {
    tileBg: DARK_TILE,
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <path
          fill="rgb(255, 145, 0)"
          d="M21.2 7.5c1.8 4.4 7.8 9.2 7.8 16.3a9 9 0 0 1-18 0c0-3.2 1.4-6.4 3.4-8.8.4 2.1 1.6 3.7 3.3 4.3-1-4.3.7-8.7 3.5-11.8Z"
        />
        <path
          fill="rgb(255, 202, 40)"
          d="M18.6 18.8c-1.8 2.4-2.8 5-2.1 7.8a6.8 6.8 0 0 0 5.3 4.9 6.6 6.6 0 0 1-8.4-6.3c0-3 1.8-5.2 5.2-6.4Z"
        />
        <path
          fill="rgb(244, 81, 30)"
          d="M21.2 7.5c4.6 4.7 7.8 9.6 7.8 16.3a9 9 0 0 1-7.2 8.8c2.6-2.2 3.8-5.5 3.1-9-.7-3.4-3-6.2-4.8-8.9.2-2.8.5-5.1 1.1-7.2Z"
        />
      </svg>
    ),
  },
  dynatrace: {
    tileBg: DARK_TILE,
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <polygon fill="rgb(163, 230, 53)" points="10,12 24,7 31,12 18,16" />
        <polygon fill="rgb(34, 197, 94)" points="31,12 31,27 23,33 23,18" />
        <polygon fill="rgb(56, 189, 248)" points="10,12 18,16 18,28 10,31" />
        <polygon fill="rgb(147, 51, 234)" points="10,31 18,28 23,33 14,34" />
        <polygon fill={OBSIDIAN} points="16.5,16.5 24,15 24,25.5 16.5,27" />
      </svg>
    ),
  },
  gmail: {
    tileBg: DARK_TILE,
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <g transform="translate(6 9.5) scale(0.933)">
          <path
            fill="rgb(66, 133, 244)"
            d="M2.5 22.5h4.5V11.2L0 6v14a2.5 2.5 0 0 0 2.5 2.5Z"
          />
          <path
            fill="rgb(52, 168, 83)"
            d="M23 22.5h4.5A2.5 2.5 0 0 0 30 20V6l-7 5.2v11.3Z"
          />
          <path
            fill="rgb(251, 188, 4)"
            d="M23 2.5v8.7L30 6V3.5A3.5 3.5 0 0 0 24.4.7L23 2.5Z"
          />
          <path
            fill="rgb(234, 67, 53)"
            d="M7 11.2V2.5L15 8.5l8-6v8.7l-8 6-8-6Z"
          />
          <path
            fill="rgb(197, 34, 31)"
            d="M0 3.5V6l7 5.2V2.5L5.6.7A3.5 3.5 0 0 0 0 3.5Z"
          />
        </g>
      </svg>
    ),
  },
  health: {
    tileBg: DARK_TILE,
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <path
          fill="rgb(229, 57, 70)"
          d="M20 8.5c2.2 0 3.7 1.3 5.2 2.2 1.6.9 3.6 1 4.6 2.7 1 1.7.4 3.5.7 5.2.3 1.8 1.5 3.2.9 5-.6 1.8-2.4 2.5-3.5 3.9-1.2 1.4-1.7 3.3-3.5 3.9-1.8.6-3.4-.5-5.3-.5-1.9 0-3.5 1.1-5.3.5-1.8-.6-2.3-2.5-3.5-3.9-1.1-1.4-2.9-2.1-3.5-3.9-.6-1.8.6-3.2.9-5 .3-1.7-.3-3.5.7-5.2 1-1.7 3-1.8 4.6-2.7 1.5-.9 3-2.2 5.2-2.2Z"
        />
        <path
          fill={WHITE}
          d="M20 26.2s-5.8-3.6-5.8-7.4a3.3 3.3 0 0 1 5.8-2.1 3.3 3.3 0 0 1 5.8 2.1c0 3.8-5.8 7.4-5.8 7.4Z"
        />
      </svg>
    ),
  },
  "remote-desktop-commander": {
    tileBg: "rgb(26, 26, 29)",
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <path
          fill={WHITE}
          d="M8.5 13h6.2c4 0 6.8 2.7 6.8 7s-2.8 7-6.8 7H8.5V13Zm3.4 3v8h2.6c2.2 0 3.5-1.5 3.5-4s-1.3-4-3.5-4h-2.6Z"
        />
        <path
          fill={WHITE}
          d="M28.6 15.8c-2 0-3.3 1.6-3.3 4.2s1.3 4.2 3.3 4.2c1.2 0 2.1-.5 2.7-1.4l2.4 1.8c-1.1 1.6-2.8 2.6-5.2 2.6-4.1 0-6.8-2.9-6.8-7.2s2.7-7.2 6.8-7.2c2.4 0 4.1 1 5.2 2.6l-2.4 1.8c-.6-.9-1.5-1.4-2.7-1.4Z"
        />
        <rect x="27.5" y="18.7" width="4.2" height="2.6" rx="0.6" fill={WHITE} />
      </svg>
    ),
  },
  "writing-style": {
    tileBg: WHITE,
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <path
          fill="none"
          stroke={INK_DARK}
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13.5 26.5c1.5-5.6 4.2-9.6 9.8-12.8 1.6-.9 3.6.3 3.2 2.1-1.1 5-4.7 8.4-10.3 9.7l-2.7 1Zm0 0 6.2-6.2"
        />
        <circle cx="20.2" cy="19.8" r="1.2" fill={INK_DARK} />
      </svg>
    ),
  },
  "icloud-mail": {
    renderSvg: (uid) => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <defs>
          <linearGradient id={`grad-imail-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(78, 179, 255)" />
            <stop offset="100%" stopColor="rgb(26, 117, 245)" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" fill={`url(#grad-imail-${uid})`} />
        <rect x="8.5" y="12.5" width="23" height="15" rx="2.5" fill={WHITE} />
        <path
          d="M9.5 13.5 20 21.3l10.5-7.8"
          fill="none"
          stroke="rgb(30, 123, 245)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  "icloud-calendar": {
    tileBg: WHITE,
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <rect width="40" height="40" fill={WHITE} />
        <text
          x="20"
          y="13.5"
          textAnchor="middle"
          fill="rgb(255, 59, 48)"
          fontFamily="Inter, -apple-system, sans-serif"
          fontSize="8"
          fontWeight="700"
        >
          Tue
        </text>
        <text
          x="20"
          y="31.5"
          textAnchor="middle"
          fill={INK_DARK}
          fontFamily="Inter, -apple-system, sans-serif"
          fontSize="19.5"
          fontWeight="600"
        >
          1
        </text>
      </svg>
    ),
  },
  elevenlabs: {
    tileBg: SLATE_TILE,
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <rect x="15.5" y="12.5" width="3.2" height="15" rx="0.6" fill={WHITE} />
        <rect x="21.3" y="12.5" width="3.2" height="15" rx="0.6" fill={WHITE} />
      </svg>
    ),
  },
  tripsy: {
    tileBg: WHITE,
    renderSvg: (uid) => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <defs>
          <linearGradient id={`grad-tripsy-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(251, 146, 60)" />
            <stop offset="100%" stopColor="rgb(234, 88, 12)" />
          </linearGradient>
        </defs>
        <path
          d="M15.5 13.5v-2.2a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v2.2"
          fill="none"
          stroke="rgb(234, 88, 12)"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <rect
          x="8.5"
          y="13.5"
          width="23"
          height="17"
          rx="4.5"
          fill={`url(#grad-tripsy-${uid})`}
        />
        <rect x="13" y="13.5" width="2.4" height="17" fill={WHITE} opacity="0.28" />
        <rect x="24.6" y="13.5" width="2.4" height="17" fill={WHITE} opacity="0.28" />
        <rect x="17.5" y="19.5" width="5" height="3.2" rx="1" fill={WHITE} />
      </svg>
    ),
  },
  sonos: {
    tileBg: SLATE_TILE,
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <text
          x="20"
          y="22.4"
          textAnchor="middle"
          fill={WHITE}
          fontFamily="Inter, -apple-system, sans-serif"
          fontSize="7.4"
          fontWeight="700"
          letterSpacing="1.4"
        >
          SONOS
        </text>
      </svg>
    ),
  },
  hevy: {
    tileBg: "rgb(20, 20, 23)",
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <path
          fill="none"
          stroke={WHITE}
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10.5 16v8M13.8 13.5v13a1.2 1.2 0 0 0 2.4 0v-4.3h7.6v4.3a1.2 1.2 0 0 0 2.4 0v-13a1.2 1.2 0 0 0-2.4 0v4.3h-7.6v-4.3a1.2 1.2 0 0 0-2.4 0ZM29.5 16v8"
        />
      </svg>
    ),
  },
  dropbox: {
    tileBg: "rgb(0, 97, 255)",
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <g fill={WHITE}>
          <polygon points="14.5,10.5 8.5,14.4 14.5,18.3 20,14.4" />
          <polygon points="25.5,10.5 20,14.4 25.5,18.3 31.5,14.4" />
          <polygon points="8.5,22.2 14.5,26.1 20,22.2 14.5,18.3" />
          <polygon points="25.5,18.3 20,22.2 25.5,26.1 31.5,22.2" />
          <polygon points="14.5,27.5 20,23.6 25.5,27.5 20,31.2" />
        </g>
      </svg>
    ),
  },
  hubspot: {
    tileBg: "rgb(255, 92, 53)",
    renderSvg: () => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <g fill={WHITE} stroke={WHITE} strokeLinecap="round">
          <circle cx="22.8" cy="21" r="4.6" fill="none" strokeWidth="2.5" />
          <line x1="22.8" y1="16.2" x2="22.8" y2="11.5" strokeWidth="2.2" />
          <circle cx="22.8" cy="10.4" r="2.2" stroke="none" />
          <line x1="18.6" y1="18.8" x2="14.4" y2="16.2" strokeWidth="2.2" />
          <circle cx="13.2" cy="15.4" r="2" stroke="none" />
          <line x1="18.9" y1="23.8" x2="14.2" y2="27.2" strokeWidth="2.2" />
          <circle cx="13" cy="28" r="2.6" stroke="none" />
          <line x1="27.3" y1="21" x2="30.2" y2="21" strokeWidth="2.2" />
          <circle cx="30.8" cy="21" r="1.8" stroke="none" />
        </g>
      </svg>
    ),
  },
  canva: {
    isCircular: true,
    renderSvg: (uid) => (
      <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
        <defs>
          <linearGradient id={`grad-canva-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgb(0, 196, 204)" />
            <stop offset="52%" stopColor="rgb(74, 108, 247)" />
            <stop offset="100%" stopColor="rgb(125, 42, 232)" />
          </linearGradient>
        </defs>
        <circle cx="20" cy="20" r="19" fill={`url(#grad-canva-${uid})`} />
        <text
          x="20"
          y="23.5"
          textAnchor="middle"
          fill={WHITE}
          fontFamily="Georgia, 'Times New Roman', serif"
          fontStyle="italic"
          fontSize="11.2"
          fontWeight="700"
        >
          Canva
        </text>
      </svg>
    ),
  },
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length >= 2) {
    return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

export function BrandLogo({
  name,
  size = "md",
  variant = "tile",
  className,
}: BrandLogoProps) {
  const rawId = React.useId()
  const safeUid = rawId.replace(/[^a-zA-Z0-9_-]/g, "") || "logo"
  const key = normalizeLogoKey(name)
  const spec = LOGO_SPECS[key]

  const svgNode = spec ? (
    spec.renderSvg(safeUid)
  ) : (
    <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
      <rect width="40" height="40" rx="10" fill="var(--bg-active)" />
      <text
        x="20"
        y="24.5"
        textAnchor="middle"
        fill="var(--text-1)"
        fontFamily="Inter, -apple-system, sans-serif"
        fontSize="13"
        fontWeight="600"
      >
        {getInitials(name)}
      </text>
    </svg>
  )

  if (variant === "glyph") {
    return (
      <span
        data-brand-logo={key}
        className={cn("inline-flex size-full items-center justify-center", className)}
      >
        {svgNode}
      </span>
    )
  }

  const sizeClass =
    size === "sm"
      ? "size-[18px] rounded-[5px]"
      : size === "lg"
        ? "size-12 rounded-[13px]"
        : "size-10 rounded-[10px]"

  return (
    <span
      data-brand-logo={key}
      aria-hidden="true"
      style={spec?.tileBg ? { backgroundColor: spec.tileBg } : undefined}
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden border border-premium shadow-bevel-surface",
        spec?.isCircular && "rounded-full border-transparent shadow-none",
        !spec?.tileBg && !spec?.isCircular && "bg-raised",
        sizeClass,
        className
      )}
    >
      {svgNode}
    </span>
  )
}
