#version 300 es
// ^ MUST be the first line. GLSL allows only comments and whitespace before
//   #version, and some drivers are stricter than the spec.
//
// The uniform contract ghostty exposes to a custom shader.
//
// Prepended to every shader before compiling, by BOTH the preview harness
// (preview/index.html) and the compile checker (tools/check_compile.py). It
// lives in its own file so that adding a uniform cannot update one harness and
// quietly leave the other compiling against the old contract.
//
// Keep in step with ghostty's own list. Current as of 1.3.0-dev.
precision highp float;
precision highp int;
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform int iFrame;
uniform vec4 iDate;
uniform sampler2D iChannel0;
uniform vec4 iCurrentCursor;
uniform vec4 iPreviousCursor;
uniform vec4 iCurrentCursorColor;
uniform float iTimeCursorChange;
out vec4 _out;
#define texture2D texture
