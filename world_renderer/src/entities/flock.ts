/**
 * A flock: a cone that points where it is going.
 *
 * The silhouette carries the identity and the colour only reinforces it, which
 * is why the shape is a marked-up solid rather than a dot: a cone reads as
 * "something with a heading" from any angle, at any zoom, and in greyscale.
 */

import * as THREE from "three";

import {
  FLOCK_COLOR,
  FLOCK_EDGE_COLOR,
  FLOCK_HEIGHT_METERS,
  FLOCK_LABEL_OFFSET_METERS,
  FLOCK_RADIAL_SEGMENTS,
  FLOCK_RADIUS_METERS,
} from "../palette";
import {
  DropLine,
  EntityLabel,
  Trail,
  disposeVisual,
  type EntityPose,
  type EntityVisual,
} from "./entity-visual";

/** The contract's up axis, which is where the cone's apex has to point. */
const UP = new THREE.Vector3(0, 0, 1);

export function createFlockVisual(name: string): EntityVisual {
  const root = new THREE.Group();

  // The cone is turned to face the velocity, but the drop line and the label
  // must not turn with it — so only the cone lives under the rotating group.
  const marker = new THREE.Group();
  root.add(marker);

  // ConeGeometry points its apex along +Y. One rotation at construction puts
  // it on +Z, the contract's up, and nothing has to remember that again.
  const geometry = new THREE.ConeGeometry(
    FLOCK_RADIUS_METERS,
    FLOCK_HEIGHT_METERS,
    FLOCK_RADIAL_SEGMENTS,
  );
  geometry.rotateX(Math.PI / 2);

  marker.add(
    new THREE.Mesh(
      geometry,
      // Flat shading so the facets stay visible: the point is a readable
      // marker, not an animal.
      new THREE.MeshLambertMaterial({
        color: FLOCK_COLOR,
        flatShading: true,
      }),
    ),
  );

  marker.add(
    new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: FLOCK_EDGE_COLOR }),
    ),
  );

  const label = new EntityLabel(name, FLOCK_LABEL_OFFSET_METERS);
  root.add(label.object);

  const dropLine = new DropLine();
  root.add(dropLine.object);

  const trail = new Trail();

  const direction = new THREE.Vector3();

  return {
    object: root,
    overlay: trail.object,

    update(pose: EntityPose, now: number): void {
      const { position, velocity } = pose;
      root.position.set(
        position.x_meters,
        position.y_meters,
        position.z_meters,
      );
      label.setAltitude(position.z_meters);

      direction.set(
        velocity.x_meters_per_second,
        velocity.y_meters_per_second,
        velocity.z_meters_per_second,
      );
      if (direction.lengthSq() > 0) {
        // A velocity that is very nearly straight up leaves the roll about the
        // axis arbitrary — any rotation about the cone's own axis is a valid
        // answer, and the one returned is decided by floating point. Harmless
        // here, because a cone looks the same at every roll. It will not be
        // harmless for a shape that does not: a drone needs a deliberately
        // chosen reference direction as the second argument, not this one.
        marker.quaternion.setFromUnitVectors(UP, direction.normalize());
      }

      dropLine.update(position.z_meters);
      trail.update(pose, now);
    },

    dispose(): void {
      dropLine.dispose();
      trail.dispose();
      disposeVisual([root, trail.object]);
    },
  };
}
