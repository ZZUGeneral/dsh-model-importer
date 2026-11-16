/**
 * Host half of the model importer bundle.
 *
 * The wizard is pure Client work: it calls the existing `settings` /
 * `credentials` / `llm.discoverModels` Remotes, so the Host needs no service
 * of its own. The entry exists so the package is a bundle whose Client module
 * the Web kernel loads.
 */
export function apply() {}
