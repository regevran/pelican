/**
 * The seam that keeps "tracked entity" from meaning "flock".
 *
 * A layer holds one kind of entity, keys them by name, and creates and disposes
 * visuals as names appear and disappear in the data. Adding a second kind —
 * drones — is a new file beside flock.ts, a second entry in `AERIAL_KINDS`, and
 * one more layer here; the drop line, the trail, the label and the diffing all
 * come along.
 */

import * as THREE from "three";

import { FLOCK_COLOR } from "../palette";
import type { EntityPose, EntityVisual } from "./entity-visual";
import { createFlockVisual } from "./flock";

/** One kind of tracked entity, as the legend and the layers both see it. */
export interface EntityKind {
  /** What the legend calls it. */
  readonly label: string;
  /** Silhouette for the legend, as SVG path data in a 24×24 box. */
  readonly legendShape: string;
  readonly color: number;
  create(name: string): EntityVisual;
}

export const FLOCK_KIND: EntityKind = {
  label: "flock",
  legendShape: "M12 3 L21 20 L3 20 Z",
  color: FLOCK_COLOR,
  create: createFlockVisual,
};

/** Every kind the scene knows, in the order the legend lists them. */
export const AERIAL_KINDS: readonly EntityKind[] = [FLOCK_KIND];

export class AerialLayer {
  private readonly group = new THREE.Group();
  private readonly overlay = new THREE.Group();
  private readonly visuals = new Map<string, EntityVisual>();

  constructor(
    private readonly kind: EntityKind,
    parent: THREE.Group,
  ) {
    parent.add(this.group);
    parent.add(this.overlay);
  }

  update(poses: EntityPose[], now: number): void {
    const present = new Set<string>();

    for (const pose of poses) {
      present.add(pose.name);

      let visual = this.visuals.get(pose.name);
      if (visual === undefined) {
        visual = this.kind.create(pose.name);
        this.group.add(visual.object);
        this.overlay.add(visual.overlay);
        this.visuals.set(pose.name, visual);
      }

      visual.update(pose, now);
    }

    // An entity the producer has stopped reporting is gone, not merely still.
    for (const [name, visual] of this.visuals) {
      if (present.has(name)) continue;
      visual.dispose();
      this.visuals.delete(name);
    }
  }

  dispose(): void {
    for (const visual of this.visuals.values()) visual.dispose();
    this.visuals.clear();
    this.group.removeFromParent();
    this.overlay.removeFromParent();
  }
}
