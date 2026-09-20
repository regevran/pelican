/**
 * The renderer, the camera and the two coordinate frames they bridge.
 *
 * three.js is Y-up and the contract is Z-up. Rather than fight that, every
 * contract-space object is parented to one group rotated a quarter turn about
 * X, so a child authored at (x, y, z) lands with data-z on world +Y. Authors
 * never convert anything; `toWorld` exists only for the handful of helpers that
 * have to be placed in world space — see the warning on `worldGroup`.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";

import {
  AMBIENT_INTENSITY,
  BACKGROUND_COLOR,
  CAMERA_DAMPING,
  CAMERA_FAR_METERS,
  CAMERA_FOV_DEGREES,
  CAMERA_MAX_DISTANCE_METERS,
  CAMERA_MIN_DISTANCE_METERS,
  CAMERA_NEAR_METERS,
  CAMERA_OFFSET_EAST_HALVES,
  CAMERA_OFFSET_NORTH_HALVES,
  CAMERA_OFFSET_UP_HALVES,
  CAMERA_TARGET_ALTITUDE_FRACTION,
  ALTITUDE_CEILING_METERS,
  SUN_DIRECTION,
  SUN_INTENSITY,
} from "./palette";
import type { VolumeBounds } from "./volume-frame";

/**
 * Contract coordinates to three.js world coordinates.
 *
 * `worldGroup` is rotated -90 degrees about X, which maps a child's local
 * (a, b, c) to world (a, c, -b). This is that same map written out, for the
 * places that cannot go in the group.
 */
export function toWorld(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y);
}

export class SceneView {
  readonly scene = new THREE.Scene();

  /**
   * Everything expressed in contract coordinates hangs off this.
   *
   * Note the trap: a helper authored horizontally in *world* space — the
   * ground grid, a light — must be added to `scene`, not here, or the extra
   * quarter turn stands it on its edge. Only contract-space content belongs in
   * the group.
   */
  readonly worldGroup = new THREE.Group();

  readonly camera: THREE.PerspectiveCamera;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly labelRenderer: CSS2DRenderer;
  private readonly controls: OrbitControls;
  private readonly onResize = () => this.resize();

  constructor(
    private readonly container: HTMLElement,
    private readonly labelLayer: HTMLElement,
  ) {
    this.scene.background = new THREE.Color(BACKGROUND_COLOR);

    this.worldGroup.rotation.x = -Math.PI / 2;
    this.scene.add(this.worldGroup);

    this.camera = new THREE.PerspectiveCamera(
      CAMERA_FOV_DEGREES,
      1,
      CAMERA_NEAR_METERS,
      CAMERA_FAR_METERS,
    );

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(1, 1);
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer({ element: labelLayer });

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = CAMERA_DAMPING;
    this.controls.minDistance = CAMERA_MIN_DISTANCE_METERS;
    this.controls.maxDistance = CAMERA_MAX_DISTANCE_METERS;

    // Lighting is world-space: it goes on the scene, not in the group.
    // No shadows — the drop-line already carries altitude downward, and the
    // grid is drawn with lines, which cannot receive them anyway.
    const sun = new THREE.DirectionalLight(
      new THREE.Color(0xffffff),
      SUN_INTENSITY,
    );
    sun.position.copy(
      toWorld(SUN_DIRECTION.east, SUN_DIRECTION.north, SUN_DIRECTION.up),
    );
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY));

    window.addEventListener("resize", this.onResize);
    this.resize();
  }

  /**
   * Point the camera at the volume. Called once, after the first state has
   * fixed the frame — the data decides the framing, so nothing here needs to
   * know where on Earth, or even where in the scene, the pool is.
   */
  frameVolume(bounds: VolumeBounds): void {
    const target = toWorld(
      bounds.centreX,
      bounds.centreY,
      ALTITUDE_CEILING_METERS * CAMERA_TARGET_ALTITUDE_FRACTION,
    );
    this.controls.target.copy(target);

    this.camera.position.copy(
      target.clone().add(
        toWorld(
          bounds.halfSize * CAMERA_OFFSET_EAST_HALVES,
          bounds.halfSize * CAMERA_OFFSET_NORTH_HALVES,
          bounds.halfSize * CAMERA_OFFSET_UP_HALVES,
        ),
      ),
    );
    this.controls.update();
  }

  /**
   * Hand the frame loop over, with the timestamp it will call back with.
   *
   * That timestamp is the one animated content has to be interpolated against:
   * it is `performance.now()`'s clock, the same one the states were stamped
   * with when they arrived, so no clock has to be kept in step with it.
   */
  setAnimationLoop(
    callback: ((timestamp: number) => void) | null,
  ): void {
    this.renderer.setAnimationLoop(callback);
  }

  /** Draw one frame of whatever the layers currently hold. */
  render(): void {
    // Required every frame for damping to settle.
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    // After the WebGL pass, so labels project against the camera that drew the
    // scene, and in the same frame, so they cannot trail it.
    this.labelRenderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    // A zero dimension makes the projection matrix singular.
    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.labelRenderer.setSize(width, height);
  }

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
