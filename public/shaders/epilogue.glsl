// Appended to every shader after compiling. Shared by preview/index.html and
// tools/check_compile.py — see prologue.glsl for why it is a file.
void main() { mainImage(_out, gl_FragCoord.xy); }
