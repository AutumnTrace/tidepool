import type { World } from './sim/params';

/** zoom is device pixels per world unit; (x, y) is the world point at screen centre. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** Fill the viewport with the world, cropping the shorter axis ("cover"). */
export function fitCamera(world: World, width: number, height: number): Camera {
  return { x: world.size / 2, y: world.size / 2, zoom: Math.max(width, height) / world.size };
}

export function screenToWorld(cam: Camera, sx: number, sy: number, width: number, height: number): [number, number] {
  return [cam.x + (sx - width / 2) / cam.zoom, cam.y + (sy - height / 2) / cam.zoom];
}
