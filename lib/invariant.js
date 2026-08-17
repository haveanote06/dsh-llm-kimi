/**
 * Invariant checks for configuration and catalog validation. A thrown
 * invariant is a programming/configuration error, never a provider failure.
 * @module dsh-llm-kimi/invariant
 */
/** Throw when `condition` is falsy. */
export function invariant(condition, message) {
    if (!condition)
        throw new Error(message);
}
//# sourceMappingURL=invariant.js.map