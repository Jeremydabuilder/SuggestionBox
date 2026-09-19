"use client";

import { useEffect, useId, useRef } from "react";
import { publicEnv } from "@/lib/env";

type TurnstileApi = {
  render: (
    el: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
      theme?: "light" | "dark" | "auto";
      appearance?: "always" | "execute" | "interaction-only";
    },
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    __turnstileOnLoad?: () => void;
  }
}

const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__turnstileOnLoad";

export interface TurnstileHandle {
  reset: () => void;
}

/**
 * Cloudflare Turnstile — privacy-friendly, no puzzles, no tracking cookies.
 * Renders nothing when NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset.
 */
export default function Turnstile({
  onToken,
  resetSignal,
}: {
  onToken: (token: string | null) => void;
  /** Change this number to force a fresh challenge (e.g. after an error). */
  resetSignal: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const elementId = useId();

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    const siteKey = publicEnv.turnstileSiteKey;
    if (!siteKey || !containerRef.current) return;

    let cancelled = false;
    const container = containerRef.current;

    function renderWidget() {
      if (cancelled || !window.turnstile || widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(container, {
        sitekey: siteKey,
        theme: "light",
        callback: (token) => onTokenRef.current(token),
        "error-callback": () => onTokenRef.current(null),
        "expired-callback": () => onTokenRef.current(null),
      });
    }

    if (window.turnstile) {
      renderWidget();
    } else {
      window.__turnstileOnLoad = renderWidget;
      if (!document.getElementById(SCRIPT_ID)) {
        const script = document.createElement("script");
        script.id = SCRIPT_ID;
        script.src = SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* widget already gone */
        }
      }
      widgetIdRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (resetSignal > 0 && widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
      onTokenRef.current(null);
    }
  }, [resetSignal]);

  if (!publicEnv.turnstileSiteKey) return null;

  return <div ref={containerRef} id={`turnstile-${elementId}`} className="min-h-[65px]" />;
}
