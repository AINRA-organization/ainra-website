// SPDX-License-Identifier: Apache-2.0 OR MIT
// AINRA World, the drawing engine. Plain WebGL2, no library: points, lines and the character views.
// It draws what it is given and knows nothing about the record.
//
//   points   one vertex per point (place, radius in world units, ink 0..1, shape, tone); sizes shrink with distance,
//            points off the focus plane grow soft, far points fade into the paper. A set can be a globe: its points
//            then lie on a sphere, the far side is drawn fainter and the side facing the light paler, so a ball of
//            dots reads as a round body. A single point can be drawn as a shaded ball.
//   lines    one instance per segment, widened in screen space so a hairline stays a hairline at any zoom
//   views    the finished frame redrawn as text, braille dots or an ordered dither
// Everything is drawn as ink coverage over a transparent canvas, so the page's own paper shows through.

const VS_FULL = `#version 300 es
layout(location=0) in vec2 aP; out vec2 vUv; void main(){ vUv = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }`;

const VS_POINT = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in float aSize; layout(location=2) in float aInk; layout(location=3) in float aShape; layout(location=4) in float aTone;
uniform mat4 uVP; uniform float uScale, uFocus, uDof, uFogA, uFogB, uMinPx, uSpin, uReveal, uCount; uniform vec4 uGlobe; uniform vec3 uEye, uLight;
out float vA; out float vShape; out float vTone; out float vPx;
void main(){
  vec3 pos = aPos; float shown = 1.0;
  if (uGlobe.w > 0.0) {                                     // a globe turns about its own axis, and its points are written in from the first
    float c = cos(uSpin), q = sin(uSpin); pos = uGlobe.xyz + vec3(c * aPos.x + q * aPos.z, aPos.y, -q * aPos.x + c * aPos.z);   // its points are measured from its centre
    shown = clamp((uReveal - float(gl_VertexID) / uCount) * 9.0, 0.0, 1.0);
  }
  vec4 p = uVP * vec4(pos, 1.0); gl_Position = p; float w = max(p.w, 1.0);
  float d = 2.0 * aSize * uScale / w;                       // diameter in device pixels
  float coc = min(uDof * abs(w - uFocus) / uFocus, 1.1);   // how far off the focus plane
  float fog = clamp((uFogB - w) / (uFogB - uFogA), 0.0, 1.0);
  float a = aInk * mix(0.16, 1.0, fog) / (1.0 + coc * 1.8);
  if (uGlobe.w > 0.0) {                                     // a point on a globe: where it faces
    vec3 n = normalize(pos - uGlobe.xyz); float facing = dot(n, normalize(uEye - pos)), lit = max(dot(n, uLight), 0.0);
    float front = smoothstep(-0.25, 0.3, facing);
    a *= mix(0.3, 1.0, front) * mix(1.0, 0.58, lit * front) * shown; d *= mix(0.8, 1.08, front) * mix(2.2, 1.0, shown);
  }
  d *= 1.0 + coc;
  if (d < uMinPx) { a *= d / uMinPx; d = uMinPx; }
  gl_PointSize = d + 2.0; vPx = d + 2.0; vA = a; vShape = aShape; vTone = aTone;
  if (aInk <= 0.0 || shown <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const FS_POINT = `#version 300 es
precision mediump float; in float vA; in float vShape; in float vTone; in float vPx;
uniform vec3 uInk, uSignal; uniform highp vec3 uLight; out vec4 o;
void main(){
  vec2 q = (gl_PointCoord - 0.5) * vPx; q.y = -q.y; float r = length(q);   // pixels from the centre, y up
  float R = (vPx - 2.0) * 0.5, a = clamp(R - r + 0.5, 0.0, 1.0);
  if (vShape > 0.5 && vShape < 1.5) a *= clamp(r - (R - max(1.2, R * 0.22)) + 0.5, 0.0, 1.0);   // a ring
  else if (vShape > 1.5 && vShape < 2.5) a *= 1.0 - smoothstep(0.0, R, r) * 0.85;               // a soft glow
  else if (vShape > 2.5) {                                                                       // a shaded ball
    vec2 u = q / max(R, 0.5); float z = sqrt(max(0.0, 1.0 - dot(u, u)));
    float lit = max(dot(vec3(u, z), normalize(vec3(uLight.x, uLight.y, 0.75))), 0.0);
    a *= mix(1.0, 0.42, lit * lit) * mix(1.0, 0.82, 1.0 - z);                                    // paler toward the light, a firm edge
  }
  a *= vA; if (a < 0.004) discard;
  o = vec4(mix(uInk, uSignal, vTone) * a, a);
}`;

const VS_LINE = `#version 300 es
layout(location=0) in vec2 aC; layout(location=1) in vec3 aA; layout(location=2) in vec3 aB; layout(location=3) in vec4 aStyle;   // alpha, width px, tone, dash
uniform mat4 uVP; uniform vec2 uView; uniform float uFogA, uFogB;
out float vA; out float vTone; out float vAcross; out float vAlong; out float vDash; out float vW;
void main(){
  vec4 a = uVP * vec4(aA, 1.0), b = uVP * vec4(aB, 1.0);
  if (a.w < 1.0 || b.w < 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 sa = a.xy / a.w * uView * 0.5, sb = b.xy / b.w * uView * 0.5, d = sb - sa; float len = length(d);
  vec2 n = len > 0.001 ? vec2(-d.y, d.x) / len : vec2(0.0, 1.0);
  float w = aStyle.y + 1.5; vec2 s = mix(sa, sb, aC.x) + n * aC.y * w * 0.5;
  float cw = mix(a.w, b.w, aC.x), fog = clamp((uFogB - cw) / (uFogB - uFogA), 0.0, 1.0);
  gl_Position = vec4(s / (uView * 0.5), 0.0, 1.0);
  vA = aStyle.x * mix(0.2, 1.0, fog); vTone = aStyle.z; vAcross = aC.y * w * 0.5; vAlong = aC.x * len; vDash = aStyle.w; vW = aStyle.y;
}`;
const FS_LINE = `#version 300 es
precision mediump float; in float vA; in float vTone; in float vAcross; in float vAlong; in float vDash; in float vW;
uniform vec3 uInk, uSignal; out vec4 o;
void main(){
  float a = vA * clamp(vW * 0.5 - abs(vAcross) + 0.5, 0.0, 1.0);
  if (vDash > 0.5) a *= step(fract(vAlong / 9.0), 0.5);
  if (a < 0.004) discard; o = vec4(mix(uInk, uSignal, vTone) * a, a);
}`;

// ---- views ----
const FS_VIEW = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uScene, uGlyphs; uniform vec2 uView; uniform vec3 uInk; uniform float uMode, uCell, uN; out vec4 o;
float cov(vec2 px, float lod){ return textureLod(uScene, px / uView, lod).a; }
float bayer(vec2 p){ int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0)); int i = x + y * 4;
  float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.); return (m[i] + 0.5) / 16.0; }
