// Files imported as text and bundled into the binary (SQL migrations).
declare module "*.sql" {
  const text: string;
  export default text;
}
