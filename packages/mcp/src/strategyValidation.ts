import type { Strategy } from "@msl/mercadolibre";

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStrategy(value: unknown): value is Strategy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const strategy = value as Record<string, unknown>;
  switch (strategy.type) {
    case "margin":
      return isFiniteNumber(strategy.percentage);
    case "category_filter":
      return Array.isArray(strategy.excluded) && strategy.excluded.every((id) => typeof id === "string");
    case "stock":
      return (
        (strategy.available_quantity === undefined || isFiniteNumber(strategy.available_quantity)) &&
        (strategy.limit === undefined || isFiniteNumber(strategy.limit))
      );
    case "pricing_rule":
      return (
        (strategy.floor === undefined || isFiniteNumber(strategy.floor)) &&
        (strategy.cap === undefined || isFiniteNumber(strategy.cap))
      );
    default:
      return false;
  }
}

export function areStrategies(value: unknown): value is Strategy[] {
  return Array.isArray(value) && value.length > 0 && value.every(isStrategy);
}
