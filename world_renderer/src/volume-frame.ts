/**
 * The reference volume: the ground grid, the box that bounds the scene, and
 * the labelled altitude axis.
 *
 * This exists because the frame the contract fixes — meters east, north and
 * up, z = 0 on the water surface — is invisible in the data. Without it a flock
 * at 120 m reads as a flock somewhere above some water, and the only way to
 * know the scale is to guess. The axis and the grid are what turn the picture
 * into measurements.
 */

import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

import type { WorldState } from "./world-state";
import {
  ALTITUDE_AXIS_COLOR,
  ALTITUDE_CEILING_METERS,
  ALTITUDE_LABEL_OFFSET_METERS,
  ALTITUDE_TICK_INTERVAL_METERS,
  ALTITUDE_TICK_LENGTH_METERS,
  BOX_EDGE_COLOR,
  GRID_CELL_METERS,
  GRID_CENTER_COLOR,
  GRID_COLOR,
  GRID_MARGIN_METERS,
} from "./palette";

/** The drawn volume's footprint, in contract coordinates. */
export interface VolumeBounds {
  centreX: number;
  centreY: number;
  /** Half the side of the square footprint, in meters. */
  halfSize: number;
}

/** A floor for the bounds when a state carries no positions at all. */
const EMPTY_FOOTPRINT_HALF_SIZE = GRID_CELL_METERS * 5;

/**
 * The footprint the data needs: its bounding box, squared off, with a margin,
 * rounded up to whole grid cells so the grid always lands on the boundary
 * rather than a fraction of a cell past it.
 */
export function requiredBounds(state: WorldState): VolumeBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const note = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };

  for (const pool of state.pools) {
    for (const point of pool.boundary) note(point.x_meters, point.y_meters);
  }
  for (const flock of state.flocks) {
    note(flock.position.x_meters, flock.position.y_meters);
  }

  if (!Number.isFinite(minX)) {
    return { centreX: 0, centreY: 0, halfSize: EMPTY_FOOTPRINT_HALF_SIZE };
  }

  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;
  const halfExtent = Math.max(maxX - centreX, maxY - centreY);
  const halfSize =
    Math.ceil((halfExtent + GRID_MARGIN_METERS) / GRID_CELL_METERS) *
    GRID_CELL_METERS;

  return { centreX, centreY, halfSize };
}

/**
 * The frame to draw, given the one already drawn.
 *
 * The box grows to fit the data and then holds still: it never shrinks, and its
 * centre is fixed once it exists. A box that slid and rescaled as a flock
 * wandered would make the camera feel like it were drifting, and since the pool
 * is static there is little to gain from following the flock. The margin in
 * `requiredBounds` is what keeps growth from being needed very often.
 */
export function grownBounds(
  current: VolumeBounds | undefined,
  required: VolumeBounds,
): VolumeBounds {
  if (current === undefined) return required;
  if (required.halfSize <= current.halfSize) return current;
  return {
    centreX: current.centreX,
    centreY: current.centreY,
    halfSize: required.halfSize,
  };
}

function lineSegments(
  points: THREE.Vector3[],
  material: THREE.LineBasicMaterial,
): THREE.LineSegments {
  return new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    material,
  );
}

