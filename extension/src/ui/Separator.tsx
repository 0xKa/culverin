import { Fragment } from "preact";

export function Separator() {
  return (
    <span className="culverin-separator">
      <span className="sr-only">, </span>
    </span>
  );
}

export function Joined({ parts }: { parts: string[] }) {
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && <Separator />}
          {part}
        </Fragment>
      ))}
    </>
  );
}
