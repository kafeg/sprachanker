// SQL files imported as text (migrations), bundled into the binary.
declare module "*.sql" {
  const text: string;
  export default text;
}
