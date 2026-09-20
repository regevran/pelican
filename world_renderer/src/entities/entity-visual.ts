/**
 * What every kind of tracked entity gets: a label it carries, a dashed line
 * dropping to the water surface so its altitude is readable against the plane
 * rather than guessed, and a fading trail of where it has been.
 *
 * An entity is drawn twice over, because the two halves answer different
 * questions. The mark itself — the cone, and later a drone — is anchored to the
 * entity, so it is parented to a group sitting at the entity's position and
 * authored in local coordinates. The trail is a path through the *scene*, not
 * an attachment to the entity, so it lives in its own absolute overlay. That is
 * why a visual hands back two objects.
 */

import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

import type { SampledFlock } from "../sampler";
import type { Position } from "../world-state";
import {
  DROP_LINE_COLOR,
  DROP_LINE_DASH_METERS,
  DROP_LINE_GAP_METERS,
  DROP_LINE_OPACITY,
  TRAIL_BREAK_METERS,
  TRAIL_COLOR,
  TRAIL_HEAD_OPACITY,
  TRAIL_MAX_POINTS,
  TRAIL_MIN_STEP_METERS,
  TRAIL_SECONDS,
} from "../palette";

/** The pose a visual is asked to draw. Same shape the sampler emits. */
export type EntityPose = SampledFlock;

export interface EntityVisual {
  /** Parented to the layer's group; sits at the entity's position. */
  readonly object: THREE.Object3D;
  /** Parented to the layer's overlay; anchored in scene coordinates. */
  readonly overlay: THREE.Object3D;
  update(pose: EntityPose, now: number): void;
  dispose(): void;
}

const distanceBetween = (from: Position, to: Position): number =>
  Math.hypot(
    to.x_meters - from.x_meters,
    to.y_meters - from.y_meters,
    to.z_meters - from.z_meters,
  );

/**
 * The label an entity carries: its name, and its altitude above the water
 * surface.
 *
 * The altitude is repeated here rather than left to the axis alone because the
 * axis can only be read against a mark that is beside it; a flock across the
 * volume is nowhere near it. Printing the number is what lets a reader check
 * the axis is right without measuring anything.
 */
export class EntityLabel {
  readonly object: CSS2DObject;

  private readonly altitude: HTMLElement;
  private shown: number | undefined;

  constructor(text: string, offsetMeters: number) {
    const element = document.createElement("div");
    element.className = "entity-label";

    const name = document.createElement("span");
    name.className = "entity-label-name";
    name.textContent = text;

    this.altitude = document.createElement("span");
    this.altitude.className = "entity-label-altitude";

    element.append(name, this.altitude);

    this.object = new CSS2DObject(element);
    this.object.position.set(0, 0, offsetMeters);
  }

  setAltitude(meters: number): void {
    const rounded = Math.round(meters);
    // Rewriting identical text every frame makes the browser re-lay-out the
    // label sixty times a second for no change.
    if (rounded === this.shown) return;
    this.shown = rounded;
    this.altitude.textContent = `${rounded} m`;
  }
}

/**
 * A dashed line straight down to the water surface.
 *
 * Parented to the entity's group, so the only thing that ever changes is its
 * length; the ground end is the geometry's *first* vertex, which is what
 * anchors the dash pattern at the water plane. Anchor it at the entity's end
 * instead and the dashes slide as the entity climbs, which reads as movement
 * in a line that is supposed to be standing still.
 */
export class DropLine {
  readonly object: THREE.Line;

  private readonly geometry: THREE.BufferGeometry;
  private readonly positions: Float32Array;
  private readonly distances: Float32Array;

