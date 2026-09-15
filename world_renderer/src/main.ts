import {
  Cartesian2,
  Cartesian3,
  Color,
  EllipsoidTerrainProvider,
  PolygonHierarchy,
  Terrain,
  Viewer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./style.css";
import type { Coordinate, WorldState } from "./world-state";

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
    viewer.entities.add({
      name: flock.name,
      position: toCartesian(flock.position),
      point: {
        color: Color.ORANGE,
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
        text: flock.name,
      },
    });
  }

  void viewer.flyTo(viewer.entities, { duration: 0 });
}

async function fetchWorldState(): Promise<WorldState> {
  const response = await fetch("/api/world-state");
  if (!response.ok) {
    throw new Error("WorldState is not available yet.");
  }

  return (await response.json()) as WorldState;
}

async function loadWorld(): Promise<void> {
  try {
    const worldState = await fetchWorldState();
    renderWorld(worldState);
    if (statusElement !== null) {
      statusElement.textContent = "Rendering static WorldState";
    }
  } catch {
    window.setTimeout(() => {
      void loadWorld();
    }, 1000);
  }
}

void loadWorld();
