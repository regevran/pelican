/**
 * Every tunable the renderer has, in one place.
 *
 * Colors are plain 0xRRGGBB numbers rather than three.js `Color` instances, so
 * this file stays free of a three.js import and anything can read it — the
 * sampler, the legend and the DOM stylesheet all share these values.
 */

// -- Feed -------------------------------------------------------------------

/**
 * How long without a state before the page says so.
 *
 * Six times the producer's tick. The connection to the bridge can be perfectly
 * healthy while nothing is being published — a stopped producer looks exactly
 * like a live one from inside the browser — so the age of the last state has to
 * be reported separately from the state of the socket.
 */
export const STALE_AFTER_MS = 3000;

// -- Scene ------------------------------------------------------------------

export const BACKGROUND_COLOR = 0x0b1218;
export const GRID_COLOR = 0x27414f;
export const GRID_CENTER_COLOR = 0x3c6274;

export const CAMERA_FOV_DEGREES = 50;
export const CAMERA_NEAR_METERS = 0.5;
export const CAMERA_FAR_METERS = 20_000;
export const CAMERA_DAMPING = 0.08;
export const CAMERA_MIN_DISTANCE_METERS = 20;
export const CAMERA_MAX_DISTANCE_METERS = 3_000;

// Startup framing. The eye is offset from the camera's target in multiples of
// the frame's half-size, so the whole volume stays in shot whatever the data
// scale; the target itself sits at a fraction of the ceiling. East and south of
// center, looking down.
//
// Pulling the eye back is the one thing that fixes a cropped frame — the box's
// near corner is much closer to the camera than its center is, so framing that
// fits the center alone will cut that corner off.
export const CAMERA_OFFSET_EAST_HALVES = 3.1;
export const CAMERA_OFFSET_NORTH_HALVES = -3.7;
export const CAMERA_OFFSET_UP_HALVES = 1.07;
export const CAMERA_TARGET_ALTITUDE_FRACTION = 0.55;

export const SUN_DIRECTION = { east: 0.6, north: -0.5, up: 1.0 };
export const SUN_INTENSITY = 2.4;
export const AMBIENT_INTENSITY = 1.6;

// -- Volume frame -----------------------------------------------------------

/**
 * The top of the drawn volume, in meters above the water surface.
 *
 * This duplicates the producing simulator's own ceiling, because the contract
 * deliberately carries no scene bounds: they are producer policy, and a second
 * producer is free to fly a different band. If that ceiling moves, this is the
 * line to move with it.
 */
export const ALTITUDE_CEILING_METERS = 300;

/** Ground grid cell size; the grid is sized from the data in whole cells. */
export const GRID_CELL_METERS = 20;
/** One spare cell of grid beyond the data, so the frame is not flush with it. */
export const GRID_MARGIN_METERS = 20;

export const BOX_EDGE_COLOR = 0x33556b;
export const ALTITUDE_AXIS_COLOR = 0x6f93a8;
/** Spacing and length of the altitude axis' tick marks. */
export const ALTITUDE_TICK_INTERVAL_METERS = 50;
export const ALTITUDE_TICK_LENGTH_METERS = 8;
export const ALTITUDE_LABEL_OFFSET_METERS = 16;

// -- Pool -------------------------------------------------------------------

export const POOL_SURFACE_COLOR = 0x2b8fc4;
export const POOL_SURFACE_OPACITY = 0.42;
/**
 * Lifted above the water plane so it cannot z-fight with the grid, which sits
 * exactly at z = 0. This offset is the entire z-fighting story; no
 * polygonOffset is needed.
 */
export const POOL_SURFACE_OFFSET_METERS = 0.25;
export const POOL_RIM_COLOR = 0x1d5f86;
export const POOL_RIM_DEPTH_METERS = 4;
export const POOL_WATERLINE_COLOR = 0x7fd4ff;

// -- Flock ------------------------------------------------------------------

export const FLOCK_COLOR = 0xe8863a;
export const FLOCK_EDGE_COLOR = 0xffc48a;
/**
 * Narrow and long rather than squat: seen down its own axis — which happens
 * whenever a flock flies towards or away from the camera — a cone's silhouette
 * is its base, and a wide base reads as a dot again.
 */
export const FLOCK_RADIUS_METERS = 7;
export const FLOCK_HEIGHT_METERS = 26;
export const FLOCK_RADIAL_SEGMENTS = 12;
export const FLOCK_LABEL_OFFSET_METERS = 16;

export const DROP_LINE_COLOR = 0xe8863a;
export const DROP_LINE_DASH_METERS = 6;
export const DROP_LINE_GAP_METERS = 5;
export const DROP_LINE_OPACITY = 0.7;

export const TRAIL_COLOR = 0xffb066;
export const TRAIL_SECONDS = 30;
/**
 * Travel between vertices. Low enough to draw a curve rather than a polygon at
 * the turning rates involved, high enough that the trail spans the age it is
 * supposed to instead of spending its buffer on a still entity.
 */
export const TRAIL_MIN_STEP_METERS = 1.5;
/** A ceiling on the buffer, in case something moves very fast for very long. */
export const TRAIL_MAX_POINTS = 600;
/** Newest point's opacity; the oldest fades to nothing. */
export const TRAIL_HEAD_OPACITY = 0.95;
/**
 * A gap larger than this between consecutive samples breaks the trail instead
 * of joining it, so a restart or a reconnect does not draw a streak across the
 * scene. Kept below the sampler's snap threshold, since a snap is a real jump.
 */
export const TRAIL_BREAK_METERS = 40;

// -- Sampler ----------------------------------------------------------------

/**
 * A state that moves an entity further than this in one step is a
 * discontinuity — a simulator restart, or a reconnect after a gap — not
 * motion. Interpolating across it would glide the entity the whole distance in
 * a single interval, so the sampler snaps instead.
 */
export const SNAP_DISTANCE_METERS = 60;
/** Floor for the interpolation denominator, so a zero interval cannot divide. */
export const MIN_INTERVAL_MS = 50;
