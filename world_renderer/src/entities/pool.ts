/**
 * Pools: the reference surface the rest of the scene is measured against.
 *
 * A pool is drawn as a basin rather than a patch — a translucent surface on the
 * water plane, the boundary drawn along it, and a slab of rim below. The slab
 * is the part that matters: seen from near the horizon, a flat polygon has no
 * thickness at all and vanishes, which is exactly the failure the old renderer
 * had. Give it an edge and the pool stays a pool from every angle.
 */

import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

import {
  POOL_RIM_COLOR,
  POOL_RIM_DEPTH_METERS,
  POOL_SURFACE_COLOR,
  POOL_SURFACE_OFFSET_METERS,
  POOL_SURFACE_OPACITY,
  POOL_WATERLINE_COLOR,
} from "../palette";
import type { PlanarPoint, Pool } from "../world-state";
import { disposeVisual } from "./entity-visual";

/**
 * The boundary as a shape, with its winding normalized.
 *
 * The contract says counter-clockwise, and the producing simulator honours
 * that, but a shape built the other way round has inverted faces and reads as a
 * hole rather than a surface — a failure that looks like a lighting bug and is
 * not worth inheriting from a producer that got it wrong.
 */
function shapeFromRing(boundary: PlanarPoint[]): THREE.Shape | undefined {
  const points = boundary
    .filter(
      (point) =>
        Number.isFinite(point.x_meters) && Number.isFinite(point.y_meters),
    )
    .map((point) => new THREE.Vector2(point.x_meters, point.y_meters));

  if (points.length < 3) return undefined;
  if (THREE.ShapeUtils.isClockWise(points)) points.reverse();
  return new THREE.Shape(points);
}

function buildPool(pool: Pool): THREE.Object3D | undefined {
  const shape = shapeFromRing(pool.boundary);
  if (shape === undefined) {
    console.warn(
      `Pool "${pool.name}" has no usable boundary; skipping it rather than drawing a partial shape.`,
    );
    return undefined;
  }

  const group = new THREE.Group();

  // Unlit, so the fill is exactly the colour the legend shows; a lit surface
  // would be a different blue depending on where the camera happens to be.
  const surface = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({
      color: POOL_SURFACE_COLOR,
      transparent: true,
      opacity: POOL_SURFACE_OPACITY,
      side: THREE.DoubleSide,
    }),
  );
  // The grid lies on the water plane too. Lifting the surface clear of it means
  // neither needs polygonOffset, and the grid shows faintly through the fill —
  // which reads as the bottom of a shallow pool, so it earns its keep.
  surface.position.z = POOL_SURFACE_OFFSET_METERS;
  group.add(surface);

  const rim = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, {
      depth: POOL_RIM_DEPTH_METERS,
      bevelEnabled: false,
    }),
    new THREE.MeshLambertMaterial({
      color: POOL_RIM_COLOR,
      flatShading: true,
      side: THREE.DoubleSide,
    }),
  );
  // Extrusion runs upward from the plane, so the slab is shifted down to hang
  // below it. It stops just short of the plane rather than touching it: a face
  // coplanar with the grid would z-fight along every grid line it crosses.
  rim.position.z = -(POOL_RIM_DEPTH_METERS + POOL_SURFACE_OFFSET_METERS);
  group.add(rim);

  const ring = pool.boundary
    .filter(
      (point) =>
        Number.isFinite(point.x_meters) && Number.isFinite(point.y_meters),
    )
    .map((point) => new THREE.Vector3(point.x_meters, point.y_meters, 0));
  group.add(
    new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(ring),
      new THREE.LineBasicMaterial({ color: POOL_WATERLINE_COLOR }),
    ),
  );

  const box = new THREE.Box3().setFromPoints(ring);
  const centre = box.getCenter(new THREE.Vector3());

  const element = document.createElement("div");
  element.className = "pool-label";
  element.textContent = pool.name;
  const label = new CSS2DObject(element);
  label.position.set(centre.x, centre.y, POOL_SURFACE_OFFSET_METERS);
  group.add(label);

  return group;
}

export class PoolLayer {
  private readonly built: THREE.Object3D[] = [];
  /** Names and vertex counts, to notice a changed pool set without diffing it. */
  private signature = "";

  constructor(private readonly group: THREE.Group) {}

  update(pools: Pool[]): void {
    const signature = pools
      .map((pool) => `${pool.name}:${pool.boundary.length}`)
      .join("|");
    if (signature === this.signature) return;
    this.signature = signature;

    disposeVisual(this.built);
    this.built.length = 0;

    for (const pool of pools) {
      const object = buildPool(pool);
      if (object === undefined) continue;
      this.group.add(object);
      this.built.push(object);
    }
  }

  dispose(): void {
    disposeVisual(this.built);
    this.built.length = 0;
  }
}
