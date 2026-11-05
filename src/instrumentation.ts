// T-105: Next.js calls register() once when a server instance starts, before it serves requests (never
// during `next build`). A production server with missing or invalid required configuration refuses to
// start: the thrown error stops the process (the container restarts and never becomes healthy) and names
// the variables only. Outside production the problems are logged and the server starts, so a partial local
// setup still runs.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { runtimeConfigProblems } = await import("./lib/startup");
  const problems = runtimeConfigProblems();
  if (!problems.length) return;
  console.error(JSON.stringify({ event: "startup_config_invalid", problems }));
  if (process.env.NODE_ENV === "production") throw new Error(`Invalid server configuration: ${problems.join("; ")}`);
}
