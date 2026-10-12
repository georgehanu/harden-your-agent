// Terminal output for the lessons. No dependencies, just ANSI colours.

import { live, MODELS } from "./model.js";

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number) => (text: string) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);

export const dim = paint(2);
export const bold = paint(1);
export const green = paint(32);
export const red = paint(31);
export const yellow = paint(33);
export const blue = paint(34);
export const magenta = paint(35);
export const cyan = paint(36);

export function banner(title: string) {
  console.log(`\n${bold(title)}`);
  console.log(
    dim(
      live
        ? `live · agent: ${MODELS.smart} · scope: ${MODELS.fast}`
        : "replay · pre-written model turns for the sample requests. Add ANTHROPIC_API_KEY to .env to run live.",
    ),
  );
}

export function rule(label: string) {
  const line = "─".repeat(Math.max(2, 58 - label.length));
  console.log(`\n${bold(cyan(label))} ${dim(line)}`);
}

export function note(text: string) {
  console.log(yellow(`\n${text}`));
}

export function indent(text: string, spaces = 7) {
  return text
    .split("\n")
    .map((line) => " ".repeat(spaces) + line)
    .join("\n");
}

export function block(text: string) {
  console.log(dim(indent(text, 2)));
}
