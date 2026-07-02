/**
 * Expression Engine — n8n-compatible expression resolver
 *
 * Supports:
 *   {{$json.fieldName}}            — current node's input JSON field
 *   {{$json["field name"]}}        — bracket notation
 *   {{$node["NodeLabel"].json.x}}  — reference another node's output
 *   {{$now}}                       — current ISO timestamp
 *   {{$runIndex}}                  — current loop iteration index
 *   {{lead.email}}                 — legacy template (backwards compat)
 */

export interface ExpressionContext {
  /** Current node's input JSON */
  $json: Record<string, any>;
  /** All node outputs keyed by node label */
  $nodes?: Record<string, { json: Record<string, any> }>;
  /** Current run/loop index */
  $runIndex?: number;
  /** Trigger data */
  $trigger?: Record<string, any>;
  /** Legacy lead object (backwards compat) */
  lead?: Record<string, any>;
  /** Legacy call object (backwards compat) */
  call?: Record<string, any>;
  /** Loop tracking state keyed by loop_items node ID */
  $loopState?: Record<string, { index: number; items: any[] }>;
}

/**
 * Resolve a single expression like `{{$json.email}}` against a context.
 * Returns the resolved value (any type) or the original expression on failure.
 */
export function resolveExpression(expr: string, ctx: ExpressionContext): any {
  const inner = expr.slice(2, -2).trim(); // strip {{ and }}

  try {
    // Build a safe evaluation scope
    const scope: Record<string, any> = {
      $json: ctx.$json ?? {},
      $node: buildNodeAccessor(ctx.$nodes ?? {}),
      $now: new Date().toISOString(),
      $runIndex: ctx.$runIndex ?? 0,
      $trigger: ctx.$trigger ?? {},
      lead: ctx.lead ?? ctx.$json?.lead ?? {},
      call: ctx.call ?? ctx.$json?.call ?? {},
    };

    // Use Function constructor for safe evaluation (no access to outer scope)
    const keys = Object.keys(scope);
    const values = Object.values(scope);
    // eslint-disable-next-line no-new-func
    const fn = new Function(...keys, `"use strict"; return (${inner});`);
    return fn(...values);
  } catch {
    return expr; // return raw expression if evaluation fails
  }
}

/**
 * Replace all `{{...}}` expressions in a string template.
 * If the entire string is a single expression and evaluates to a non-string,
 * the raw value is returned (preserving types — objects, numbers, etc.)
 */
export function resolveTemplate(template: string, ctx: ExpressionContext): any {
  if (typeof template !== "string") return template;

  const singleExprPattern = /^\{\{.+\}\}$/;
  if (singleExprPattern.test(template.trim())) {
    return resolveExpression(template.trim(), ctx);
  }

  // Multiple expressions — always returns string
  return template.replace(/\{\{([^}]+)\}\}/g, (match) => {
    const resolved = resolveExpression(match, ctx);
    if (resolved === match) return match; // unresolved — keep as-is
    return String(resolved ?? "");
  });
}

/**
 * Recursively resolve all string values in an object using the context.
 */
export function resolveConfigTemplates(
  config: Record<string, any>,
  ctx: ExpressionContext
): Record<string, any> {
  const resolved: Record<string, any> = {};
  for (const [key, val] of Object.entries(config)) {
    if (typeof val === "string") {
      resolved[key] = resolveTemplate(val, ctx);
    } else if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      resolved[key] = resolveConfigTemplates(val, ctx);
    } else if (Array.isArray(val)) {
      resolved[key] = val.map((item) =>
        typeof item === "string"
          ? resolveTemplate(item, ctx)
          : typeof item === "object" && item !== null
          ? resolveConfigTemplates(item, ctx)
          : item
      );
    } else {
      resolved[key] = val;
    }
  }
  return resolved;
}

/**
 * Build the $node["Label"] accessor proxy from node output map.
 */
function buildNodeAccessor(
  nodes: Record<string, { json: Record<string, any> }>
): Record<string, { json: Record<string, any> }> {
  return nodes;
}

/**
 * Validate whether a string contains expression syntax.
 */
export function hasExpression(value: string): boolean {
  return /\{\{.+\}\}/.test(value);
}

/**
 * Get all expression tokens from a string (for UI hints).
 */
export function extractExpressions(value: string): string[] {
  const matches = value.match(/\{\{[^}]+\}\}/g);
  return matches ?? [];
}

/**
 * Evaluate a Switch rule against a data context.
 */
export function evaluateSwitchRule(
  rule: {
    field: string;
    operator: string;
    value: string;
  },
  ctx: ExpressionContext
): boolean {
  try {
    const fieldVal = resolveTemplate(`{{${rule.field}}}`, ctx);
    const compareVal = resolveTemplate(rule.value, ctx);

    switch (rule.operator) {
      case "equals":
        return String(fieldVal).toLowerCase() === String(compareVal).toLowerCase();
      case "not_equals":
        return String(fieldVal).toLowerCase() !== String(compareVal).toLowerCase();
      case "contains":
        return String(fieldVal).toLowerCase().includes(String(compareVal).toLowerCase());
      case "not_contains":
        return !String(fieldVal).toLowerCase().includes(String(compareVal).toLowerCase());
      case "greater_than":
        return Number(fieldVal) > Number(compareVal);
      case "less_than":
        return Number(fieldVal) < Number(compareVal);
      case "is_empty":
        return fieldVal === null || fieldVal === undefined || String(fieldVal).trim() === "";
      case "is_not_empty":
        return fieldVal !== null && fieldVal !== undefined && String(fieldVal).trim() !== "";
      case "regex":
        return new RegExp(compareVal, "i").test(String(fieldVal));
      default:
        return false;
    }
  } catch {
    return false;
  }
}

/**
 * Execute a code node's JavaScript safely in the browser.
 * Returns { success, output, error }.
 */
export function executeCodeNode(
  code: string,
  inputData: any
): { success: boolean; output: any; error?: string; executionMs: number } {
  const start = performance.now();
  try {
    // Build $input helper
    const $input = {
      all: () => (Array.isArray(inputData) ? inputData.map((d: any) => ({ json: d })) : [{ json: inputData }]),
      first: () => ({ json: Array.isArray(inputData) ? inputData[0] : inputData }),
      last: () => ({
        json: Array.isArray(inputData) ? inputData[inputData.length - 1] : inputData,
      }),
      item: { json: Array.isArray(inputData) ? inputData[0] : inputData },
    };

    const $json = Array.isArray(inputData) ? (inputData[0] ?? {}) : (inputData ?? {});

    // eslint-disable-next-line no-new-func
    const fn = new Function("$input", "$json", `"use strict";\n${code}`);
    const result = fn($input, $json);
    const executionMs = Math.round(performance.now() - start);
    return { success: true, output: result ?? {}, executionMs };
  } catch (err: any) {
    const executionMs = Math.round(performance.now() - start);
    return { success: false, output: null, error: err?.message ?? String(err), executionMs };
  }
}
