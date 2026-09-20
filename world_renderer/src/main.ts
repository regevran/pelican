/**
 * Wire the feed to the scene and run the frame loop.
 *
 * Nothing here draws anything: this is the one place that knows both halves
 * exist, and it stays thin enough to read at a glance.
 */

import "./style.css";

import { AerialLayer, FLOCK_KIND } from "./entities/aerial-layer";
import { PoolLayer } from "./entities/pool";
import { WorldStateFeed } from "./feed";
import { renderLegend, renderStatus } from "./legend";
import { Sampler } from "./sampler";
import { SceneView } from "./scene";
import { VolumeFrame, grownBounds, requiredBounds } from "./volume-frame";
import type { WorldState } from "./world-state";

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`The page has no #${id} element.`);
  return found;
}

const view = new SceneView(element("scene-container"), element("label-layer"));
const frame = new VolumeFrame(view.scene, view.worldGroup);
const pools = new PoolLayer(view.worldGroup);
const flockLayer = new AerialLayer(FLOCK_KIND, view.worldGroup);

const sampler = new Sampler();
let framed = false;

renderLegend(element("legend"));
const statusElement = element("status");
renderStatus(statusElement, { kind: "connecting" });

const feed = new WorldStateFeed({
  onState: (state: WorldState): void => {
    // Stamped on arrival, because the sampler measures the intervals between
    // arrivals — that is what absorbs the producer's jitter.
    sampler.push(state, performance.now());

    // Pools are scenery, not animation: they are rebuilt only when the set of
    // them changes, which is to say almost never.
    pools.update(state.pools);

    // The frame is fitted to the data rather than assumed, so no producer has
    // to tell the renderer where the scene is or how big it is.
    const bounds = grownBounds(frame.currentBounds, requiredBounds(state));
    if (bounds !== frame.currentBounds) {
      frame.setBounds(bounds);
      // Only the first frame moves the camera. A later growth — which means
      // something flew outside the box — resizes the box without yanking the
      // view out from under whoever is orbiting it.
      if (!framed) {
        view.frameVolume(bounds);
        framed = true;
      }
    }
  },
});

// A handle for the browser console, in development only. There is no other way
// to reach the scene graph or the sampler from outside the bundle.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).pelican = {
    view,
    sampler,
    frame,
    flockLayer,
  };
}

view.setAnimationLoop((now: number): void => {
  const world = sampler.sample(now);
  if (world !== undefined) flockLayer.update(world.flocks, now);

  // Asked every frame, not pushed on change: whether the data has stopped is
  // the absence of an event, so it has to be noticed rather than received.
  renderStatus(statusElement, feed.statusAt(now));

  view.render();
});

window.addEventListener("pagehide", () => {
  feed.close();
  view.setAnimationLoop(null);
});
