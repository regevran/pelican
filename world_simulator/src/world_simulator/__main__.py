"""Continuously publish WorldState, moving the flock along a smooth random path near the pool."""

from __future__ import annotations

import json
import math
import os
import random
import time
from dataclasses import dataclass
from pathlib import Path

import pika
from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012


EXCHANGE_NAME = "pelican.world_state"
REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
MESSAGES_DIRECTORY = REPOSITORY_ROOT / "messages"

TICK_SECONDS = 0.5

# Positions and velocities are in the local scene frame: meters east, north and
# up, with z = 0 on the pool water surface. This producer's origin is the point
# the pool boundary below was measured from; consumers never need to know it,
# because they frame themselves from the data's own bounds.

# Horizontal motion is a "correlated random walk": the flock keeps a heading
# and a speed, and both drift gradually tick to tick, rather than each of
# its east/west and north/south velocity components being independently
# randomized. That distinction matters: independent per-axis velocities
# routinely pass near zero, and near zero a tiny random nudge can flip the
# resulting direction by close to 180 degrees, which looks like an unnatural
# instant reversal. A heading that only ever turns a little each tick, and a
# speed with a floor so it never stalls, cannot produce that artifact.
CRUISE_SPEED_METERS_PER_SECOND = 3.0
MIN_SPEED_METERS_PER_SECOND = 1.2
SPEED_DECAY_PER_SECOND = 0.2
SPEED_NOISE_METERS_PER_SECOND = 0.3
HEADING_NOISE_RADIANS_PER_SECOND = 0.15

# Within this radius of its starting point, the flock wanders freely with no
# pull home at all; only past it does a gentle steering-back kick in, and it
# ramps up with distance rather than snapping the heading around.
HOME_RADIUS_METERS = 100.0
HOME_HEADING_PULL_PER_SECOND = 0.3

# Vertical motion keeps the simpler mean-reverting velocity model from
# before (there is no equivalent "reversal" artifact for a single scalar),
# just tuned to change more slowly and roam the full altitude band.
VERTICAL_DECAY_PER_SECOND = 0.15
VERTICAL_NOISE_METERS_PER_SECOND = 0.5
VERTICAL_HOME_PULL_PER_SECOND = 0.001
MIN_HEIGHT_METERS = 15.0
MAX_HEIGHT_METERS = 300.0


def wrap_angle(angle_radians: float) -> float:
    """Wrap an angle to (-pi, pi], so heading comparisons take the shortest turn."""
    return ((angle_radians + math.pi) % (2 * math.pi)) - math.pi


def pool_alpha() -> dict[str, object]:
    """Return the fixed pool. Pools do not move.

    The boundary was originally authored in WGS 84 and is converted here once,
    about the origin (longitude 34.771, latitude 32.08075), using

        x = (longitude - 34.771) * 111_320 * cos(radians(32.08075))   # 94321.48171614
        y = (latitude  - 32.08075) * 111_320

    so the shape is preserved exactly and only the frame changed. The ring runs
    counter-clockwise, which is the winding a renderer's extrusion expects; it
    spans 236.56 m east by 188.24 m north.
    """
    return {
        "name": "pool_alpha",
        "boundary": [
            {"x_meters": 135.35, "y_meters": 0.00},
            {"x_meters": 91.59, "y_meters": 40.19},
            {"x_meters": 48.20, "y_meters": 55.10},
            {"x_meters": 23.20, "y_meters": 92.84},
            {"x_meters": -24.33, "y_meters": 97.07},
            {"x_meters": -70.08, "y_meters": 80.15},
            {"x_meters": -95.08, "y_meters": 41.74},
            {"x_meters": -82.53, "y_meters": 0.00},
            {"x_meters": -101.21, "y_meters": -44.42},
            {"x_meters": -79.70, "y_meters": -91.17},
            {"x_meters": -20.85, "y_meters": -83.38},
            {"x_meters": 19.81, "y_meters": -79.15},
            {"x_meters": 57.82, "y_meters": -66.12},
            {"x_meters": 97.72, "y_meters": -42.97},
        ],
    }