  constructor() {
    this.positions = new Float32Array(2 * 3);
    this.distances = new Float32Array(2);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.positions, 3),
    );
    this.geometry.setAttribute(
      "lineDistance",
      new THREE.BufferAttribute(this.distances, 1),
    );

    this.object = new THREE.Line(
      this.geometry,
      new THREE.LineDashedMaterial({
        color: DROP_LINE_COLOR,
        dashSize: DROP_LINE_DASH_METERS,
        gapSize: DROP_LINE_GAP_METERS,
        transparent: true,
        opacity: DROP_LINE_OPACITY,
      }),
    );
    // The geometry is rewritten in place, so the bounds three.js would cache
    // from the first write are wrong from the second one on.
    this.object.frustumCulled = false;
  }

  update(altitudeMeters: number): void {
    this.positions[0] = 0;
    this.positions[1] = 0;
    this.positions[2] = -altitudeMeters;
    this.positions[3] = 0;
    this.positions[4] = 0;
    this.positions[5] = 0;

    // LineDashedMaterial reads these rather than calling computeLineDistances,
    // which would allocate a fresh attribute every frame.
    this.distances[0] = 0;
    this.distances[1] = altitudeMeters;

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.lineDistance.needsUpdate = true;
  }

  get material(): THREE.LineDashedMaterial {
    return this.object.material as THREE.LineDashedMaterial;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

interface TrailPoint {
  /** Held by reference: the sampler hands out a fresh pose every frame. */
  position: Position;
  at: number;
}

/**
 * The recent path, faded from solid at the entity to nothing at its oldest end.
 *
 * The colour attribute carries four components, not three: alpha per vertex is
 * the only way to fade a line out. A three-component colour can only fade
 * toward whichever colour happens to be behind it, which stops working the
 * moment anything moves behind the trail.
 */
export class Trail {
  readonly object: THREE.Line;

  private readonly geometry: THREE.BufferGeometry;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  /** Committed vertices, oldest first. The entity's own position is not one. */
  private readonly points: TrailPoint[] = [];
  private readonly head = new THREE.Color(TRAIL_COLOR);

  constructor() {
    // One more vertex than the cap, because the entity's current position is
    // drawn in addition to the committed ones.
    this.positions = new Float32Array((TRAIL_MAX_POINTS + 1) * 3);
    this.colors = new Float32Array((TRAIL_MAX_POINTS + 1) * 4);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.positions, 3),
    );
    this.geometry.setAttribute(
      "color",
      new THREE.BufferAttribute(this.colors, 4),
    );
    this.geometry.setDrawRange(0, 0);

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      // Otherwise the trail's own faces sort against each other and against
      // the pool surface it may pass over.
      depthWrite: false,
    });

    this.object = new THREE.Line(this.geometry, material);
    this.object.frustumCulled = false;
  }

  update(pose: EntityPose, now: number): void {
    const { position } = pose;
    const last = this.points[this.points.length - 1];

    // A jump means the entity did not travel here — a restart, or a reconnect
    // after a gap — and joining the two ends would draw a streak across the
    // scene that never happened.
    const broken =
      pose.jumped ||
      (last !== undefined &&
        distanceBetween(last.position, position) > TRAIL_BREAK_METERS);
    if (broken) this.points.length = 0;

    // A vertex is committed only once the entity has travelled far enough from
    // the previous one. Committing on distance rather than on time is what
    // keeps the trail's resolution tied to the path: a vertex per frame would
    // spend the whole buffer on two centimetres of travel each and fill it long
    // before the age the trail is meant to span.
    const tail = broken ? undefined : last;
    if (
      tail === undefined ||
      distanceBetween(tail.position, position) >= TRAIL_MIN_STEP_METERS
    ) {
      this.points.push({ position, at: now });
    }

    const oldest = now - TRAIL_SECONDS * 1000;
    while (this.points.length > 0 && this.points[0].at < oldest) {
      this.points.shift();
    }
    while (this.points.length > TRAIL_MAX_POINTS) this.points.shift();

    this.write(position, now);
  }

  /**
   * Write the committed vertices, then the entity's current position as the
   * last one. Committing on distance means the newest vertex can be a metre and
   * a half behind the entity; drawing the entity's own position on top of the
   * history keeps the trail attached to the mark it belongs to.
   */
  private write(position: Position, now: number): void {
    const count = this.points.length;
    const start = count > 0 ? this.points[0].at : now;
    // Fade with age rather than with index, so a trail that has stopped growing
    // keeps fading instead of freezing at full strength.
    const span = Math.max(now - start, 1);

    for (let index = 0; index <= count; index += 1) {
      const point = index < count ? this.points[index] : { position, at: now };
      const age = (point.at - start) / span;

      this.positions[index * 3] = point.position.x_meters;
      this.positions[index * 3 + 1] = point.position.y_meters;
      this.positions[index * 3 + 2] = point.position.z_meters;

      this.colors[index * 4] = this.head.r;
      this.colors[index * 4 + 1] = this.head.g;
      this.colors[index * 4 + 2] = this.head.b;
      this.colors[index * 4 + 3] = TRAIL_HEAD_OPACITY * age;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.setDrawRange(0, count + 1);
  }

  dispose(): void {
    this.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
  }
}

/**
 * Remove an entity's objects and hand back the GPU memory they held.
 *
 * Shared because the disposal order is easy to get wrong and the failure is
 * silent: a `CSS2DObject` left behind keeps its DOM node, and the leak is one
 * node per entity per reconnect.
 */
export function disposeVisual(objects: THREE.Object3D[]): void {
  for (const object of objects) {
    object.traverse((child) => {
      if (child instanceof CSS2DObject) child.element.remove();
      const mesh = child as Partial<THREE.Mesh>;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material?.dispose();
    });
    object.removeFromParent();
  }
}
