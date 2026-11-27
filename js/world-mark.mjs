// SPDX-License-Identifier: Apache-2.0 OR MIT
// The loading mark as liquid metal: the AINRA mark, drawn a little heavier, with bands of ink that flow along its
// own edges. Written here; nothing is uploaded and nothing is fetched. The mark is drawn to a small canvas (its shape,
// and a blurred copy that serves as a height), and one fragment shader bends the bands by that height's slope.
// It stays the plain mark when the browser cannot blur a canvas, has no WebGL2, or the reader asked for less motion.
const VS = `#version 300 es
layout(location=0) in vec2 aP; out vec2 vUv; void main(){ vUv = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uM; uniform float uT; uniform vec3 uInk; out vec4 o;
void main(){
  vec4 m = texture(uM, vUv); float a = m.r, h = m.g;
  vec2 g = vec2(dFdx(h), dFdy(h)) * 90.0;
  float flow = vUv.x * 2.2 - vUv.y * 3.4 + (g.x - g.y) * 1.1 + sin(vUv.y * 8.0 + uT * 0.6) * 0.18 + uT * 0.22;
  float band = smoothstep(0.2, 0.8, 0.5 + 0.5 * sin(flow * 6.2831853));
  float tone = mix(0.3, 1.0, band); tone = mix(tone, 1.0, clamp(length(g) * 0.5, 0.0, 1.0) * 0.5);
  o = vec4(uInk * a * tone, a * tone);
}`;
export function metalMark(canvas, plain, ink, RM) {
  if (RM.matches) return;
  const S = canvas.width, src = document.createElement("canvas"); src.width = src.height = S; const c = src.getContext("2d");
  if (!("filter" in c)) return;
  const k = S / 112, draw = (w) => {
    c.save(); c.scale(k, k); c.lineCap = "round"; c.strokeStyle = c.fillStyle = "#fff";
    c.lineWidth = 3 * w; c.stroke(new Path2D("M 98.4 33.5 A 48 48 0 1 1 78.5 13.6")); c.fill(new Path2D("M 80.6 11.5 L 83.4 18.5 L 76.4 15.7 Z"));
    for (const [r, lw] of [[36, 1.2], [26, 1.6]]) { c.lineWidth = lw * w; c.beginPath(); c.arc(56, 56, r, 0, 7); c.stroke(); }
    c.lineWidth = 1 * w; c.beginPath(); c.ellipse(56, 56, 11, 26, 0, 0, 7); c.stroke(); c.lineWidth = 1.1 * w; c.beginPath(); c.moveTo(30, 56); c.lineTo(82, 56); c.stroke();
    c.beginPath(); c.arc(56, 56, 2.4 * Math.sqrt(w), 0, 7); c.fill(); c.restore();
  };
  draw(2.1); const sharp = c.getImageData(0, 0, S, S);
  c.clearRect(0, 0, S, S); c.filter = `blur(${Math.round(S / 34)}px)`; draw(2.6); c.filter = "none"; const soft = c.getImageData(0, 0, S, S);
  const px = new Uint8Array(S * S * 4); for (let i = 0; i < S * S; i++) { px[i * 4] = sharp.data[i * 4 + 3]; px[i * 4 + 1] = soft.data[i * 4 + 3]; px[i * 4 + 3] = 255; }
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false }); if (!gl) return;
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x; };
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return;
  gl.useProgram(p); gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture()); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const uT = gl.getUniformLocation(p, "uT"), uInk = gl.getUniformLocation(p, "uInk"), boot = canvas.closest(".boot");
  canvas.hidden = false; canvas.parentElement.classList.add("metal"); void plain;
  const t0 = performance.now(); const frame = (now) => {
    if (boot && boot.classList.contains("done") && now - t0 > 800 && getComputedStyle(boot).visibility === "hidden") return;      // stop once the loading screen has gone
    gl.viewport(0, 0, S, S); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.uniform1f(uT, (now - t0) / 1000); gl.uniform3f(uInk, ...ink()); gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
