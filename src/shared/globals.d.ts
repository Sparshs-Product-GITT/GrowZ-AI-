// Ambient module declaration for CSS files. The build (esbuild, see
// build.mjs) uses the "text" loader for .css so these imports resolve to the
// raw stylesheet as a string at bundle time; this declaration just teaches
// TypeScript the same shape.
declare module '*.css' {
  const content: string;
  export default content;
}
