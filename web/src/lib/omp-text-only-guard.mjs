/** Trusted OMP extension: no tool can run, even a dynamically added MCP tool. */
export default function textOnlyGuard(api, attest) {
  if (typeof api?.on !== "function" || typeof api.setActiveTools !== "function" || typeof api.getActiveTools !== "function") {
    throw new Error("Career text-only guard cannot initialize on this OMP runtime.");
  }
  const disableTools = async () => {
    await api.setActiveTools([]);
    const active = api.getActiveTools();
    if (!Array.isArray(active) || active.length !== 0) throw new Error("Career text-only guard could not clear active tools.");
  };
  api.on("tool_call", () => ({ block: true, reason: "Career text-only worker forbids every tool call." }));
  api.on("session_start", async () => {
    await disableTools();
    attest();
  });
  api.on("before_agent_start", disableTools);
}
