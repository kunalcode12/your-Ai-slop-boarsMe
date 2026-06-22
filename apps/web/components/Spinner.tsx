import clsx from "clsx";

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx(
        "inline-block h-5 w-5 animate-spin rounded-full border-[3px] border-ink-line border-t-slop",
        className,
      )}
    />
  );
}
