/**
 * Shared surface for bot, web, and future providers.
 * Server-only modules (e.g. formatters that touch NFL data structures) stay importable from API routes only.
 */
export * from "./dashboard.js";
export * from "./sleeperLinks.js";
export { categoriesForTransaction, formatTransactionLine } from "../services/notifications/formatTransaction.js";
