import {
  ArcType,
  Cartesian2,
  Cartesian3,
  Color,
  EllipsoidTerrainProvider,
  type Entity,
  HorizontalOrigin,
  PolygonHierarchy,
  PolylineArrowMaterialProperty,
  Terrain,
  Viewer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./style.css";
import type { Coordinate, Velocity, WorldState } from "./world-state";

// How far ahead the velocity vector projects, in seconds. This is a pure
// visual scale (not a real prediction) chosen so typical flock speeds
// produce a clearly visible arrow.
const VELOCITY_LOOKAHEAD_SECONDS = 30;

const statusElement = document.querySelector<HTMLDivElement>("#status");
const viewer = new Viewer("cesium-container", {
  animation: false,
  baseLayer: false,
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  infoBox: false,
  navigationHelpButton: false,
  sceneModePicker: false,
  terrain: new Terrain(Promise.resolve(new EllipsoidTerrainProvider())),
  timeline: false,
});

function toCartesian(coordinate: Coordinate): Cartesian3 {
  return Cartesian3.fromDegrees(
    coordinate.longitude_degrees,
    coordinate.latitude_degrees,
    coordinate.height_meters,
  );
}

// Aerial entities (flocks, and later drones) are rebuilt every WorldState
// update since their position changes; callers must remove the returned
// entities before rendering the next update.
function addAerialEntity(
  name: string,
  position: Coordinate,
  velocity: Velocity,
  color: Color,
): Entity[] {
  const airPosition = toCartesian(position);
  const entities: Entity[] = [];

  const isMoving =
    velocity.x_meters_per_second !== 0 ||
    velocity.y_meters_per_second !== 0 ||
    velocity.z_meters_per_second !== 0;
  if (isMoving) {
    const velocityTip = Cartesian3.add(
      airPosition,
      new Cartesian3(
        velocity.x_meters_per_second * VELOCITY_LOOKAHEAD_SECONDS,
        velocity.y_meters_per_second * VELOCITY_LOOKAHEAD_SECONDS,
        velocity.z_meters_per_second * VELOCITY_LOOKAHEAD_SECONDS,
      ),
      new Cartesian3(),
    );
    entities.push(
      viewer.entities.add({
        name: `${name}_velocity`,
        polyline: {
          positions: [airPosition, velocityTip],
          width: 4,
          material: new PolylineArrowMaterialProperty(color),
          arcType: ArcType.NONE,
        },
      }),
    );
  }

  entities.push(
    viewer.entities.add({
      name,
      position: airPosition,
      point: {
        color,
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        pixelSize: 14,
      },
      label: {
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        pixelOffset: new Cartesian2(0, -28),
        showBackground: true,
        text: `${position.height_meters.toFixed(1)} m`,
      },
    }),
  );

  entities.push(
    viewer.entities.add({
      name: `${name}_name`,
      position: airPosition,
      label: {
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        horizontalOrigin: HorizontalOrigin.LEFT,
        pixelOffset: new Cartesian2(16, 0),
        showBackground: true,
        text: name,
      },
    }),
  );

  return entities;
}

let hasFlownToWorld = false;

// Pools never change once rendered, so they are added exactly once and left
// alone; rebuilding them on every WorldState update (now arriving a couple
// of times a second) is what caused the visible flicker.
const renderedPoolNames = new Set<string>();
let dynamicEntities: Entity[] = [];

function renderWorld(worldState: WorldState): void {
  for (const pool of worldState.pools) {
    if (renderedPoolNames.has(pool.name)) {
      continue;
    }
    renderedPoolNames.add(pool.name);

    viewer.entities.add({
      name: pool.name,
      polygon: {
        hierarchy: new PolygonHierarchy(pool.boundary.map(toCartesian)),
        material: Color.CYAN.withAlpha(0.45),
        outline: true,
        outlineColor: Color.WHITE,
        perPositionHeight: true,
      },
    });
  }

  for (const entity of dynamicEntities) {
    viewer.entities.remove(entity);
  }
  dynamicEntities = [];

  for (const flock of worldState.flocks) {
    dynamicEntities.push(...addAerialEntity(flock.name, flock.position, flock.velocity, Color.ORANGE));
  }

  if (!hasFlownToWorld) {
    hasFlownToWorld = true;
    void viewer.flyTo(viewer.entities, { duration: 0 });
  }
}

function subscribeToWorldState(): void {
  const eventSource = new EventSource("/api/world-state");

  eventSource.onmessage = (event: MessageEvent<string>) => {
    const worldState = JSON.parse(event.data) as WorldState;
    renderWorld(worldState);
    if (statusElement !== null) {
      statusElement.textContent = "Rendering live WorldState";
    }
  };

  eventSource.onerror = () => {
    if (statusElement !== null) {
      statusElement.textContent = "Waiting for WorldState…";
    }
  };
}

subscribeToWorldState();
