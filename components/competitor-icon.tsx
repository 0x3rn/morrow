"use client";

/* eslint-disable @next/next/no-img-element -- competitor icons are external assets with an initial fallback */

import { useCallback, useState } from "react";

interface CompetitorIconProps {
  name: string;
  src: string | null;
  variant?: "list" | "profile";
}

function IconImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  const imageRef = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth === 0) setFailed(true);
  }, []);

  if (failed) return null;

  return (
    <img
      ref={imageRef}
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className="workspace-competitor-icon-image"
    />
  );
}

export function CompetitorIcon({ name, src, variant = "list" }: CompetitorIconProps) {
  return (
    <div className={`workspace-competitor-icon workspace-competitor-icon-${variant}`} aria-hidden="true">
      <span>{name.charAt(0).toUpperCase()}</span>
      {src ? <IconImage key={src} src={src} /> : null}
    </div>
  );
}
