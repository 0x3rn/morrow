import Image from "next/image";
import type { ComponentProps } from "react";

import styles from "@/app/page.module.css";

interface BrandLogoProps extends Pick<ComponentProps<typeof Image>, "className"> {
  variant?: "auto" | "light" | "dark";
}

export function BrandLogo({ className, variant = "auto" }: BrandLogoProps) {
  const baseClassName = className ?? styles.brandLogo;

  if (variant === "dark") {
    return (
      <Image
        alt=""
        aria-hidden="true"
        className={baseClassName}
        height={500}
        src="/logo-dark.png"
        unoptimized
        width={500}
      />
    );
  }

  if (variant === "light") {
    return (
      <Image
        alt=""
        aria-hidden="true"
        className={baseClassName}
        height={500}
        src="/logo.png"
        unoptimized
        width={500}
      />
    );
  }

  return (
    <>
      <Image
        alt=""
        aria-hidden="true"
        className={`${baseClassName} block dark:hidden`}
        height={500}
        src="/logo.png"
        unoptimized
        width={500}
      />
      <Image
        alt=""
        aria-hidden="true"
        className={`${baseClassName} hidden dark:block`}
        height={500}
        src="/logo-dark.png"
        unoptimized
        width={500}
      />
    </>
  );
}
