import {
  ArcType,
  Cartesian2,
  Cartesian3,
  Color,
  EllipsoidTerrainProvider,
  HorizontalOrigin,
  PolygonHierarchy,
  PolylineArrowMaterialProperty,
  Terrain,
  Viewer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./style.css";
import type { Coordinate, Velocity, WorldState } from "./world-state";

// How far ahead the velocity vector projects, in seconds. Speeds in this
// world are small enough that the raw meter-per-second vector would be
// imperceptibly short, so it is shown as a "where it'll be in N seconds"
// arrow instead.
const VELOCITY_LOOKAHEAD_SECONDS = 10;

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

// The flat ellipsoid carries no real elevation data, so depth-testing
// against it only causes thin overlay geometry (e.g. altitude lines) to be
// clipped short at the surface instead of reaching it.
viewer.scene.globe.depthTestAgainstTerrain = false;

function toCartesian(coordinate: Coordinate): Cartesian3 {
  return Cartesian3.fromDegrees(
    coordinate.longitude_degrees,
    coordinate.latitude_degrees,
    coordinate.height_meters,
  );
}

// Aerial entities (flocks, and later drones) are rendered with a ground
// marker and a dropline connecting it to their actual position, since their
// height above the ellipsoid is otherwise not perceivable in the 3D view.
function addAerialEntity(
  name: string,
  position: Coordinate,
  velocity: Velocity,
  color: Color,
): void {
  const airPosition = toCartesian(position);
  const groundPosition = toCartesian({ ...position, height_meters: 0 });
  const velocityTip = Cartesian3.add(
    airPosition,
    new Cartesian3(
      velocity.x_meters_per_second * VELOCITY_LOOKAHEAD_SECONDS,
      velocity.y_meters_per_second * VELOCITY_LOOKAHEAD_SECONDS,
      velocity.z_meters_per_second * VELOCITY_LOOKAHEAD_SECONDS,
    ),
    new Cartesian3(),
  );

  viewer.entities.add({
    name: `${name}_ground`,
    position: groundPosition,
    point: {
      color: color.withAlpha(0.4),
      outlineColor: Color.WHITE,
      outlineWidth: 1,
      pixelSize: 6,
    },
  });

  viewer.entities.add({
    name: `${name}_altitude_line`,
    polyline: {
      positions: [groundPosition, airPosition],
      width: 1.5,
      material: Color.WHITE.withAlpha(0.6),
    },
  });

  const isMoving =
    velocity.x_meters_per_second !== 0 ||
    velocity.y_meters_per_second !== 0 ||
    velocity.z_meters_per_second !== 0;
  if (isMoving) {
    viewer.entities.add({
      name: `${name}_velocity`,
      polyline: {
        positions: [airPosition, velocityTip],
        width: 4,
        material: new PolylineArrowMaterialProperty(color),
        arcType: ArcType.NONE,
      },
    });
  }

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
      text: `${position.height_meters.toFixed(0)} m`,
    },
  });

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
  });
}

let hasFlownToWorld = false;

function renderWorld(worldState: WorldState): void {
  viewer.entities.removeAll();

  for (const pool of worldState.pools) {
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

  for (const flock of worldState.flocks) {
    addAerialEntity(flock.name, flock.position, flock.velocity, Color.ORANGE);
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
