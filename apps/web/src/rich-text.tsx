import { Fragment, type ReactNode } from "react";

import { parseRich, type Run } from "./rich-text-model";

/**
 * A workpaper's text section as it is read (docs/design-workpaper.md, section 3.3): the
 * stored text's paragraphs, line breaks, lists, bold, italic and underline, built as
 * elements from the parsed text. Whatever the text says is shown as text: nothing of it
 * is ever taken as markup.
 */

/** A citation mark of a section ("[^3]"), as the workpaper card reads them. */
const CITATION = /(\[\^\d{1,2}\])/;
const CITED = /^\[\^(\d{1,2})\]$/;

/** A run's words, with its citation marks as the card's small numbers. */
function cited(words: string): ReactNode {
  return words.split(CITATION).map((part, at) => {
    const number = CITED.exec(part)?.[1];
    return number === undefined ? (
      part
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts of one text keep their order.
      <sup key={at} className="wp-cite">
        {number}
      </sup>
    );
  });
}

function Runs({ runs, cite }: { runs: readonly Run[]; cite: boolean }) {
  return runs.map((run, at) => {
    let made: ReactNode = cite ? cited(run.t) : run.t;
    if (run.u === true) {
      made = <u>{made}</u>;
    }
    if (run.i === true) {
      made = <em>{made}</em>;
    }
    if (run.b === true) {
      made = <strong>{made}</strong>;
    }
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts of one text keep their order.
      <Fragment key={at}>{made}</Fragment>
    );
  });
}

export function RichText({
  text,
  cite = false,
}: {
  /** The section's text as stored, marks included. */
  text: string;
  /** Citation marks ("[^3]") are shown as the card's numbers; otherwise as they stand. */
  cite?: boolean | undefined;
}) {
  return parseRich(text).map((block, at) => {
    if (block.type === "p") {
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: parts of one text keep their order.
        <p key={at}>
          {block.lines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: parts of one text keep their order.
            <Fragment key={index}>
              {index > 0 ? <br /> : null}
              <Runs runs={line} cite={cite} />
            </Fragment>
          ))}
        </p>
      );
    }
    const List = block.type;
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts of one text keep their order.
      <List key={at}>
        {block.items.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts of one text keep their order.
          <li key={index}>
            <Runs runs={item} cite={cite} />
          </li>
        ))}
      </List>
    );
  });
}
