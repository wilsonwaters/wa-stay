/**
 * True when the browser can draw WebGL, which Mapbox GL needs. Some machines (remote desktops,
 * old GPUs, GPU acceleration turned off) cannot; Explore is then list-only. The probe's context
 * is released at once, so it does not count against the browser's limit.
 */
export function supportsWebGL(doc: Document = document): boolean {
  try {
    const canvas = doc.createElement('canvas');
    const context = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as
      WebGLRenderingContext | WebGL2RenderingContext | null;
    if (!context) return false;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
