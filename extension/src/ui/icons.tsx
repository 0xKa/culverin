import type { ComponentProps } from "preact";

type IconProps = ComponentProps<"svg">;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function GearIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14.51 6.92v2.16l-1.66.13-.57 1.37 1.09 1.26-1.53 1.53-1.26-1.09-1.37.57-.13 1.66H6.92l-.13-1.66-1.37-.57-1.26 1.09-1.53-1.53 1.09-1.26-.57-1.37-1.66-.13V6.92l1.66-.13.57-1.37-1.09-1.26 1.53-1.53 1.26 1.09 1.37-.57.13-1.66h2.16l.13 1.66 1.37.57 1.26-1.09 1.53 1.53-1.09 1.26.57 1.37Z" />
      <circle cx="8" cy="8" r="2.1" />
    </Icon>
  );
}

export function ChevronIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 6.25 8 9.75l3.5-3.5" />
    </Icon>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v3.5M8 5.1v.1" />
    </Icon>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.25 9.25a1 1 0 0 1-.87 1.5H2.75a1 1 0 0 1-.87-1.5Z" />
      <path d="M8 6.25v3M8 11.1v.1" />
    </Icon>
  );
}

export function ExternalIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 3.5h-3v9h9v-3M9.5 2.75h3.75V6.5M13 3 7.75 8.25" />
    </Icon>
  );
}
