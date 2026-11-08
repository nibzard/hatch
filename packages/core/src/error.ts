/**
 * Readable error formatting for schema parse failures (specification
 * section 19).
 *
 * Agents generate scene specs automatically, so a rejected spec must name
 * the failing fields instead of dumping the raw issue tree.
 */

import { z } from "zod";

/** Render parse issues as "path: message" entries joined by semicolons. */
export function formatIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const location = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${location}: ${issue.message}`;
    })
    .join("; ");
}
