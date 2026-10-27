import type { ReactNode } from "react";

export const X_URL = "https://x.com/sdkfund";

export function XIcon({ size = 15 }: { size?: number }): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.725-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function XLink({
  size = 15,
  className,
  children,
}: {
  size?: number;
  className?: string;
  children?: ReactNode;
}): ReactNode {
  return (
    <a
      href={X_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={children ? undefined : "SDK on X"}
      className={className}
    >
      <XIcon size={size} />
      {children}
    </a>
  );
}