@dataclass
class FlockState:
    """A flock's position in the scene frame, plus the heading/speed/vertical-speed driving it."""

    name: str
    home_x_meters: float
    home_y_meters: float
    home_z_meters: float
    x_meters: float
    y_meters: float
    z_meters: float
    heading_radians: float = 0.0
    speed_meters_per_second: float = CRUISE_SPEED_METERS_PER_SECOND
    vertical_speed_meters_per_second: float = 0.0

    @classmethod
    def starting_at(cls, name: str, x_meters: float, y_meters: float, z_meters: float) -> "FlockState":
        return cls(
            name=name,
            home_x_meters=x_meters,
            home_y_meters=y_meters,
            home_z_meters=z_meters,
            x_meters=x_meters,
            y_meters=y_meters,
            z_meters=z_meters,
            heading_radians=random.uniform(-math.pi, math.pi),
        )

    def step(self, dt_seconds: float) -> None:
        """Advance the random walk by dt_seconds and integrate the new position."""
        east_offset = self.x_meters - self.home_x_meters
        north_offset = self.y_meters - self.home_y_meters
        up_offset = self.z_meters - self.home_z_meters
        distance_from_home = math.hypot(east_offset, north_offset)

        heading_bias = 0.0
        if distance_from_home > HOME_RADIUS_METERS:
            bearing_to_home = math.atan2(-east_offset, -north_offset)
            heading_error = wrap_angle(bearing_to_home - self.heading_radians)
            pull_strength = min((distance_from_home - HOME_RADIUS_METERS) / HOME_RADIUS_METERS, 1.0)
            heading_bias = HOME_HEADING_PULL_PER_SECOND * heading_error * pull_strength

        self.heading_radians = wrap_angle(
            self.heading_radians
            + heading_bias * dt_seconds
            + random.gauss(0.0, HEADING_NOISE_RADIANS_PER_SECOND) * math.sqrt(dt_seconds)
        )

        self.speed_meters_per_second += (
            -SPEED_DECAY_PER_SECOND * (self.speed_meters_per_second - CRUISE_SPEED_METERS_PER_SECOND)
        ) * dt_seconds + random.gauss(0.0, SPEED_NOISE_METERS_PER_SECOND) * math.sqrt(dt_seconds)
        self.speed_meters_per_second = max(MIN_SPEED_METERS_PER_SECOND, self.speed_meters_per_second)

        self.vertical_speed_meters_per_second += (
            -VERTICAL_DECAY_PER_SECOND * self.vertical_speed_meters_per_second
            - VERTICAL_HOME_PULL_PER_SECOND * up_offset
        ) * dt_seconds + random.gauss(0.0, VERTICAL_NOISE_METERS_PER_SECOND) * math.sqrt(dt_seconds)

        # Heading is a compass bearing: zero points north, and it turns east.
        self.x_meters += self.speed_meters_per_second * math.sin(self.heading_radians) * dt_seconds
        self.y_meters += self.speed_meters_per_second * math.cos(self.heading_radians) * dt_seconds
        self.z_meters += self.vertical_speed_meters_per_second * dt_seconds

        if self.z_meters < MIN_HEIGHT_METERS:
            self.z_meters = MIN_HEIGHT_METERS
            self.vertical_speed_meters_per_second = 0.0
        elif self.z_meters > MAX_HEIGHT_METERS:
            self.z_meters = MAX_HEIGHT_METERS
            self.vertical_speed_meters_per_second = 0.0

    def to_message(self) -> dict[str, object]:
        return {
            "name": self.name,
            "position": {
                "x_meters": self.x_meters,
                "y_meters": self.y_meters,
                "z_meters": self.z_meters,
            },
            "velocity": {
                "x_meters_per_second": self.speed_meters_per_second * math.sin(self.heading_radians),
                "y_meters_per_second": self.speed_meters_per_second * math.cos(self.heading_radians),
                "z_meters_per_second": self.vertical_speed_meters_per_second,
            },
        }


def build_validator() -> Draft202012Validator:
    """Build the WorldState validator, with the whole schema graph resolvable by URI.

    The contract files reference one another by relative path, so each is
    registered under its own file URI. The root is additionally given that URI
    as an in-memory `$id`: with no `$id` it has no base against which its
    relative `$ref`s can be resolved, and the registry alone cannot supply one.
    The file on disk keeps its relative references, so the contracts stay
    portable. Built once, because re-reading and re-resolving all six files on
    every tick does no useful work.
    """
    base_uri = f"{MESSAGES_DIRECTORY.resolve().as_uri()}/"
    resources = []
    for path in sorted(MESSAGES_DIRECTORY.rglob("*.schema.json")):
        uri = f"{base_uri}{path.relative_to(MESSAGES_DIRECTORY).as_posix()}"
        contents = json.loads(path.read_text())
        resources.append((uri, Resource.from_contents(contents, default_specification=DRAFT202012)))

    schema = json.loads((MESSAGES_DIRECTORY / "world_state.schema.json").read_text())
    schema["$id"] = f"{base_uri}world_state.schema.json"
    return Draft202012Validator(schema, registry=Registry().with_resources(resources))


def connect() -> pika.BlockingConnection:
    connection_url = os.environ.get("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/%2F")
    return pika.BlockingConnection(pika.URLParameters(connection_url))


def publish_world_state(channel, world_state: dict[str, object]) -> None:
    """Publish WorldState through the shared fanout exchange."""
    channel.basic_publish(
        exchange=EXCHANGE_NAME,
        routing_key="",
        body=json.dumps(world_state).encode("utf-8"),
        properties=pika.BasicProperties(
            content_type="application/json",
            delivery_mode=pika.DeliveryMode.Persistent,
            type="WorldState",
        ),
    )


def main() -> None:
    pool = pool_alpha()
    flock = FlockState.starting_at("flock_alpha", 0.0, 0.0, 120.0)
    validator = build_validator()

    with connect() as connection:
        channel = connection.channel()
        channel.exchange_declare(exchange=EXCHANGE_NAME, exchange_type="fanout", durable=True)

        print(f"Publishing WorldState every {TICK_SECONDS}s. Press Ctrl+C to stop.")
        last_tick = time.monotonic()
        while True:
            now = time.monotonic()
            dt_seconds = now - last_tick
            last_tick = now

            flock.step(dt_seconds)
            world_state = {"pools": [pool], "flocks": [flock.to_message()]}
            validator.validate(world_state)
            publish_world_state(channel, world_state)

            elapsed = time.monotonic() - now
            time.sleep(max(0.0, TICK_SECONDS - elapsed))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
