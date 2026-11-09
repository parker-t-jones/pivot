// Test-only in-memory Supabase for the picks tests. Supports the query shapes the picks code
// uses: select (columns ignored), insert (one row or many), upsert, update, delete, eq, in, is,
// single, maybeSingle. Deleting a `pick_slips` row cascades to its `stakes` legs, as the FK does.

export type Row = Record<string, unknown>;

interface Result {
  data: unknown;
  error: null;
}

export class MemSupabase {
  tables = new Map<string, Row[]>();
  private next = 1;

  rows(table: string): Row[] {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = [];
      this.tables.set(table, rows);
    }
    return rows;
  }

  /** The row at `index`. Throws when it is missing, so tests need no non-null assertions. */
  at(table: string, index = 0): Row {
    const row = this.rows(table)[index];
    if (row === undefined) throw new Error(`no row ${index} in ${table}`);
    return row;
  }

  byId(table: string, id: unknown): Row {
    const row = this.rows(table).find((candidate) => candidate['id'] === id);
    if (row === undefined) throw new Error(`no row ${String(id)} in ${table}`);
    return row;
  }

  nextId(): string {
    const id = `00000000-0000-4000-8000-${String(this.next).padStart(12, '0')}`;
    this.next += 1;
    return id;
  }

  from(table: string): MemQuery {
    return new MemQuery(this, table);
  }
}

class MemQuery implements PromiseLike<Result> {
  private mode: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private filters: ((row: Row) => boolean)[] = [];
  private payload: Row | Row[] | null = null;
  private conflictKey = '';
  private one: 'many' | 'maybe' | 'single' = 'many';

  constructor(
    private readonly db: MemSupabase,
    private readonly table: string,
  ) {}

  select(): this {
    return this;
  }

  insert(rows: Row | Row[]): this {
    this.mode = 'insert';
    this.payload = rows;
    return this;
  }

  upsert(row: Row, options: { onConflict: string }): this {
    this.mode = 'upsert';
    this.payload = row;
    this.conflictKey = options.onConflict;
    return this;
  }

  update(row: Row): this {
    this.mode = 'update';
    this.payload = row;
    return this;
  }

  delete(): this {
    this.mode = 'delete';
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: readonly unknown[]): this {
    const allowed = new Set(values);
    this.filters.push((row) => allowed.has(row[column]));
    return this;
  }

  is(column: string, value: null): this {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }

  maybeSingle(): Promise<Result> {
    this.one = 'maybe';
    return this.execute();
  }

  single(): Promise<Result> {
    this.one = 'single';
    return this.execute();
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private shape(rows: Row[]): Result {
    if (this.one === 'many') return { data: rows, error: null };
    return { data: rows[0] ?? null, error: null };
  }

  private execute(): Promise<Result> {
    const rows = this.db.rows(this.table);
    if (this.mode === 'insert' && this.payload) {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      const created = list.map((row) => ({
        id: this.db.nextId(),
        created_at: '2026-10-09T16:00:00.000Z',
        slip_id: null,
        result: null,
        result_value: null,
        settled_at: null,
        ...row,
      }));
      rows.push(...created);
      return Promise.resolve(this.shape(created));
    }
    if (this.mode === 'upsert' && this.payload && !Array.isArray(this.payload)) {
      const payload = this.payload;
      const keys = this.conflictKey.split(',').map((key) => key.trim());
      const exists = rows.some((row) => keys.every((key) => row[key] === payload[key]));
      if (exists) return Promise.resolve({ data: [], error: null });
      const created = { id: this.db.nextId(), ...payload };
      rows.push(created);
      return Promise.resolve({ data: [created], error: null });
    }
    const matched = rows.filter((row) => this.filters.every((keep) => keep(row)));
    if (this.mode === 'update' && this.payload && !Array.isArray(this.payload)) {
      for (const row of matched) Object.assign(row, this.payload);
      return Promise.resolve(this.shape(matched));
    }
    if (this.mode === 'delete') {
      for (const row of matched) {
        rows.splice(rows.indexOf(row), 1);
        if (this.table === 'pick_slips') {
          const legs = this.db.rows('stakes');
          for (const leg of legs.filter((stake) => stake['slip_id'] === row['id'])) {
            legs.splice(legs.indexOf(leg), 1);
          }
        }
      }
      return Promise.resolve({ data: null, error: null });
    }
    return Promise.resolve(this.shape(matched));
  }
}
