import {
  ignoreGroups,
  MAX_RULES,
  MAX_RULES_BYTES,
  ruleError,
} from "../counter/rules";

const encoder = new TextEncoder();
const USAGE_SHOWN_AT = 0.8;

export function entries(group: (typeof ignoreGroups)[number]): string[] {
  return [
    ...group.directories.map((name) => `${name}/`),
    ...group.files,
    ...group.suffixes.map((suffix) => `*${suffix}`),
  ];
}

export function parseRules(text: string): {
  rules: string[];
  errors: string[];
  usage: string[];
} {
  const rules: string[] = [];
  const errors: string[] = [];
  text.split("\n").forEach((line, index) => {
    const rule = line.trim();
    if (!rule) return;
    const error = ruleError(rule);
    if (error) errors.push(`Line ${index + 1}: ${error}`);
    else rules.push(rule);
  });
  const uniqueRules = [...new Set(rules)];
  const bytes = uniqueRules.reduce(
    (sum, rule) => sum + encoder.encode(rule).length,
    0,
  );
  if (uniqueRules.length > MAX_RULES)
    errors.push(`Use at most ${MAX_RULES} rules.`);
  if (bytes > MAX_RULES_BYTES)
    errors.push(`Rules can use at most ${MAX_RULES_BYTES} bytes in total.`);
  return {
    rules: uniqueRules,
    errors,
    usage:
      uniqueRules.length >= MAX_RULES * USAGE_SHOWN_AT ||
      bytes >= MAX_RULES_BYTES * USAGE_SHOWN_AT
        ? [
            `${uniqueRules.length} of ${MAX_RULES} rules`,
            `${bytes.toLocaleString()} of ${MAX_RULES_BYTES.toLocaleString()} bytes`,
          ]
        : [],
  };
}
