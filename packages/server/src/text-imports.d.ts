// Files imported as text and bundled into the binary: SQL migrations, the mlx-lm lock.
declare module "*.sql" {
  const text: string;
  export default text;
}
declare module "*.txt" {
  const text: string;
  export default text;
}
