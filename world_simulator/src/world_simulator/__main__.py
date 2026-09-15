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
from jsonschema import Draft202012Validator, RefResolver


EXCHANGE_NAME = "pelican.world_state"
REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
MESSAGES_DIRECTORY = REPOSITORY_ROOT / "messages"

TICK_SECONDS = 0.5

# Horizontal motion is a "correlated random walk": the flock keeps a heading
# and a speed, and both drift gradually tick to tick, rather than each of
# its east/west and north/south velocity components being independently
# randomized. That distinction matters: independent per-axis velocities
# routinely pass near zero, and near zero a tiny random nudge can flip the
# resulting direction by close to 180 degrees, which looks like an unnatural
# instant reversal. A heading that only ever turns a little each tick, and a
# speed with a floor so it never stalls, cannot produce that artifact.
CRUISE_SPEED_METERS_PER_SECOND = 2.0
MIN_SPEED_METERS_PER_SECOND = 0.8
SPEED_DECAY_PER_SECOND = 0.2
SPEED_NOISE_METERS_PER_SECOND = 0.3
HEADING_NOISE_RADIANS_PER_SECOND = 0.15

# Within this radius of its starting point, the flock wanders freely with no
# pull home at all; only past it does a gentle steering-back kick in, and it
# ramps up with distance rather than snapping the heading around.
HOME_RADIUS_METERS = 150.0
HOME_HEADING_PULL_PER_SECOND = 0.3

# Vertical motion keeps the simpler mean-reverting velocity model from
# before (there is no equivalent "reversal" artifact for a single scalar),
# just tuned to change more slowly and roam a wider band.
VERTICAL_DECAY_PER_SECOND = 0.15
VERTICAL_NOISE_METERS_PER_SECOND = 0.3
VERTICAL_HOME_PULL_PER_SECOND = 0.0005
MIN_HEIGHT_METERS = 15.0
MAX_HEIGHT_METERS = 110.0

METERS_PER_DEGREE_LATITUDE = 111_320.0


def meters_per_degree_longitude(latitude_degrees: float) -> float:
    """Meters per degree of longitude at the given latitude (flat-plane approximation)."""
    return METERS_PER_DEGREE_LATITUDE * math.cos(math.radians(latitude_degrees))


def wrap_angle(angle_radians: float) -> float:
    """Wrap an angle to (-pi, pi], so heading comparisons take the shortest turn."""
    return ((angle_radians + math.pi) % (2 * math.pi)) - math.pi


def enu_to_ecef_velocity(
    east: float,
    north: float,
    up: float,
    longitude_degrees: float,
    latitude_degrees: float,
) -> tuple[float, float, float]:
    """Rotate a local East-North-Up velocity into the ECEF frame WorldState uses."""
    lon = math.radians(longitude_degrees)
    lat = math.radians(latitude_degrees)
    sin_lon, cos_lon = math.sin(lon), math.cos(lon)
    sin_lat, cos_lat = math.sin(lat), math.cos(lat)

    x = -sin_lon * east - sin_lat * cos_lon * north + cos_lat * cos_lon * up
    y = cos_lon * east - sin_lat * sin_lon * north + cos_lat * sin_lon * up
    z = cos_lat * north + sin_lat * up
    return x, y, z


def pool_alpha() -> dict[str, object]:
    """Return the fixed pool. Pools do not move."""
    return {
        "name": "pool_alpha",
        "boundary": [
            {"longitude_degrees": 34.772435, "latitude_degrees": 32.08075, "height_meters": 0.0},
            {"longitude_degrees": 34.771971, "latitude_degrees": 32.081111, "height_meters": 0.0},
            {"longitude_degrees": 34.771511, "latitude_degrees": 32.081245, "height_meters": 0.0},
            {"longitude_degrees": 34.771246, "latitude_degrees": 32.081584, "height_meters": 0.0},
            {"longitude_degrees": 34.770742, "latitude_degrees": 32.081622, "height_meters": 0.0},
            {"longitude_degrees": 34.770257, "latitude_degrees": 32.08147, "height_meters": 0.0},
            {"longitude_degrees": 34.769992, "latitude_degrees": 32.081125, "height_meters": 0.0},
            {"longitude_degrees": 34.770125, "latitude_degrees": 32.08075, "height_meters": 0.0},
            {"longitude_degrees": 34.769927, "latitude_degrees": 32.080351, "height_meters": 0.0},
            {"longitude_degrees": 34.770155, "latitude_degrees": 32.079931, "height_meters": 0.0},
            {"longitude_degrees": 34.770779, "latitude_degrees": 32.080001, "height_meters": 0.0},
            {"longitude_degrees": 34.77121, "latitude_degrees": 32.080039, "height_meters": 0.0},
            {"longitude_degrees": 34.771613, "latitude_degrees": 32.080156, "height_meters": 0.0},
            {"longitude_degrees": 34.772036, "latitude_degrees": 32.080364, "height_meters": 0.0},
        ],
    }