export class VolumeFrame {
  private readonly group = new THREE.Group();
  private grid: THREE.GridHelper | undefined;
  private built: THREE.Object3D[] = [];
  private labels: HTMLElement[] = [];
  private bounds: VolumeBounds | undefined;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly worldGroup: THREE.Group,
  ) {
    this.worldGroup.add(this.group);
  }

  setBounds(bounds: VolumeBounds): void {
    this.clear();
    this.bounds = bounds;

    this.buildGrid(bounds);
    this.buildBox(bounds);
    this.buildAltitudeAxis(bounds);
  }

  /**
   * The grid is a world-space plane, so it hangs off the scene rather than off
   * the rotated group — inside the group it would stand on edge.
   */
  private buildGrid(bounds: VolumeBounds): void {
    const size = bounds.halfSize * 2;
    const grid = new THREE.GridHelper(
      size,
      size / GRID_CELL_METERS,
      GRID_CENTER_COLOR,
      GRID_COLOR,
    );
    grid.position.set(bounds.centreX, 0, -bounds.centreY);
    this.grid = grid;
    this.scene.add(grid);
  }

  private buildBox(bounds: VolumeBounds): void {
    const material = new THREE.LineBasicMaterial({ color: BOX_EDGE_COLOR });
    const { centreX, centreY, halfSize } = bounds;
    const west = centreX - halfSize;
    const east = centreX + halfSize;
    const south = centreY - halfSize;
    const north = centreY + halfSize;

    // The four vertical edges, so the volume has height from any azimuth.
    const corners = [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
    ];
    const posts: THREE.Vector3[] = [];
    for (const [x, y] of corners) {
      posts.push(
        new THREE.Vector3(x, y, 0),
        new THREE.Vector3(x, y, ALTITUDE_CEILING_METERS),
      );
    }
    this.add(lineSegments(posts, material));

    // The ceiling, which is what makes the top of the band a plane rather than
    // an absence.
    const ceiling = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        corners.map(
          ([x, y]) => new THREE.Vector3(x, y, ALTITUDE_CEILING_METERS),
        ),
      ),
      material,
    );
    this.add(ceiling);
  }

  /**
   * A labelled altitude axis, standing clear of the box's near corner so it is
   * not lost among the edges.
   */
  private buildAltitudeAxis(bounds: VolumeBounds): void {
    const material = new THREE.LineBasicMaterial({
      color: ALTITUDE_AXIS_COLOR,
    });
    const x = bounds.centreX + bounds.halfSize + ALTITUDE_LABEL_OFFSET_METERS;
    const y = bounds.centreY - bounds.halfSize - ALTITUDE_LABEL_OFFSET_METERS;

    this.add(
      lineSegments(
        [
          new THREE.Vector3(x, y, 0),
          new THREE.Vector3(x, y, ALTITUDE_CEILING_METERS),
        ],
        material,
      ),
    );

    const ticks: THREE.Vector3[] = [];
    for (
      let altitude = 0;
      altitude <= ALTITUDE_CEILING_METERS;
      altitude += ALTITUDE_TICK_INTERVAL_METERS
    ) {
      ticks.push(
        new THREE.Vector3(x, y, altitude),
        new THREE.Vector3(x + ALTITUDE_TICK_LENGTH_METERS, y, altitude),
      );
      this.addLabel(
        `${altitude} m`,
        "axis-label",
        x + ALTITUDE_LABEL_OFFSET_METERS,
        y,
        altitude,
      );
    }
    this.add(lineSegments(ticks, material));

    this.addLabel(
      "altitude (m)",
      "axis-label axis-label-title",
      x + ALTITUDE_LABEL_OFFSET_METERS,
      y,
      ALTITUDE_CEILING_METERS + ALTITUDE_TICK_INTERVAL_METERS / 2,
    );
  }

  private add(object: THREE.Object3D): void {
    this.group.add(object);
    this.built.push(object);
  }

  private addLabel(
    text: string,
    className: string,
    x: number,
    y: number,
    z: number,
  ): void {
    const element = document.createElement("div");
    element.className = className;
    element.textContent = text;

    const label = new CSS2DObject(element);
    label.position.set(x, y, z);

    this.group.add(label);
    this.labels.push(element);
  }

  private clear(): void {
    for (const object of this.built) {
      this.group.remove(object);
      const geometry = (object as Partial<THREE.Mesh>).geometry;
      const material = (object as Partial<THREE.Mesh>).material;
      geometry?.dispose();
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material?.dispose();
    }
    this.built = [];
    this.group.clear();

    for (const element of this.labels) element.remove();
    this.labels = [];

    if (this.grid !== undefined) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      const material = this.grid.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material.dispose();
      this.grid = undefined;
    }
  }

  get currentBounds(): VolumeBounds | undefined {
    return this.bounds;
  }

  dispose(): void {
    this.clear();
    this.worldGroup.remove(this.group);
  }
}
