// Join class names, dropping falsy values. Mirrors the common API of clsx/classnames.

type CxInput = string | number | false | null | undefined | Record<string, unknown> | CxInput[];

export function cx(...inputs: CxInput[]): string {
  const out: string[] = [];

  for (const input of inputs) {
    if (!input) continue;

    if (typeof input === 'string' || typeof input === 'number') {
      out.push(String(input));
      continue;
    }

    if (Array.isArray(input)) {
      const nested = cx(...input);
      if (nested) out.push(nested);
      continue;
    }

    if (typeof input === 'object') {
      for (const key in input) {
        if (input[key]) out.push(key);
      }
    }
  }

  return out.join(' ');
}