@dataclass
class FlockState:
    """A flock's geodetic position, plus the heading/speed/vertical-speed driving it."""

    name: str
    home_longitude_degrees: float
    home_latitude_degrees: float
    home_height_meters: float
    longitude_degrees: float
    latitude_degrees: float
    height_meters: float
    heading_radians: float = 0.0
    speed_meters_per_second: float = CRUISE_SPEED_METERS_PER_SECOND
    vertical_speed_meters_per_second: float = 0.0

    @classmethod
    def starting_at(
        cls, name: str, longitude_degrees: float, latitude_degrees: float, height_meters: float
    ) -> "FlockState":
        return cls(
            name=name,
            home_longitude_degrees=longitude_degrees,
            home_latitude_degrees=latitude_degrees,
            home_height_meters=height_meters,
            longitude_degrees=longitude_degrees,
            latitude_degrees=latitude_degrees,
            height_meters=height_meters,
            heading_radians=random.uniform(-math.pi, math.pi),
        )

    def step(self, dt_seconds: float) -> None:
        """Advance the random walk by dt_seconds and integrate the new position."""
        east_offset = (self.longitude_degrees - self.home_longitude_degrees) * meters_per_degree_longitude(
            self.home_latitude_degrees
        )
        north_offset = (self.latitude_degrees - self.home_latitude_degrees) * METERS_PER_DEGREE_LATITUDE
        up_offset = self.height_meters - self.home_height_meters
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

        east = self.speed_meters_per_second * math.sin(self.heading_radians)
        north = self.speed_meters_per_second * math.cos(self.heading_radians)

        self.longitude_degrees += (east * dt_seconds) / meters_per_degree_longitude(self.latitude_degrees)
        self.latitude_degrees += (north * dt_seconds) / METERS_PER_DEGREE_LATITUDE
        self.height_meters += self.vertical_speed_meters_per_second * dt_seconds

        if self.height_meters < MIN_HEIGHT_METERS:
            self.height_meters = MIN_HEIGHT_METERS
            self.vertical_speed_meters_per_second = 0.0
        elif self.height_meters > MAX_HEIGHT_METERS:
            self.height_meters = MAX_HEIGHT_METERS
            self.vertical_speed_meters_per_second = 0.0

    def to_message(self) -> dict[str, object]:
        east = self.speed_meters_per_second * math.sin(self.heading_radians)
        north = self.speed_meters_per_second * math.cos(self.heading_radians)
        x, y, z = enu_to_ecef_velocity(
            east,
            north,
            self.vertical_speed_meters_per_second,
            self.longitude_degrees,
            self.latitude_degrees,
        )
        return {
            "name": self.name,
            "position": {
                "longitude_degrees": self.longitude_degrees,
                "latitude_degrees": self.latitude_degrees,
                "height_meters": self.height_meters,
            },
            "velocity": {
                "x_meters_per_second": x,
                "y_meters_per_second": y,
                "z_meters_per_second": z,
            },
        }


def validate_world_state(world_state: dict[str, object]) -> None:
    """Validate a WorldState instance against its language-independent contract."""
    schema_path = MESSAGES_DIRECTORY / "world_state.schema.json"
    schema = json.loads(schema_path.read_text())
    resolver = RefResolver(base_uri=f"{MESSAGES_DIRECTORY.resolve().as_uri()}/", referrer=schema)
    validator = Draft202012Validator(schema, resolver=resolver)
    validator.validate(world_state)


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
    flock = FlockState.starting_at("flock_alpha", 34.7710, 32.0822, 50.0)

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
            validate_world_state(world_state)
            publish_world_state(channel, world_state)

            elapsed = time.monotonic() - now
            time.sleep(max(0.0, TICK_SECONDS - elapsed))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
