/** The clear control is visible only while the field has characters. */
export function searchClearVisible(query: string): boolean {
  return query.length > 0;
}

/** Selecting a result or tapping clear empties the query so the next search can start. */
export function queryAfterSearchReset(): string {
  return '';
}
