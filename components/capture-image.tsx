"use client";

/* eslint-disable @next/next/no-img-element -- protected captures require the original URL and the browser session cookie */

import { useCallback, useState } from "react";

interface CaptureImageProps {
  src: string;
  alt: string;
}

function CaptureImageContent({ src, alt }: CaptureImageProps) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");

  // A cached image may finish before hydration attaches its load/error handlers.
  const imageRef = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete) {
      setState(image.naturalWidth > 0 ? "loaded" : "error");
    }
  }, []);

  return (
    <div className="workspace-capture-frame max-h-[560px] overflow-auto bg-slate-100 sm:max-h-[680px] lg:max-h-[720px]" data-state={state} aria-busy={state === "loading"}>
      {state !== "loaded" ? (
        <p className="workspace-capture-status" role="status">
          {state === "loading"
            ? "Loading capture…"
            : "This capture couldn't be loaded. Open the full capture to try viewing it separately."}
        </p>
      ) : null}
      {state !== "error" ? (
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setState("loaded")}
          onError={() => setState("error")}
          className="block h-auto w-full"
        />
      ) : null}
    </div>
  );
}

export function CaptureImage(props: CaptureImageProps) {
  // Changing records starts the new image in its own loading state.
  return <CaptureImageContent key={props.src} {...props} />;
}
