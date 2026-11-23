import type { World } from './sim/params';

/** zoom is device pixels per world unit; (x, y) is the world point at screen centre. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** Fill the viewport with the world, cropping the shorter axis ("cover"). */
export function fitCamera(world: World, width: number, height: number): Camera {
  return { x: world.size / 2, y: world.size / 2, zoom: coverZoom(world, width, height) };
}

export function coverZoom(world: World, width: number, height: number): number {
  return Math.max(width, height) / world.size;
}

/** Closest you can get: the interaction radius spans ~1/3 of the short edge. */
export function maxZoom(width: number, height: number): number {
  return Math.min(width, height) / 3;
}

export function screenToWorld(cam: Camera, sx: number, sy: number, width: number, height: number): [number, number] {
  return [cam.x + (sx - width / 2) / cam.zoom, cam.y + (sy - height / 2) / cam.zoom];
}

/** Zoom by `factor`, keeping the world point under (sx, sy) where it is. */
export function zoomAt(
  cam: Camera,
  factor: number,
  sx: number,
  sy: number,
  width: number,
  height: number,
  minZoom: number,
  maxZoomValue: number,
): Camera {
  const zoom = Math.min(Math.max(cam.zoom * factor, minZoom), maxZoomValue);
  const [wx, wy] = screenToWorld(cam, sx, sy, width, height);
  return { x: wx - (sx - width / 2) / zoom, y: wy - (sy - height / 2) / zoom, zoom };
}

/** Keep the camera centre inside [0, size) so it never drifts off to huge coordinates. */
export function wrapCamera(cam: Camera, size: number): Camera {
  const w = (v: number) => v - size * Math.floor(v / size);
  return { x: w(cam.x), y: w(cam.y), zoom: cam.zoom };
}