void main(){
  vec2 px = vUv * uView; float a = 0.0;
  if (uMode < 1.5) {                                            // text: each cell becomes the character with that much ink
    vec2 cell = vec2(uCell * 0.6, uCell), id = floor(px / cell), f = fract(px / cell);
    float c = pow(clamp(cov((id + 0.5) * cell, log2(uCell) - 0.4) * 1.9, 0.0, 1.0), 0.72);
    float g = min(floor(c * uN), uN - 1.0);
    a = g < 0.5 ? 0.0 : texture(uGlyphs, vec2((g + f.x) / uN, 1.0 - f.y)).a;
  } else if (uMode < 2.5) {                                     // braille: two dots across, four down
    vec2 cell = vec2(uCell * 0.62, uCell), id = floor(px / cell), dotc = vec2(cell.x / 2.0, cell.y / 4.0), dn = floor((px - id * cell) / dotc), c0 = id * cell + (dn + 0.5) * dotc;
    float c = cov(c0, log2(dotc.y) - 0.3) * 2.6, on = step(bayer(id * vec2(2.0, 4.0) + dn) * 0.55 + 0.06, c);
    a = on * clamp(dotc.y * 0.34 - length(px - c0) + 0.5, 0.0, 1.0);
  } else {                                                      // dither: square cells, an ordered threshold
    float s = max(2.0, floor(uCell * 0.3)); vec2 id = floor(px / s);
    a = step(bayer(id) * 0.8 + 0.04, cov((id + 0.5) * s, log2(s)) * 1.5);
  }
  o = vec4(uInk * a, a);
}`;
const FS_COPY = `#version 300 es
precision mediump float; in vec2 vUv; uniform sampler2D uScene; out vec4 o; void main(){ o = texture(uScene, vUv); }`;

export function createEngine(canvas) {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "high-performance", preserveDrawingBuffer: false });
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("shader: " + gl.getShaderInfoLog(s)); return s; };
  const prog = (vs, fs) => {
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("program: " + gl.getProgramInfoLog(p));
    const u = {}; for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) { const nm = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, ""); u[nm] = gl.getUniformLocation(p, nm); }
    return { p, u };
  };
  const P = { point: prog(VS_POINT, FS_POINT), line: prog(VS_LINE, FS_LINE), view: prog(VS_FULL, FS_VIEW), copy: prog(VS_FULL, FS_COPY) };

  const full = gl.createVertexArray(); gl.bindVertexArray(full);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const drawFull = () => { gl.bindVertexArray(full); gl.drawArrays(gl.TRIANGLES, 0, 3); };

  // ---- point sets: [x y z size ink shape tone] per point ----
  function pointSet(n, dynamic = false) {
    const data = new Float32Array(n * 7), vao = gl.createVertexArray(), buf = gl.createBuffer(); let dirty = true;
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    [[0, 3, 0], [1, 1, 12], [2, 1, 16], [3, 1, 20], [4, 1, 24]].forEach(([loc, size, off]) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 28, off); });
    return {
      data, n, count: n, globe: null, spin: 0, reveal: 2,                       // globe: [x, y, z, radius] when the points lie on a sphere
      set(i, x, y, z, size, ink, shape = 0, tone = 0) { const o = i * 7; data[o] = x; data[o + 1] = y; data[o + 2] = z; data[o + 3] = size; data[o + 4] = ink; data[o + 5] = shape; data[o + 6] = tone; dirty = true; },
      ink(i, v) { if (data[i * 7 + 4] !== v) { data[i * 7 + 4] = v; dirty = true; } },
      touch() { dirty = true; },
      draw() { if (!this.count) return; gl.bindVertexArray(vao); if (dirty) { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, data); dirty = false; } gl.drawArrays(gl.POINTS, 0, this.count); },
    };
  }
  // ---- line set: [ax ay az bx by bz alpha width tone dash] per segment ----
  function lineSet(n) {
    const data = new Float32Array(n * 10), vao = gl.createVertexArray(), quad = gl.createBuffer(), buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
    [[1, 3, 0], [2, 3, 12], [3, 4, 24]].forEach(([loc, size, off]) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 40, off); gl.vertexAttribDivisor(loc, 1); });
    return {
      data, n, count: 0,
      clear() { this.count = 0; },
      add(a, b, alpha, width = 1, tone = 0, dash = 0) { if (this.count >= n || alpha <= 0.003) return; const o = this.count++ * 10; data[o] = a[0]; data[o + 1] = a[1]; data[o + 2] = a[2]; data[o + 3] = b[0]; data[o + 4] = b[1]; data[o + 5] = b[2]; data[o + 6] = alpha; data[o + 7] = width; data[o + 8] = tone; data[o + 9] = dash; },
      draw() { if (!this.count) return; gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, this.count * 10)); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count); },
    };
  }

  // ---- targets ----
  const tex = (w, h, internal, format, type, filter) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.LINEAR_MIPMAP_LINEAR ? gl.LINEAR : filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
  const target = (w, h, internal, format, type, filter) => { const t = tex(w, h, internal, format, type, filter), f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE; gl.bindFramebuffer(gl.FRAMEBUFFER, null); return { t, f, w, h, ok }; };
  const bindTex = (unit, t, loc) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(loc, unit); };
  const into = (t) => { gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.f : null); gl.viewport(0, 0, t ? t.w : canvas.width, t ? t.h : canvas.height); };

  // ---- the character views ----
  let scene = null, glyphs = null, glyphN = 0;
  const RAMP = " .,:;-=+*oxO#%@";
  function makeGlyphs(cell, font) {
    const cw = Math.round(cell * 0.6), ch = Math.round(cell), c = document.createElement("canvas"); c.width = cw * RAMP.length; c.height = ch;
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.font = `${Math.round(cell * 0.86)}px ${font}`; x.textBaseline = "middle"; x.textAlign = "center";
    for (let i = 0; i < RAMP.length; i++) x.fillText(RAMP[i], cw * (i + 0.5), ch * 0.52);
    glyphs = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, glyphs); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    glyphN = RAMP.length;
  }

  const E = {
    gl, pointSet, lineSet, view: 0, font: "monospace", cell: 14,
    resize(w, h) { if (canvas.width === w && canvas.height === h) return; canvas.width = w; canvas.height = h; scene = null; glyphs = null; },
    // One frame. `sets` are drawn in order; `u` carries the camera and the colours.
    frame(u, sets) {
      const W = canvas.width, H = canvas.height; if (!W || !H) return;
      const viewOn = E.view > 0;
      if (viewOn && !scene) scene = target(W, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR_MIPMAP_LINEAR);
      const cell = Math.round(E.cell * u.dpr);
      if (viewOn && !glyphs) makeGlyphs(cell, E.font);
      const out = viewOn ? scene : null;
      into(out); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(P.line.p); let U = P.line.u;
      gl.uniformMatrix4fv(U.uVP, false, u.vp); gl.uniform2f(U.uView, W, H); gl.uniform1f(U.uFogA, u.fogA); gl.uniform1f(U.uFogB, u.fogB); gl.uniform3f(U.uInk, ...u.ink); gl.uniform3f(U.uSignal, ...u.signal);
      for (const s of sets) if (s.add) s.draw();
      gl.useProgram(P.point.p); U = P.point.u;
      gl.uniformMatrix4fv(U.uVP, false, u.vp); gl.uniform1f(U.uScale, u.scale); gl.uniform1f(U.uFocus, u.focus); gl.uniform1f(U.uDof, u.dof); gl.uniform1f(U.uFogA, u.fogA); gl.uniform1f(U.uFogB, u.fogB); gl.uniform1f(U.uMinPx, 1.3 * u.dpr); gl.uniform3f(U.uInk, ...u.ink); gl.uniform3f(U.uSignal, ...u.signal); gl.uniform3f(U.uEye, ...u.eye); gl.uniform3f(U.uLight, ...u.light);
      for (const s of sets) if (!s.add) { gl.uniform4f(U.uGlobe, ...(s.globe || [0, 0, 0, 0])); gl.uniform1f(U.uSpin, s.spin); gl.uniform1f(U.uReveal, s.reveal); gl.uniform1f(U.uCount, s.n); s.draw(); }
      if (viewOn) {
        gl.bindTexture(gl.TEXTURE_2D, scene.t); gl.generateMipmap(gl.TEXTURE_2D);
        into(null); gl.clear(gl.COLOR_BUFFER_BIT); gl.disable(gl.BLEND); gl.useProgram(P.view.p); U = P.view.u;
        bindTex(0, scene.t, U.uScene); bindTex(1, glyphs, U.uGlyphs); gl.uniform2f(U.uView, W, H); gl.uniform3f(U.uInk, ...u.ink); gl.uniform1f(U.uMode, E.view); gl.uniform1f(U.uCell, cell); gl.uniform1f(U.uN, glyphN);
        drawFull(); gl.enable(gl.BLEND);
      }
    },
  };
  return E;
}

// ---- camera maths (column-major 4×4) ----
export function perspective(fovY, aspect, near, far) { const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far); return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]; }
export function lookAt(e, t) {
  let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2]; let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = zz, xy = 0, xz = -zx; l = Math.hypot(xx, xz) || 1; xx /= l; xz /= l;                    // x = up(0,1,0) × z
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1];
}
export function mul4(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; }
