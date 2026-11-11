// Compilation des programmes (V3-10) : en parallèle avec KHR_parallel_shader_compile quand elle existe (état lu à chaque image,
// jamais bloquant), sinon un programme à la fois, un par tâche. Rien n'est gardé en variable de module : après une perte de contexte on recrée tout.

/**
 * Lance la compilation d'un programme. `poll()` rend 'pending' | 'ready' | 'failed' ; `log` contient le journal en cas d'échec.
 * @param {WebGL2RenderingContext} gl
 * @param {{vs:string, fs:string}} src
 * @param {{parallel?:boolean, now?:()=>number}} [opt]
 */
export function startProgram(gl, src, { parallel = true, now = () => 0 } = {}) {
  const t0 = now();
  const ext = parallel ? gl.getExtension('KHR_parallel_shader_compile') : null;
  const shaders = [];
  const make = (type, text) => { const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); shaders.push(s); return s; };
  const program = gl.createProgram();
  gl.attachShader(program, make(gl.VERTEX_SHADER, src.vs));
  gl.attachShader(program, make(gl.FRAGMENT_SHADER, src.fs));
  gl.linkProgram(program);
  const h = { program, log: '', ms: 0, state: 'pending', parallel: ext !== null, dispose };
  function finish() {
    const ok = gl.getProgramParameter(program, gl.LINK_STATUS) === true;
    if (!ok) {
      h.log = [gl.getProgramInfoLog(program), ...shaders.map((s) => (gl.getShaderParameter(s, gl.COMPILE_STATUS) ? '' : gl.getShaderInfoLog(s)))].filter(Boolean).join('\n');
    }
    for (const s of shaders) { gl.detachShader(program, s); gl.deleteShader(s); }
    shaders.length = 0;
    h.ms = now() - t0;
    h.state = ok ? 'ready' : 'failed';
    if (!ok) { gl.deleteProgram(program); h.program = null; }
    return h.state;
  }
  function dispose() { if (h.program) gl.deleteProgram(h.program); h.program = null; for (const s of shaders) gl.deleteShader(s); shaders.length = 0; h.state = 'failed'; }
  h.poll = () => {
    if (h.state !== 'pending') return h.state;
    if (ext && gl.getProgramParameter(program, ext.COMPLETION_STATUS_KHR) === false) return 'pending';
    return finish();
  };
  return h;
}

/**
 * Compile tous les programmes (`sources` = { nom : {vs, fs} }). Avec l'extension, tout est lancé d'un coup ; `step()` n'avance plus que la scrutation.
 * Sans elle (SwiftShader, Safari non vérifié) : un programme par appel à `step()` (une tâche par image : jamais de longue tâche cumulée).
 * @returns {{step:()=>('pending'|'ready'|'failed'), programs:Object<string,WebGLProgram>, handles:Object, totalMs:number, log:string, dispose:()=>void}}
 */
export function startProgramSet(gl, sources, { parallel = true, now = () => 0 } = {}) {
  const names = Object.keys(sources);
  const hasExt = parallel && gl.getExtension('KHR_parallel_shader_compile') !== null;
  const handles = {};
  const set = { programs: {}, handles, totalMs: 0, log: '', step, dispose };
  const t0 = now();
  if (hasExt) for (const n of names) handles[n] = startProgram(gl, sources[n], { parallel: true, now });
  let next = 0;
  function step() {
    if (set.state === 'ready' || set.state === 'failed') return set.state;
    if (!hasExt) { // un programme par tâche : le lancement et la fin de la compilation sont dans la même tâche (aucune extension pour les séparer)
      if (next < names.length) { const n = names[next++]; handles[n] = startProgram(gl, sources[n], { parallel: false, now }); handles[n].poll(); }
    }
    let allDone = hasExt || next === names.length;
    for (const n of names) {
      if (!handles[n]) continue;
      if (handles[n].poll() === 'pending') allDone = false;
    }
    if (!allDone) return 'pending';
    set.totalMs = now() - t0;
    set.log = names.map((n) => (handles[n] && handles[n].log ? `${n}: ${handles[n].log}` : '')).filter(Boolean).join('\n');
    const ok = names.every((n) => handles[n] && handles[n].state === 'ready');
    if (ok) for (const n of names) set.programs[n] = handles[n].program;
    set.state = ok ? 'ready' : 'failed';
    return set.state;
  }
  function dispose() { for (const n of names) if (handles[n]) handles[n].dispose(); set.state = 'failed'; }
  return set;
}
