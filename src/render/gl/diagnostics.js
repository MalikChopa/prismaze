// Diagnostics de l'hôte (≤ 2 Ko, V3-10) : { programs, compileMs, linkOk, logs, objects }.
export function createDiagnostics() {
  const d = { programs: 0, compileMs: 0, linkOk: true, logs: [], objects: 0, contextMs: 0, probeMs: 0, compileStartMs: 0 };
  return {
    data: d,
    reset() { d.programs = 0; d.compileMs = 0; d.linkOk = true; d.logs = []; d.objects = 0; d.compileStartMs = 0; },
    program(ok, log, ms) {
      d.programs += 1; d.compileMs = Math.max(d.compileMs, Math.round(ms * 10) / 10);
      if (!ok) d.linkOk = false;
      if (log) d.logs.push(String(log).slice(0, 400));
    },
    snapshot() { return { programs: d.programs, compileMs: d.compileMs, linkOk: d.linkOk, logs: d.logs.slice(), objects: d.objects }; },
  };
}
