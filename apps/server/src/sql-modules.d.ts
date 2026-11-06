/** `.sql` files are imported as plain text (esbuild `text` loader, Vitest sql-as-text plugin). */
declare module '*.sql' {
  const sqlText: string;
  export default sqlText;
}
