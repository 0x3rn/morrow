import Image from "next/image";
import type { ComponentProps } from "react";

import styles from "@/app/page.module.css";

export function BrandLogo({ className }: Pick<ComponentProps<typeof Image>, "className">) {
  return (
    <Image
      alt=""
      aria-hidden="true"
      className={className ?? styles.brandLogo}
      height={1254}
      src="/logo.png"
      unoptimized
      width={1254}
    />
  );
}
