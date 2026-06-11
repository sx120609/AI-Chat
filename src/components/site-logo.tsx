type SiteLogoProps = {
  className?: string;
};

export function SiteLogo({ className = "size-8" }: SiteLogoProps) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={className}
      draggable={false}
      src="/logo.svg"
    />
  );
}
